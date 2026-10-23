// Turns Garmin's API responses into compact records for the model. Field names follow
// what Garmin returns (checked against live responses); missing metrics come back as null.

type Num = number | null | undefined;

// Garmin sends null for metrics it doesn't have; leave those out rather than report zero.
const scaled = (value: Num, factor: number, digits: number) =>
  value == null ? undefined : Number((value * factor).toFixed(digits));
const minutes = (seconds: Num) => scaled(seconds, 1 / 60, 0);
const hours = (seconds: Num) => scaled(seconds, 1 / 3600, 2);

// ---------- activities ----------

export interface GarminActivity {
  activityId: number;
  activityName?: string;
  activityType?: { typeKey?: string };
  startTimeLocal?: string;
  distance?: Num;
  duration?: Num;
  movingDuration?: Num;
  averageSpeed?: Num;
  averageHR?: Num;
  maxHR?: Num;
  calories?: Num;
  elevationGain?: Num;
  avgPower?: Num;
  normPower?: Num;
  trainingStressScore?: Num;
  intensityFactor?: Num;
  aerobicTrainingEffect?: Num;
  anaerobicTrainingEffect?: Num;
  trainingEffectLabel?: string | null;
  activityTrainingLoad?: Num;
  vO2MaxValue?: Num;
  hrTimeInZone_1?: Num;
  hrTimeInZone_2?: Num;
  hrTimeInZone_3?: Num;
  hrTimeInZone_4?: Num;
  hrTimeInZone_5?: Num;
  summarizedExerciseSets?: { category?: string; sets?: Num; reps?: Num; maxWeight?: Num }[];
}

export function summarizeActivity(a: GarminActivity) {
  const zones = [a.hrTimeInZone_1, a.hrTimeInZone_2, a.hrTimeInZone_3, a.hrTimeInZone_4, a.hrTimeInZone_5];
  return {
    id: a.activityId,
    name: a.activityName,
    type: a.activityType?.typeKey,
    start: a.startTimeLocal,
    distanceKm: scaled(a.distance, 1 / 1000, 2),
    durationMin: scaled(a.duration, 1 / 60, 1),
    averageSpeedKmh: scaled(a.averageSpeed, 3.6, 1),
    averageHr: a.averageHR ?? undefined,
    maxHr: a.maxHR ?? undefined,
    hrZoneMinutes: zones.some((z) => z != null) ? zones.map((z) => minutes(z) ?? 0) : undefined,
    averagePowerW: a.avgPower ?? undefined,
    normalizedPowerW: a.normPower ?? undefined,
    trainingStressScore: scaled(a.trainingStressScore, 1, 0),
    intensityFactor: scaled(a.intensityFactor, 1, 2),
    calories: a.calories ?? undefined,
    elevationGainM: scaled(a.elevationGain, 1, 0),
    aerobicTrainingEffect: scaled(a.aerobicTrainingEffect, 1, 1),
    anaerobicTrainingEffect: scaled(a.anaerobicTrainingEffect, 1, 1),
    trainingEffectLabel: a.trainingEffectLabel ?? undefined,
    trainingLoad: scaled(a.activityTrainingLoad, 1, 0),
    vo2Max: a.vO2MaxValue ?? undefined,
    exerciseSets: a.summarizedExerciseSets?.length
      ? a.summarizedExerciseSets.map((set) => ({
          exercise: set.category,
          sets: set.sets ?? undefined,
          reps: set.reps ?? undefined,
          // Unit unconfirmed (Garmin stores workout weights in grams), so passed through as is.
          maxWeight: set.maxWeight ?? undefined
        }))
      : undefined
  };
}

