import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOKENS_KEY } from "../src/garmin";
import { MAX_HEALTH_DAYS } from "../src/mcp";
import { callTool } from "./helpers";

const realFetch = globalThis.fetch;
let garminRequests: string[];

// Stands in for Garmin's API: answers each path from `responses`, 404 otherwise.
function stubGarmin(responses: Record<string, unknown>) {
  garminRequests = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "connectapi.garmin.com") return realFetch(input, init);
    garminRequests.push(url.pathname + url.search);
    return url.pathname in responses ? Response.json(responses[url.pathname]) : new Response(null, { status: 404 });
  });
}

const futureToken = () => {
  const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, "");
  return `${encode({ alg: "RS256" })}.${encode({ exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
};

beforeEach(async () => {
  await env.OAUTH_KV.put(
    TOKENS_KEY,
    JSON.stringify({ di_token: futureToken(), di_refresh_token: "refresh", di_client_id: "CLIENT" })
  );
});

afterEach(() => vi.restoreAllMocks());

describe("get_daily_health", () => {
  it("joins Garmin's daily summary, sleep, HRV and readiness for each day", async () => {
    stubGarmin({
      "/usersummary-service/v2/dailysummaries": { data: [{ calendarDate: "2026-10-16", heartRate: { restingValue: 43 } }] },
      "/sleep-service/stats/sleep/daily/2026-10-16/2026-10-17": {
        individualStats: [{ calendarDate: "2026-10-17", values: { sleepScore: 61 } }]
      },
      "/hrv-service/hrv/daily/2026-10-16/2026-10-17": { hrvSummaries: [{ calendarDate: "2026-10-17", lastNightAvg: 48 }] },
      "/metrics-service/metrics/trainingreadiness/2026-10-16/2026-10-17": [{ calendarDate: "2026-10-17", score: 69 }]
    });

    const result = await callTool("get_daily_health", { start_date: "2026-10-16", end_date: "2026-10-17" });

    expect(result.isError).toBeFalsy();
    const days = JSON.parse(result.content[0].text);
    expect(days).toMatchObject([
      { date: "2026-10-16", restingHr: 43 },
      { date: "2026-10-17", sleep: { score: 61 }, hrv: { lastNightAvgMs: 48 }, trainingReadiness: { score: 69 } }
    ]);
  });

  it(`refuses ranges longer than ${MAX_HEALTH_DAYS} days without calling Garmin`, async () => {
    stubGarmin({});

    const result = await callTool("get_daily_health", { start_date: "2026-09-01", end_date: "2026-10-17" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(`at most ${MAX_HEALTH_DAYS} days`);
    expect(garminRequests).toEqual([]);
  });

  it("tells the model how to fix a missing Garmin sign-in", async () => {
    await env.OAUTH_KV.delete(TOKENS_KEY);
    stubGarmin({});

    const result = await callTool("get_daily_health", { start_date: "2026-10-16", end_date: "2026-10-17" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("garmin_login.py");
  });
});

describe("get_activities", () => {
  it("passes the date range and type filter to Garmin", async () => {
    stubGarmin({ "/activitylist-service/activities/search/activities": [{ activityId: 1, distance: 1000 }] });

    const result = await callTool("get_activities", {
      start_date: "2026-10-01",
      end_date: "2026-10-17",
      activity_type: "cycling",
      limit: 5
    });

    expect(JSON.parse(result.content[0].text)).toEqual([{ id: 1, distanceKm: 1 }]);
    const query = new URLSearchParams(garminRequests[0].split("?")[1]);
    expect(Object.fromEntries(query)).toEqual({
      start: "0",
      limit: "5",
      startDate: "2026-10-01",
      endDate: "2026-10-17",
      activityType: "cycling"
    });
  });
});

describe("get_activity_details", () => {
  it("still returns the summary when Garmin has no laps or zones for the activity", async () => {
    stubGarmin({ "/activity-service/activity/9": { activityId: 9, summaryDTO: { averageHR: 120 } } });

    const result = await callTool("get_activity_details", { activity_id: 9 });

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0].text)).toMatchObject({ id: 9, averageHr: 120, laps: [], hrZones: [] });
  });

  it("fetches exercise sets only for strength workouts", async () => {
    stubGarmin({
      "/activity-service/activity/9": { activityId: 9, activityTypeDTO: { typeKey: "strength_training" } },
      "/activity-service/activity/9/exerciseSets": { exerciseSets: [{ setType: "ACTIVE", repetitionCount: 8 }] }
    });

    const result = await callTool("get_activity_details", { activity_id: 9 });

    expect(JSON.parse(result.content[0].text).exerciseSets).toEqual([{ reps: 8 }]);
  });
});
