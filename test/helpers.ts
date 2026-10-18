import { exports } from "cloudflare:workers";
import { expect } from "vitest";

export const BASE = "https://coach.test";
export const PASSWORD = "correct horse battery staple";
export const REDIRECT_URI = "https://client.test/callback";

// Real requests always carry Host; the MCP handler checks it, so tests send it too.
export function call(path: string, init?: RequestInit) {
  const request = new Request(`${BASE}${path}`, init);
  request.headers.set("Host", new URL(BASE).host);
  return exports.default.fetch(request);
}

export function base64url(bytes: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function registerClient(): Promise<string> {
  const response = await call("/oauth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Test client",
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: "none"
    })
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { client_id: string }).client_id;
}

// Opens the sign-in page the way a browser would, returning what is needed to submit it.
export async function openSignInPage() {
  const clientId = await registerClient();
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "state-123",
    resource: `${BASE}/mcp`
  });
  const response = await call(`/authorize?${query}`);
  expect(response.status).toBe(200);
  const html = await response.text();
  const handle = html.match(/name="handle" value="([^"]+)"/)?.[1];
  expect(handle).toBeDefined();
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  return { clientId, verifier, handle: handle!, cookie, html };
}

export function submitSignInPage(page: { handle: string; cookie: string }, fields: Record<string, string>) {
  return call("/authorize", {
    method: "POST",
    headers: { Cookie: page.cookie, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ handle: page.handle, ...fields }),
    redirect: "manual"
  });
}

export async function signIn(): Promise<string> {
  const page = await openSignInPage();
  const approved = await submitSignInPage(page, { decision: "approve", password: PASSWORD });
  expect(approved.status).toBe(302);
  const code = new URL(approved.headers.get("Location")!).searchParams.get("code")!;

  const tokenResponse = await call("/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: page.clientId,
      code_verifier: page.verifier,
      resource: `${BASE}/mcp`
    })
  });
  expect(tokenResponse.status).toBe(200);
  return ((await tokenResponse.json()) as { access_token: string }).access_token;
}

export function mcpRequest(body: unknown, token?: string) {
  return call("/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-06-18",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
}

// Reads a JSON-RPC result from either a JSON or a single-event SSE response.
export async function rpcResult(response: Response): Promise<any> {
  const raw = await response.text();
  const json = response.headers.get("Content-Type")?.includes("text/event-stream")
    ? raw.split("\n").find((line) => line.startsWith("data: "))!.slice("data: ".length)
    : raw;
  return JSON.parse(json);
}

// Calls one MCP tool as a signed-in client and returns its result.
export async function callTool(name: string, args: Record<string, unknown>, token?: string) {
  const response = await mcpRequest(
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
    token ?? (await signIn())
  );
  expect(response.status).toBe(200);
  return (await rpcResult(response)).result as { content: { type: string; text: string }[]; isError?: boolean };
}