export interface GarminActivityDetail {
  activityId: number;
  activityName?: string;
  activityTypeDTO?: { typeKey?: string };
  splitSummaries?: GarminSplitSummary[];
  summaryDTO?: {
    startTimeLocal?: string;
    distance?: Num;
    duration?: Num;
    movingDuration?: Num;
    averageSpeed?: Num;
    averageHR?: Num;
    maxHR?: Num;
    minHR?: Num;
    averageBikeCadence?: Num;
    averageRunCadence?: Num;
    averagePower?: Num;
    normalizedPower?: Num;
    functionalThresholdPower?: Num;
    trainingStressScore?: Num;
    intensityFactor?: Num;
    trainingEffect?: Num;
    anaerobicTrainingEffect?: Num;
    trainingEffectLabel?: string | null;
    activityTrainingLoad?: Num;
    calories?: Num;
    elevationGain?: Num;
  };
}

// Garmin groups an activity's splits several ways (by surface, climb...); the INTERVAL_ groups
// are the workout's structure: warm-up, work, rest, recovery and cool-down.
export interface GarminSplitSummary {
  splitType?: string;
  noOfSplits?: Num;
  distance?: Num;
  duration?: Num;
  averageHR?: Num;
  maxHR?: Num;
  averagePower?: Num;
}

export function summarizeActivityDetail(detail: GarminActivityDetail) {
  const s = detail.summaryDTO ?? {};
  return {
    id: detail.activityId,
    name: detail.activityName,
    type: detail.activityTypeDTO?.typeKey,
    start: s.startTimeLocal,
    distanceKm: scaled(s.distance, 1 / 1000, 2),
    durationMin: scaled(s.duration, 1 / 60, 1),
    movingDurationMin: scaled(s.movingDuration, 1 / 60, 1),
    averageSpeedKmh: scaled(s.averageSpeed, 3.6, 1),
    averageHr: s.averageHR ?? undefined,
    maxHr: s.maxHR ?? undefined,
    minHr: s.minHR ?? undefined,
    averageCadence: s.averageBikeCadence ?? s.averageRunCadence ?? undefined,
    averagePowerW: s.averagePower ?? undefined,
    normalizedPowerW: s.normalizedPower ?? undefined,
    ftpW: s.functionalThresholdPower ?? undefined,
    trainingStressScore: scaled(s.trainingStressScore, 1, 0),
    intensityFactor: scaled(s.intensityFactor, 1, 2),
    aerobicTrainingEffect: scaled(s.trainingEffect, 1, 1),
    anaerobicTrainingEffect: scaled(s.anaerobicTrainingEffect, 1, 1),
    trainingEffectLabel: s.trainingEffectLabel ?? undefined,
    trainingLoad: scaled(s.activityTrainingLoad, 1, 0),
    calories: s.calories ?? undefined,
    elevationGainM: scaled(s.elevationGain, 1, 0),
    intervals: (detail.splitSummaries ?? [])
      .filter((split) => split.splitType?.startsWith("INTERVAL_"))
      .map((split) => ({
        type: split.splitType!.slice("INTERVAL_".length),
        count: split.noOfSplits ?? undefined,
        durationMin: scaled(split.duration, 1 / 60, 1),
        distanceKm: scaled(split.distance, 1 / 1000, 2),
        averageHr: split.averageHR ?? undefined,
        maxHr: split.maxHR ?? undefined,
        averagePowerW: scaled(split.averagePower, 1, 0)
      }))
  };
}

// ---------- daily health ----------

export interface GarminDailySummary {
  calendarDate: string;
  movement?: { steps?: { value?: Num } };
  calories?: { burnedActive?: Num; burnedTotal?: Num };
  heartRate?: { minValue?: Num; maxValue?: Num; restingValue?: Num };
  intensityMinutes?: { moderate?: Num; vigorous?: Num };
  stress?: { avgLevel?: Num; maxLevel?: Num; qualifier?: string };
  bodyBattery?: { minValue?: Num; maxValue?: Num; chargedValue?: Num; drainedValue?: Num; latestValue?: Num };
  respiration?: { avgValue?: Num };
}

