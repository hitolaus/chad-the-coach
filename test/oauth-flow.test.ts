import { describe, expect, it } from "vitest";
import { BASE, PASSWORD, REDIRECT_URI, mcpRequest, openSignInPage, rpcResult, signIn, submitSignInPage } from "./helpers";

describe("MCP endpoint", () => {
  it("rejects requests without a token and points the client at the OAuth metadata", async () => {
    const response = await mcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" });

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain(
      `resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"`
    );
  });

  it("rejects an invalid token", async () => {
    const response = await mcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }, "not-a-real-token");

    expect(response.status).toBe(401);
  });

  it("lets a signed-in client call the ping tool", async () => {
    const token = await signIn();

    const response = await mcpRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ping", arguments: {} } },
      token
    );

    expect(response.status).toBe(200);
    const result = await rpcResult(response);
    expect(result.result.content[0].text).toMatch(/^pong from chad-the-coach at /);
  });
});

describe("sign-in page", () => {
  it("names the app asking for access and where the access is sent", async () => {
    const page = await openSignInPage();

    expect(page.html).toContain("Allow Test client to access Chad the Coach?");
    expect(page.html).toContain("client.test");
  });

  it("refuses a wrong password without issuing a code", async () => {
    const page = await openSignInPage();

    const response = await submitSignInPage(page, { decision: "approve", password: "wrong" });

    expect(response.status).toBe(401);
    expect(response.headers.get("Location")).toBeNull();
  });

  it("still accepts the right password after a wrong one", async () => {
    const page = await openSignInPage();
    await submitSignInPage(page, { decision: "approve", password: "wrong" });

    const response = await submitSignInPage(page, { decision: "approve", password: PASSWORD });

    expect(response.status).toBe(302);
    expect(new URL(response.headers.get("Location")!).searchParams.get("code")).toBeTruthy();
  });

  it("sends access_denied back to the client when the owner clicks Deny", async () => {
    const page = await openSignInPage();

    const response = await submitSignInPage(page, { decision: "deny" });

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("Location")!);
    expect(location.origin + location.pathname).toBe(REDIRECT_URI);
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.get("state")).toBe("state-123");
  });
});
