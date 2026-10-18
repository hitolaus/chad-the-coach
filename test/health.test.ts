import { describe, expect, it } from "vitest";
import { dateRange, mergeDailyHealth, summarizeTrainingStatus, summarizeVo2MaxHistory } from "../src/summaries";

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
        values: { sleepScore: 74, sleepScoreQuality: "FAIR", totalSleepTimeInSeconds: 23760, deepTime: 3060, remTime: 4200, bodyBatteryChange: 39 }
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
    ],
    readiness: [
      { calendarDate: "2026-10-16", timestamp: "2026-10-16T14:00:00.0", score: 40, level: "LOW" },
      { calendarDate: "2026-10-16", timestamp: "2026-10-16T06:45:00.0", score: 69, level: "MODERATE", feedbackShort: "LISTEN_TO_YOUR_BODY" }
    ]
  };

  it("joins the four sources into one record per day", () => {
    const [day] = mergeDailyHealth("2026-10-16", "2026-10-16", data);

    expect(day).toMatchObject({
      date: "2026-10-16",
      restingHr: 43,
      hrv: { lastNightAvgMs: 50, weeklyAvgMs: 52, status: "UNBALANCED", balancedRangeMs: [53, 68] },
      sleep: { score: 74, quality: "FAIR", totalHours: 6.6, deepMin: 51, remMin: 70, bodyBatteryGained: 39 },
      bodyBattery: { high: 93, low: 42, charged: 47, drained: 51, endOfDay: 49 },
      stress: { average: 23, max: 97, qualifier: "balanced" },
      steps: 2174,
      moderateIntensityMin: 10,
      vigorousIntensityMin: 20
    });
  });

  it("uses the morning training readiness, not a later recalculation", () => {
    const [day] = mergeDailyHealth("2026-10-16", "2026-10-16", data);

    expect(day.trainingReadiness).toMatchObject({ score: 69, level: "MODERATE", feedback: "LISTEN_TO_YOUR_BODY" });
  });

  it("prefers the entry Garmin marks as the after-wake-up reading", () => {
    const [day] = mergeDailyHealth("2026-10-16", "2026-10-16", {
      ...data,
      readiness: [
        { calendarDate: "2026-10-16", timestamp: "2026-10-16T05:00:00.0", score: 50 },
        { calendarDate: "2026-10-16", timestamp: "2026-10-16T07:00:00.0", score: 72, inputContext: "AFTER_WAKEUP_RESET" }
      ]
    });

    expect(day.trainingReadiness?.score).toBe(72);
  });

  it("returns every requested day, even ones Garmin has no data for", () => {
    const days = mergeDailyHealth("2026-10-15", "2026-10-16", data);

    expect(days.map((d) => d.date)).toEqual(["2026-10-15", "2026-10-16"]);
    expect(days[0]).toMatchObject({ date: "2026-10-15", restingHr: undefined, sleep: undefined, hrv: undefined });
  });

  it("falls back to the sleep resting heart rate when the daily summary has none", () => {
    const [day] = mergeDailyHealth("2026-10-16", "2026-10-16", {
      summaries: [],
      sleep: [{ calendarDate: "2026-10-16", values: { restingHeartRate: 47 } }],
      hrv: [],
      readiness: []
    });

    expect(day.restingHr).toBe(47);
  });
});

describe("summarizeTrainingStatus", () => {
  it("reports status, loads and load focus per device, named by device", () => {
    const summary = summarizeTrainingStatus({
      mostRecentVO2Max: {
        generic: { calendarDate: "2026-10-03", vo2MaxPreciseValue: 62.6, fitnessAge: 20 },
        cycling: { calendarDate: "2026-10-17", vo2MaxPreciseValue: 63 }
      },
      mostRecentTrainingStatus: {
        latestTrainingStatusData: {
          "3646114271": {
            calendarDate: "2026-10-17",
            sinceDate: "2026-10-14",
            sport: "CYCLING",
            trainingStatusFeedbackPhrase: "DETRAINING",
            acuteTrainingLoadDTO: {
              acwrStatus: "LOW",
              dailyTrainingLoadAcute: 186,
              dailyTrainingLoadChronic: 560,
              minTrainingLoadChronic: 448,
              maxTrainingLoadChronic: 840,
              dailyAcuteChronicWorkloadRatio: 0.3
            }
          }
        },
        recordedDevices: [{ deviceId: 3646114271, deviceName: "CIRQA Smart Band" }]
      },
      mostRecentTrainingLoadBalance: {
        metricsTrainingLoadBalanceDTOMap: {
          "3646114271": {
            calendarDate: "2026-10-17",
            monthlyLoadAerobicLow: 836.772,
            monthlyLoadAerobicLowTargetMin: 878,
            monthlyLoadAerobicLowTargetMax: 1931,
            trainingBalanceFeedbackPhrase: "AEROBIC_LOW_SHORTAGE"
          }
        }
      }
    });

    expect(summary.vo2Max).toEqual({
      general: { value: 62.6, date: "2026-10-03" },
      cycling: { value: 63, date: "2026-10-17" },
      fitnessAge: 20
    });
    expect(summary.trainingStatus).toEqual([
      {
        device: "CIRQA Smart Band",
        date: "2026-10-17",
        status: "DETRAINING",
        since: "2026-10-14",
        sport: "CYCLING",
        acuteLoad: 186,
        chronicLoad: 560,
        optimalChronicLoadRange: [448, 840],
        acuteChronicRatio: 0.3,
        acuteChronicStatus: "LOW"
      }
    ]);
    expect(summary.fourWeekLoadFocus[0]).toMatchObject({
      device: "CIRQA Smart Band",
      feedback: "AEROBIC_LOW_SHORTAGE",
      lowAerobic: { load: 837, target: [878, 1931] }
    });
  });
});

describe("summarizeVo2MaxHistory", () => {
  it("keeps only days with an estimate", () => {
    expect(
      summarizeVo2MaxHistory([
        { generic: null, cycling: { calendarDate: "2026-09-01", vo2MaxPreciseValue: 62 } },
        { generic: null, cycling: null }
      ])
    ).toEqual([{ date: "2026-09-01", general: undefined, cycling: 62 }]);
  });
});
