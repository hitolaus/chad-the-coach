import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { callTool, mcpRequest, rpcResult, signIn } from "./helpers";

// GARMIN_API (a var in wrangler.jsonc) picks the Garmin integration per request: "legacy" for the
// Connect app's API, anything else for the personal API. The tests run with "personal".
const setGarminApi = (value: string) => {
  (env as { GARMIN_API: string }).GARMIN_API = value;
};

const realFetch = globalThis.fetch;
let garminHosts: string[];

function stubGarmin() {
  garminHosts = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (!url.hostname.endsWith("garmin.com")) return realFetch(input, init);
    garminHosts.push(url.hostname);
    return Response.json([]);
  });
}

async function toolNames() {
  const response = await mcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }, await signIn());
  return (await rpcResult(response)).result.tools.map((t: { name: string }) => t.name).sort();
}

afterEach(() => {
  setGarminApi("personal");
  vi.restoreAllMocks();
});

describe("GARMIN_API", () => {
  it("offers the personal API's tools when set to personal", async () => {
    expect(await toolNames()).toEqual(["get_activities", "get_activity_details", "get_daily_health", "ping"]);
  });

  it("offers the legacy integration's tools when set to legacy", async () => {
    setGarminApi("legacy");

    expect(await toolNames()).toEqual([
      "get_activities",
      "get_activity_details",
      "get_daily_health",
      "get_training_status",
      "get_vo2max_history",
      "ping"
    ]);
  });

  it("sends requests to the Connect app's API when set to legacy", async () => {
    setGarminApi("legacy");
    await env.OAUTH_KV.put(
      "garmin-tokens",
      JSON.stringify({ di_token: "x.eyJleHAiOjk5OTk5OTk5OTl9.y", di_refresh_token: "r", di_client_id: "c" })
    );
    stubGarmin();

    await callTool("get_activities", {});

    expect(garminHosts).toEqual(["connectapi.garmin.com"]);
  });

  it("switches back without a restart", async () => {
    setGarminApi("legacy");
    await toolNames();
    setGarminApi("personal");

    expect(await toolNames()).not.toContain("get_training_status");
  });
});
