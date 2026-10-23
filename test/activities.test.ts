import { describe, expect, it } from "vitest";
import { summarizeActivity, summarizeActivityDetail } from "../src/summaries";

describe("summarizeActivity", () => {
  it("converts Garmin's units into km, minutes and km/h", () => {
    const summary = summarizeActivity({
      activityId: 42,
      activityName: "Morning Run",
      activityType: { typeKey: "running" },
      startTimeLocal: "2026-10-17 07:12:00",
      distance: 10234.5,
      duration: 3005.2,
      averageSpeed: 3.405,
      averageHR: 151,
      elevationGain: 87.6,
      activityTrainingLoad: 143.27,
      hrTimeInZone_1: 120,
      hrTimeInZone_2: 1500.4,
      hrTimeInZone_3: 900,
      hrTimeInZone_4: 0,
      hrTimeInZone_5: null,
      summarizedExerciseSets: [{ category: "SQUAT", sets: 3, reps: 24, maxWeight: 80000 }]
    });

    expect(summary).toMatchObject({
      id: 42,
      name: "Morning Run",
      type: "running",
      start: "2026-10-17 07:12:00",
      distanceKm: 10.23,
      durationMin: 50.1,
      averageSpeedKmh: 12.3,
      averageHr: 151,
      elevationGainM: 88,
      trainingLoad: 143,
      hrZoneMinutes: [2, 25, 15, 0, 0],
      exerciseSets: [{ exercise: "SQUAT", sets: 3, reps: 24, maxWeight: 80000 }]
    });
  });

  it("leaves out metrics Garmin sends as null instead of reporting zero", () => {
    const summary = summarizeActivity({ activityId: 7, distance: null, averageSpeed: null, avgPower: null });

    expect(summary.distanceKm).toBeUndefined();
    expect(summary.averageSpeedKmh).toBeUndefined();
    expect(summary.averagePowerW).toBeUndefined();
    expect(summary.hrZoneMinutes).toBeUndefined();
    expect(summary.exerciseSets).toBeUndefined();
  });
});

describe("summarizeActivityDetail", () => {
  const detail = {
    activityId: 1,
    activityName: "Townsend",
    activityTypeDTO: { typeKey: "road_biking" },
    summaryDTO: { duration: 5400, averagePower: 217, normalizedPower: 219, trainingStressScore: 67.4, intensityFactor: 0.671 }
  };

  it("includes power metrics", () => {
    expect(summarizeActivityDetail(detail)).toMatchObject({
      durationMin: 90,
      averagePowerW: 217,
      normalizedPowerW: 219,
      trainingStressScore: 67,
      intensityFactor: 0.67
    });
  });

  it("sums up the workout's intervals by type", () => {
    const summary = summarizeActivityDetail({
      ...detail,
      splitSummaries: [
        { splitType: "INTERVAL_WARMUP", noOfSplits: 1, duration: 720, averageHR: 155, averagePower: 250 },
        { splitType: "INTERVAL_ACTIVE", noOfSplits: 4, duration: 6376.354, distance: 52310, averageHR: 149, maxHR: 171, averagePower: 223.599 }
      ]
    });

    expect(summary.intervals).toEqual([
      { type: "WARMUP", count: 1, durationMin: 12, averageHr: 155, averagePowerW: 250 },
      { type: "ACTIVE", count: 4, durationMin: 106.3, distanceKm: 52.31, averageHr: 149, maxHr: 171, averagePowerW: 224 }
    ]);
  });

  it("leaves out Garmin's other split groupings, such as by surface", () => {
    const summary = summarizeActivityDetail({
      ...detail,
      splitSummaries: [{ splitType: "SURFACE_TYPE_PAVED", noOfSplits: 4, duration: 11204 }]
    });

    expect(summary.intervals).toEqual([]);
  });
});