export interface GarminSleepDay {
  calendarDate: string;
  sleepTimeSeconds?: Num;
  deepSleepSeconds?: Num;
  remSleepSeconds?: Num;
  lightSleepSeconds?: Num;
  awakeSleepSeconds?: Num;
  avgHeartRate?: Num;
  averageRespirationValue?: Num;
  sleepScores?: { overall?: { value?: Num; qualifierKey?: string } };
  sleepNeed?: { actual?: Num };
}

export interface GarminHrvDay {
  calendarDate: string;
  lastNightAvg?: Num;
  lastNight5MinHigh?: Num;
  weeklyAvg?: Num;
  status?: string;
  baseline?: { balancedLow?: Num; balancedUpper?: Num };
}

export function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let d = new Date(`${start}T00:00:00Z`); d <= new Date(`${end}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

export function mergeDailyHealth(
  start: string,
  end: string,
  data: {
    summaries: GarminDailySummary[];
    sleep: GarminSleepDay[];
    hrv: GarminHrvDay[];
  }
) {
  const byDate = <T extends { calendarDate: string }>(rows: T[]) => {
    const map = new Map<string, T[]>();
    for (const row of rows) map.set(row.calendarDate, [...(map.get(row.calendarDate) ?? []), row]);
    return map;
  };
  const summaries = byDate(data.summaries);
  const sleep = byDate(data.sleep);
  const hrv = byDate(data.hrv);

  return dateRange(start, end).map((date) => {
    const day = summaries.get(date)?.[0];
    const night = sleep.get(date)?.[0];
    const hrvDay = hrv.get(date)?.[0];
    return {
      date,
      restingHr: day?.heartRate?.restingValue ?? undefined,
      minHr: day?.heartRate?.minValue ?? undefined,
      maxHr: day?.heartRate?.maxValue ?? undefined,
      hrv: hrvDay && {
        lastNightAvgMs: hrvDay.lastNightAvg ?? undefined,
        lastNight5MinHighMs: hrvDay.lastNight5MinHigh ?? undefined,
        weeklyAvgMs: hrvDay.weeklyAvg ?? undefined,
        status: hrvDay.status,
        balancedRangeMs:
          hrvDay.baseline?.balancedLow != null ? [hrvDay.baseline.balancedLow, hrvDay.baseline.balancedUpper] : undefined
      },
      sleep: night && {
        score: night.sleepScores?.overall?.value ?? undefined,
        quality: night.sleepScores?.overall?.qualifierKey,
        totalHours: hours(night.sleepTimeSeconds),
        deepMin: minutes(night.deepSleepSeconds),
        remMin: minutes(night.remSleepSeconds),
        lightMin: minutes(night.lightSleepSeconds),
        awakeMin: minutes(night.awakeSleepSeconds),
        needMin: night.sleepNeed?.actual ?? undefined,
        avgHr: night.avgHeartRate ?? undefined,
        respiration: scaled(night.averageRespirationValue, 1, 1)
      },
      bodyBattery: day?.bodyBattery && {
        high: day.bodyBattery.maxValue ?? undefined,
        low: day.bodyBattery.minValue ?? undefined,
        charged: day.bodyBattery.chargedValue ?? undefined,
        drained: day.bodyBattery.drainedValue ?? undefined,
        endOfDay: day.bodyBattery.latestValue ?? undefined
      },
      stress: day?.stress && {
        average: day.stress.avgLevel ?? undefined,
        max: day.stress.maxLevel ?? undefined,
        qualifier: day.stress.qualifier
      },
      steps: day?.movement?.steps?.value ?? undefined,
      activeCalories: day?.calories?.burnedActive ?? undefined,
      moderateIntensityMin: day?.intensityMinutes?.moderate ?? undefined,
      vigorousIntensityMin: day?.intensityMinutes?.vigorous ?? undefined,
      respiration: day?.respiration?.avgValue ?? undefined
    };
  });
}
