import { McpServer } from "@modelcontextprotocol/server";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { GarminClient, GarminError } from "./garmin";
import { registerLegacyTools } from "./legacy/tools";
import {
  dateRange,
  mergeDailyHealth,
  summarizeActivity,
  summarizeActivityDetail,
  type GarminActivity,
  type GarminActivityDetail,
  type GarminDailySummary,
  type GarminHrvDay,
  type GarminSleepDay
} from "./summaries";

// Garmin's sleep summaries endpoint answers an empty object for long ranges; 28 days is safe.
export const MAX_HEALTH_DAYS = 28;

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("Date as YYYY-MM-DD, in the user's local time");

const readOnly = { readOnlyHint: true, openWorldHint: false };

export function createServer() {
  const server = new McpServer({ name: "chad-the-coach", version: "0.2.0" });

  server.registerTool(
    "ping",
    {
      title: "Ping",
      description: "Checks that the Chad the Coach connection works. Returns the server time.",
      annotations: readOnly
    },
    async () => ({
      content: [{ type: "text", text: `pong from chad-the-coach at ${new Date().toISOString()}` }]
    })
  );

  // GARMIN_API is set in wrangler.jsonc.
  if (env.GARMIN_API === "legacy") registerLegacyTools(server);
  else registerPersonalTools(server);

  return server;
}

function registerPersonalTools(server: McpServer) {
  const garmin = new GarminClient(env.OAUTH_KV, env.GARMIN_API_KEY);

  server.registerTool(
    "get_activities",
    {
      title: "Activities",
      description:
        "Lists Garmin activities (rides, runs, strength sessions...), newest first: distance, duration, heart rate and minutes per HR zone, power, TSS, training effect, training load, VO2max when the activity updated it, and exercises with sets and reps for strength sessions. Without dates it returns the most recent ones.",
      inputSchema: z.object({
        start_date: date.optional(),
        end_date: date.optional(),
        activity_type: z
          .string()
          .optional()
          .describe("Garmin activity type filter, e.g. running, cycling, swimming, fitness_equipment, hiking, walking"),
        limit: z.number().int().min(1).max(100).default(20).describe("Maximum number of activities")
      }),
      annotations: readOnly
    },
    async ({ start_date, end_date, activity_type, limit }) =>
      garminResult(async () => {
        const activities = await garmin.get<GarminActivity[]>("/activitylist-service/activities/search/activities", {
          start: 0,
          limit,
          startDate: start_date,
          endDate: end_date,
          activityType: activity_type
        });
        return activities.map(summarizeActivity);
      })
  );

  server.registerTool(
    "get_activity_details",
    {
      title: "Activity details",
      description:
        "Full detail for one activity (id from get_activities): summary metrics including cadence and FTP, and for structured workouts the time, heart rate and power of the warm-up, work, rest, recovery and cool-down intervals.",
      inputSchema: z.object({ activity_id: z.number().int().describe("Garmin activity id") }),
      annotations: readOnly
    },
    async ({ activity_id }) =>
      garminResult(async () =>
        summarizeActivityDetail(await garmin.get<GarminActivityDetail>(`/activity-service/activity/${activity_id}`))
      )
  );

  server.registerTool(
    "get_daily_health",
    {
      title: "Daily health",
      description: `Day-by-day health and recovery for a date range (at most ${MAX_HEALTH_DAYS} days): resting heart rate, HRV (overnight average, weekly average, status, balanced range), sleep (score, duration, stages, sleep need), Body Battery, stress, steps and intensity minutes. Sleep and HRV on a date are for the night ending that morning. Use with get_activities to relate training to recovery.`,
      inputSchema: z.object({ start_date: date, end_date: date }),
      annotations: readOnly
    },
    async ({ start_date, end_date }) => {
      const days = dateRange(start_date, end_date).length;
      if (days === 0) return errorResult("end_date must not be before start_date.");
      if (days > MAX_HEALTH_DAYS) {
        return errorResult(`The range is ${days} days; ask for at most ${MAX_HEALTH_DAYS} days at a time.`);
      }
      return garminResult(async () => {
        const [summaries, sleep, hrv] = await Promise.all([
          garmin.get<{ data?: GarminDailySummary[] }>("/usersummary-service/v2/dailysummaries", {
            startDate: start_date,
            endDate: end_date
          }),
          garmin.get<GarminSleepDay[]>("/sleep-service/sleep/dailySleepSummariesByDate", {
            startDate: start_date,
            endDate: end_date
          }),
          garmin.get<{ hrvSummaries?: GarminHrvDay[] }>(`/hrv-service/hrv/daily/${start_date}/${end_date}`)
        ]);
        return mergeDailyHealth(start_date, end_date, {
          summaries: summaries?.data ?? [],
          sleep: Array.isArray(sleep) ? sleep : [],
          hrv: hrv?.hrvSummaries ?? []
        });
      });
    }
  );
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

async function garminResult(load: () => Promise<unknown>) {
  try {
    return { content: [{ type: "text" as const, text: JSON.stringify(await load()) }] };
  } catch (error) {
    if (error instanceof GarminError) return errorResult(error.message);
    throw error;
  }
}
