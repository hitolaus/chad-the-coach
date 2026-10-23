import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { GarminClient, GarminError, TOKEN_KEY } from "../src/garmin";

const API_KEY = "GCDC_test-key";
const TOKEN_URL = "https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token";

const nowSeconds = () => Math.floor(Date.now() / 1000);

function fakeJwt(payload: Record<string, unknown>): string {
  const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, "");
  return `${encode({ alg: "RS256" })}.${encode(payload)}.signature`;
}

const freshToken = fakeJwt({ exp: nowSeconds() + 24 * 3600 });
const expiringToken = fakeJwt({ exp: nowSeconds() + 60 });
const newToken = fakeJwt({ exp: nowSeconds() + 24 * 3600, n: 2 });

interface Call {
  url: string;
  init?: RequestInit;
}

// A stand-in for Garmin: answers token requests with `newToken` (as plain text, like Garmin)
// and API calls with `api`, recording every request.
function fakeGarmin(api: (call: Call) => Response, tokenResponse = () => new Response(newToken)) {
  const calls: Call[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return url === TOKEN_URL ? tokenResponse() : api(call);
  };
  return {
    calls,
    fetcher,
    tokenCalls: () => calls.filter((c) => c.url === TOKEN_URL),
    apiCalls: () => calls.filter((c) => c.url !== TOKEN_URL)
  };
}

const header = (call: Call, name: string) => new Headers(call.init?.headers).get(name);

