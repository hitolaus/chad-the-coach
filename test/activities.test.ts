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
      hrTimeInZone_5: null
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
      hrZoneMinutes: [2, 25, 15, 0, 0]
    });
  });

  it("leaves out metrics Garmin sends as null instead of reporting zero", () => {
    const summary = summarizeActivity({ activityId: 7, distance: null, averageSpeed: null, avgPower: null });

    expect(summary.distanceKm).toBeUndefined();
    expect(summary.averageSpeedKmh).toBeUndefined();
    expect(summary.averagePowerW).toBeUndefined();
    expect(summary.hrZoneMinutes).toBeUndefined();
  });
});

describe("summarizeActivityDetail", () => {
  const detail = {
    activityId: 1,
    activityName: "Townsend",
    activityTypeDTO: { typeKey: "indoor_cycling" },
    summaryDTO: { duration: 5400, averagePower: 217, normalizedPower: 219, trainingStressScore: 67.4, intensityFactor: 0.671 }
  };

  it("includes power metrics, HR zones and laps", () => {
    const summary = summarizeActivityDetail(
      detail,
      [{ lapIndex: 1, duration: 300, averageHR: 114, averagePower: 190, averageBikeCadence: 80 }],
      [{ zoneNumber: 2, secsInZone: 1830, zoneLowBoundary: 115 }],
      undefined
    );

    expect(summary).toMatchObject({
      durationMin: 90,
      averagePowerW: 217,
      normalizedPowerW: 219,
      trainingStressScore: 67,
      intensityFactor: 0.67,
      hrZones: [{ zone: 2, fromBpm: 115, minutes: 30.5 }],
      laps: [{ lap: 1, durationMin: 5, averageHr: 114, averagePowerW: 190, averageCadence: 80 }]
    });
    expect(summary.exerciseSets).toBeUndefined();
  });

  it("lists only the working sets of a strength session", () => {
    const summary = summarizeActivityDetail(detail, [], [], [
      { setType: "ACTIVE", repetitionCount: 10, duration: 40, exercises: [{ category: "SQUAT", name: "BARBELL_BACK_SQUAT" }] },
      { setType: "REST", duration: 90 }
    ]);

    expect(summary.exerciseSets).toEqual([{ exercise: "BARBELL_BACK_SQUAT", reps: 10, durationSec: 40, weight: undefined }]);
  });
});
