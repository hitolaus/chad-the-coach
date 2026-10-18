import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp/server";
import { handleAuthorize, type AuthorizeEnv } from "./authorize";
import { createServer } from "./mcp";

// The provider needs the public URL at construction, and that comes from env, so build it on first use.
let provider: OAuthProvider<Env> | undefined;

function getProvider(env: Env): OAuthProvider<Env> {
  if (provider) return provider;
  const baseUrl = env.PUBLIC_URL.replace(/\/$/, "");
  const mcpHandler = createMcpHandler(createServer, {
    route: "/mcp",
    allowedHostnames: [new URL(baseUrl).hostname]
  });
  provider = new OAuthProvider<Env>({
    apiRoute: "/mcp",
    apiHandler: { fetch: (request, env, ctx) => mcpHandler(request, env, ctx) },
    defaultHandler: {
      async fetch(request, env) {
        if (new URL(request.url).pathname === "/authorize") {
          return handleAuthorize(request, env as AuthorizeEnv);
        }
        return new Response("Not found", { status: 404 });
      }
    },
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: "/oauth/register",
    clientIdMetadataDocumentEnabled: true,
    resourceMetadata: {
      resource: `${baseUrl}/mcp`,
      authorization_servers: [baseUrl]
    }
  });
  return provider;
}

export default {
  fetch(request, env, ctx) {
    return getProvider(env).fetch(request, env, ctx);
  }
} satisfies ExportedHandler<Env>;