describe("GarminClient", () => {
  beforeEach(async () => {
    await env.OAUTH_KV.put(TOKEN_KEY, freshToken);
  });

  it("calls the personal API with the stored token", async () => {
    const garmin = fakeGarmin(() => Response.json([{ activityId: 1 }]));
    const client = new GarminClient(env.OAUTH_KV, API_KEY, garmin.fetcher);

    const result = await client.get("/activitylist-service/activities/search/activities", { start: 0, limit: 5 });

    expect(result).toEqual([{ activityId: 1 }]);
    const [call] = garmin.calls;
    expect(call.url).toBe(
      "https://personal.connectapi.garmin.com/activitylist-service/activities/search/activities?start=0&limit=5"
    );
    expect(header(call, "Authorization")).toBe(`Bearer ${freshToken}`);
  });

  it("exchanges the API key for a token when none is stored, and stores it", async () => {
    await env.OAUTH_KV.delete(TOKEN_KEY);
    const garmin = fakeGarmin(() => Response.json({}));
    const client = new GarminClient(env.OAUTH_KV, API_KEY, garmin.fetcher);

    await client.get("/userprofile-service/userprofile/settings");

    const [exchange, apiCall] = garmin.calls;
    expect(exchange.url).toBe(TOKEN_URL);
    expect(exchange.init?.method).toBe("POST");
    expect(header(exchange, "Authorization")).toBe(`ApiKey ${API_KEY}`);
    expect(header(apiCall, "Authorization")).toBe(`Bearer ${newToken}`);
    expect(await env.OAUTH_KV.get(TOKEN_KEY)).toBe(newToken);
  });

  it("gets a new token when the stored one is about to expire", async () => {
    await env.OAUTH_KV.put(TOKEN_KEY, expiringToken);
    const garmin = fakeGarmin(() => Response.json({}));
    const client = new GarminClient(env.OAUTH_KV, API_KEY, garmin.fetcher);

    await client.get("/userprofile-service/userprofile/settings");

    expect(garmin.tokenCalls()).toHaveLength(1);
    expect(header(garmin.apiCalls()[0], "Authorization")).toBe(`Bearer ${newToken}`);
  });

  it("does not ask for a token while the stored one is valid", async () => {
    const garmin = fakeGarmin(() => Response.json({}));
    const client = new GarminClient(env.OAUTH_KV, API_KEY, garmin.fetcher);

    await client.get("/userprofile-service/userprofile/settings");

    expect(garmin.tokenCalls()).toEqual([]);
  });

  it("gets a new token and retries once when Garmin rejects the stored one", async () => {
    const garmin = fakeGarmin((call) =>
      header(call, "Authorization") === `Bearer ${freshToken}` ? new Response(null, { status: 401 }) : Response.json({ ok: true })
    );
    const client = new GarminClient(env.OAUTH_KV, API_KEY, garmin.fetcher);

    const result = await client.get("/userprofile-service/userprofile/settings");

    expect(result).toEqual({ ok: true });
    expect(garmin.apiCalls()).toHaveLength(2);
    expect(await env.OAUTH_KV.get(TOKEN_KEY)).toBe(newToken);
  });

  it("asks for one token when several calls need one at the same time", async () => {
    await env.OAUTH_KV.put(TOKEN_KEY, expiringToken);
    const garmin = fakeGarmin(() => Response.json({}));
    const client = new GarminClient(env.OAUTH_KV, API_KEY, garmin.fetcher);

    await Promise.all([client.get("/a"), client.get("/b"), client.get("/c")]);

    expect(garmin.tokenCalls()).toHaveLength(1);
    expect(garmin.apiCalls().every((c) => header(c, "Authorization") === `Bearer ${newToken}`)).toBe(true);
  });

  it("asks for one token when several concurrent calls are rejected", async () => {
    const garmin = fakeGarmin((call) =>
      header(call, "Authorization") === `Bearer ${freshToken}` ? new Response(null, { status: 401 }) : Response.json({})
    );
    const client = new GarminClient(env.OAUTH_KV, API_KEY, garmin.fetcher);

    await Promise.all([client.get("/a"), client.get("/b")]);

    expect(garmin.tokenCalls()).toHaveLength(1);
  });

  it("explains how to set the API key when none is configured", async () => {
    await env.OAUTH_KV.delete(TOKEN_KEY);
    const client = new GarminClient(env.OAUTH_KV, undefined, fakeGarmin(() => Response.json({})).fetcher);

    await expect(client.get("/userprofile-service/userprofile/settings")).rejects.toThrow(/wrangler secret put GARMIN_API_KEY/);
  });

  it("says the API key may have expired when Garmin refuses to exchange it", async () => {
    await env.OAUTH_KV.delete(TOKEN_KEY);
    const garmin = fakeGarmin(
      () => Response.json({}),
      () => new Response(null, { status: 401 })
    );
    const client = new GarminClient(env.OAUTH_KV, API_KEY, garmin.fetcher);

    const error = (await client.get("/userprofile-service/userprofile/settings").catch((e) => e)) as GarminError;

    expect(error).toBeInstanceOf(GarminError);
    expect(error.message).toMatch(/expired/);
    expect(error.message).toContain("connect.garmin.com/app/settings/personalApiToken");
    expect(garmin.apiCalls()).toEqual([]);
  });

  it("does not blame the API key when Garmin's token service itself fails", async () => {
    await env.OAUTH_KV.delete(TOKEN_KEY);
    const garmin = fakeGarmin(
      () => Response.json({}),
      () => new Response("error code: 526", { status: 526 })
    );
    const client = new GarminClient(env.OAUTH_KV, API_KEY, garmin.fetcher);

    const error = (await client.get("/userprofile-service/userprofile/settings").catch((e) => e)) as GarminError;

    expect(error).toBeInstanceOf(GarminError);
    expect(error.status).toBe(526);
    expect(error.message).not.toMatch(/expired|API key/);
    expect(error.message).toMatch(/try again/);
  });

  it("reports API errors with their status", async () => {
    const client = new GarminClient(env.OAUTH_KV, API_KEY, fakeGarmin(() => new Response(null, { status: 500 })).fetcher);

    const error = (await client.get("/userprofile-service/userprofile/settings").catch((e) => e)) as GarminError;

    expect(error).toBeInstanceOf(GarminError);
    expect(error.status).toBe(500);
  });
});
