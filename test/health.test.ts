import { describe, expect, it } from "vitest";
import { dateRange, mergeDailyHealth } from "../src/summaries";

describe("dateRange", () => {
  it("includes both ends and crosses month boundaries", () => {
    expect(dateRange("2026-09-29", "2026-10-02")).toEqual(["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
  });

  it("is empty when the end is before the start", () => {
    expect(dateRange("2026-10-02", "2026-10-01")).toEqual([]);
  });
});

describe("mergeDailyHealth", () => {
  const data = {
    summaries: [
      {
        calendarDate: "2026-10-16",
        heartRate: { minValue: 41, maxValue: 103, restingValue: 43 },
        stress: { avgLevel: 23, maxLevel: 97, qualifier: "balanced" },
        bodyBattery: { minValue: 42, maxValue: 93, chargedValue: 47, drainedValue: 51, latestValue: 49 },
        movement: { steps: { value: 2174 } },
        intensityMinutes: { moderate: 10, vigorous: 20 }
      }
    ],
    sleep: [
      {
        calendarDate: "2026-10-16",
        sleepTimeSeconds: 23760,
        deepSleepSeconds: 3060,
        remSleepSeconds: 4200,
        lightSleepSeconds: 15600,
        awakeSleepSeconds: 900,
        avgHeartRate: 49,
        averageRespirationValue: 13.04,
        sleepScores: { overall: { value: 74, qualifierKey: "FAIR" } },
        sleepNeed: { actual: 500 }
      }
    ],
    hrv: [
      {
        calendarDate: "2026-10-16",
        lastNightAvg: 50,
        weeklyAvg: 52,
        status: "UNBALANCED",
        baseline: { balancedLow: 53, balancedUpper: 68 }
      }
    ]
  };

  it("joins the three sources into one record per day", () => {
    const [day] = mergeDailyHealth("2026-10-16", "2026-10-16", data);

    expect(day).toMatchObject({
      date: "2026-10-16",
      restingHr: 43,
      hrv: { lastNightAvgMs: 50, weeklyAvgMs: 52, status: "UNBALANCED", balancedRangeMs: [53, 68] },
      sleep: { score: 74, quality: "FAIR", totalHours: 6.6, deepMin: 51, remMin: 70, lightMin: 260, awakeMin: 15, needMin: 500, avgHr: 49, respiration: 13 },
      bodyBattery: { high: 93, low: 42, charged: 47, drained: 51, endOfDay: 49 },
      stress: { average: 23, max: 97, qualifier: "balanced" },
      steps: 2174,
      moderateIntensityMin: 10,
      vigorousIntensityMin: 20
    });
  });

  it("returns every requested day, even ones Garmin has no data for", () => {
    const days = mergeDailyHealth("2026-10-15", "2026-10-16", data);

    expect(days.map((d) => d.date)).toEqual(["2026-10-15", "2026-10-16"]);
    expect(days[0]).toMatchObject({ date: "2026-10-15", restingHr: undefined, sleep: undefined, hrv: undefined });
  });
});
