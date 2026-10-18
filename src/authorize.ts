import { AuthorizationError, CimdFetchError } from "@cloudflare/workers-oauth-provider";
import type { ConsentDescription, OAuthHelpers } from "@cloudflare/workers-oauth-provider";

// There is exactly one user: the owner, who signs in with OWNER_PASSWORD.
export const OWNER_USER_ID = "owner";

export type AuthorizeEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const text = (message: string, status: number) =>
  new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export async function handleAuthorize(request: Request, env: AuthorizeEnv): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  try {
    if (request.method === "GET") {
      const authRequest = await oauth.parseAuthRequest(request);
      const details = await oauth.describeConsent(authRequest);
      const consent = await oauth.beginConsent(authRequest);
      return page(details, consent.handle, consent.headers);
    }

    if (request.method === "POST") {
      const form = await request.formData();
      const handle = String(form.get("handle") ?? "");

      if (form.get("decision") !== "approve") {
        const denied = await oauth.denyConsent(request, handle);
        denied.headers.set("Location", denied.redirectTo);
        return new Response(null, { status: 302, headers: denied.headers });
      }

      if (!(await passwordMatches(String(form.get("password") ?? ""), env.OWNER_PASSWORD))) {
        // The handle has not been used yet, so the same form can be submitted again.
        return text("Wrong password. Go back and try again.", 401);
      }

      const approved = await oauth.approveConsent(request, handle);
      const { redirectTo } = await oauth.completeAuthorization({
        request: approved.request,
        userId: OWNER_USER_ID,
        metadata: {},
        scope: approved.request.scope,
        props: { userId: OWNER_USER_ID }
      });
      approved.headers.set("Location", redirectTo);
      return new Response(null, { status: 302, headers: approved.headers });
    }

    return text("Method not allowed", 405);
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) {
      return Response.redirect(error.redirectTo, 302);
    }
    if (error instanceof AuthorizationError) return text(error.description, 400);
    if (error instanceof CimdFetchError) return text("This app could not be verified.", 400);
    throw error;
  }
}

async function passwordMatches(given: string, expected: string | undefined): Promise<boolean> {
  if (!expected) return false;
  // Compare digests so the comparison is constant-time regardless of input length.
  const digest = async (value: string) =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  return crypto.subtle.timingSafeEqual(a, b);
}

function page(details: ConsentDescription, handle: string, headers: Headers): Response {
  const name = escape(details.clientName);
  const origin = details.clientDomain
    ? `Published by <strong>${escape(details.clientDomain)}</strong>.`
    : "This app registered itself; its name is not verified.";
  const loopbackWarning = details.redirectIsLoopback
    ? "<p><strong>This sends access to an app on your computer.</strong> Continue only if you just started signing in from it.</p>"
    : "";
  headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(
    `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chad the Coach – sign in</title>
<style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem;line-height:1.5}input,button{font:inherit;padding:.4rem .6rem}</style>
<h1>Allow ${name} to access Chad the Coach?</h1>
<p>${origin} Access will be sent to <strong>${escape(details.redirectHost)}</strong>.</p>
${loopbackWarning}
<form method="post">
  <input type="hidden" name="handle" value="${escape(handle)}">
  <p><label>Password<br><input type="password" name="password" autocomplete="current-password" autofocus></label></p>
  <p><button name="decision" value="approve">Allow</button> <button name="decision" value="deny">Deny</button></p>
</form>`,
    { headers }
  );
}
