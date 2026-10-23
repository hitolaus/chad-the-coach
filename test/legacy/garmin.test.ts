import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { GarminClient, GarminError, TOKENS_KEY, type GarminTokens } from "../../src/legacy/garmin";

const nowSeconds = () => Math.floor(Date.now() / 1000);

function fakeJwt(payload: Record<string, unknown>): string {
  const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, "");
  return `${encode({ alg: "RS256" })}.${encode(payload)}.signature`;
}

const freshToken = fakeJwt({ exp: nowSeconds() + 3600, client_id: "CLIENT_A" });
const expiringToken = fakeJwt({ exp: nowSeconds() + 60, client_id: "CLIENT_A" });
const refreshedToken = fakeJwt({ exp: nowSeconds() + 3600, client_id: "CLIENT_B" });

async function storeTokens(tokens: GarminTokens) {
  await env.OAUTH_KV.put(TOKENS_KEY, JSON.stringify(tokens));
}

const storedTokens = () => env.OAUTH_KV.get<GarminTokens>(TOKENS_KEY, "json");

interface Call {
  url: string;
  init?: RequestInit;
}

// A stand-in for Garmin: answers token refreshes and API calls, recording every request.
function fakeGarmin(api: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    if (url.startsWith("https://diauth.garmin.com/")) {
      return Response.json({ access_token: refreshedToken, refresh_token: "refresh-2" });
    }
    return api(call);
  };
  return { calls, fetcher, apiCalls: () => calls.filter((c) => c.url.startsWith("https://connectapi.garmin.com/")) };
}

const header = (call: Call, name: string) => new Headers(call.init?.headers).get(name);

describe("GarminClient", () => {
  beforeEach(async () => {
    await storeTokens({ di_token: freshToken, di_refresh_token: "refresh-1", di_client_id: "CLIENT_A" });
  });

  it("calls the Garmin API with the stored token and the mobile app's headers", async () => {
    const garmin = fakeGarmin(() => Response.json([{ activityId: 1 }]));
    const client = new GarminClient(env.OAUTH_KV, garmin.fetcher);

    const result = await client.get("/activitylist-service/activities/search/activities", { start: 0, limit: 5 });

    expect(result).toEqual([{ activityId: 1 }]);
    const [call] = garmin.calls;
    expect(call.url).toBe(
      "https://connectapi.garmin.com/activitylist-service/activities/search/activities?start=0&limit=5"
    );
    expect(header(call, "Authorization")).toBe(`Bearer ${freshToken}`);
    expect(header(call, "User-Agent")).toBe("GCM-Android-5.23");
  });

  it("refreshes a token that is about to expire and keeps Garmin's rotated refresh token", async () => {
    await storeTokens({ di_token: expiringToken, di_refresh_token: "refresh-1", di_client_id: "CLIENT_A" });
    const garmin = fakeGarmin(() => Response.json({}));
    const client = new GarminClient(env.OAUTH_KV, garmin.fetcher);

    await client.get("/userprofile-service/socialProfile");

    const [refresh, apiCall] = garmin.calls;
    expect(refresh.url).toBe("https://diauth.garmin.com/di-oauth2-service/oauth/token");
    expect(header(refresh, "Authorization")).toBe(`Basic ${btoa("CLIENT_A:")}`);
    const body = new URLSearchParams(refresh.init?.body as URLSearchParams);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("refresh-1");
    expect(header(apiCall, "Authorization")).toBe(`Bearer ${refreshedToken}`);
    expect(await storedTokens()).toEqual({
      di_token: refreshedToken,
      di_refresh_token: "refresh-2",
      di_client_id: "CLIENT_B"
    });
  });

  it("does not refresh a token that is still valid", async () => {
    const garmin = fakeGarmin(() => Response.json({}));
    const client = new GarminClient(env.OAUTH_KV, garmin.fetcher);

    await client.get("/userprofile-service/socialProfile");

    expect(garmin.calls).toHaveLength(1);
  });

  it("refreshes and retries once when Garmin rejects the token", async () => {
    const garmin = fakeGarmin((call) =>
      header(call, "Authorization") === `Bearer ${freshToken}` ? new Response(null, { status: 401 }) : Response.json({ ok: true })
    );
    const client = new GarminClient(env.OAUTH_KV, garmin.fetcher);

    const result = await client.get("/userprofile-service/socialProfile");

    expect(result).toEqual({ ok: true });
    expect(garmin.apiCalls()).toHaveLength(2);
    expect((await storedTokens())?.di_token).toBe(refreshedToken);
  });

  it("refreshes only once when several calls run at the same time", async () => {
    await storeTokens({ di_token: expiringToken, di_refresh_token: "refresh-1", di_client_id: "CLIENT_A" });
    const garmin = fakeGarmin(() => Response.json({}));
    const client = new GarminClient(env.OAUTH_KV, garmin.fetcher);

    await Promise.all([client.get("/a"), client.get("/b"), client.get("/c")]);

    expect(garmin.calls.filter((c) => c.url.startsWith("https://diauth.garmin.com/"))).toHaveLength(1);
    expect(garmin.apiCalls().every((c) => header(c, "Authorization") === `Bearer ${refreshedToken}`)).toBe(true);
  });

  it("refreshes only once when several concurrent calls are rejected", async () => {
    const garmin = fakeGarmin((call) =>
      header(call, "Authorization") === `Bearer ${freshToken}` ? new Response(null, { status: 401 }) : Response.json({})
    );
    const client = new GarminClient(env.OAUTH_KV, garmin.fetcher);

    await Promise.all([client.get("/a"), client.get("/b")]);

    expect(garmin.calls.filter((c) => c.url.startsWith("https://diauth.garmin.com/"))).toHaveLength(1);
  });

  it("explains how to sign in when no Garmin tokens are stored", async () => {
    await env.OAUTH_KV.delete(TOKENS_KEY);
    const client = new GarminClient(env.OAUTH_KV, fakeGarmin(() => Response.json({})).fetcher);

    await expect(client.get("/userprofile-service/socialProfile")).rejects.toThrow(/garmin_login\.py/);
  });

  it("reports a 403 as a possible block rather than a bad token", async () => {
    const client = new GarminClient(env.OAUTH_KV, fakeGarmin(() => new Response("blocked", { status: 403 })).fetcher);

    const error = (await client.get("/userprofile-service/socialProfile").catch((e) => e)) as GarminError;

    expect(error).toBeInstanceOf(GarminError);
    expect(error.status).toBe(403);
    expect(error.message).toMatch(/blocking/);
  });
});
