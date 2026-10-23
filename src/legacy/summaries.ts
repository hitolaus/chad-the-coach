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
    vo2Max: a.vO2MaxValue ?? undefined
  };
}

export interface GarminActivityDetail {
  activityId: number;
  activityName?: string;
  activityTypeDTO?: { typeKey?: string };
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

export interface GarminLap {
  lapIndex?: number;
  distance?: Num;
  duration?: Num;
  averageSpeed?: Num;
  averageHR?: Num;
  maxHR?: Num;
  averagePower?: Num;
  averageBikeCadence?: Num;
  averageRunCadence?: Num;
  elevationGain?: Num;
}

export interface GarminHrZone {
  zoneNumber: number;
  secsInZone?: Num;
  zoneLowBoundary?: Num;
}

export interface GarminExerciseSet {
  setType?: string;
  duration?: Num;
  repetitionCount?: Num;
  weight?: Num;
  exercises?: { category?: string; name?: string | null }[];
}

export function summarizeActivityDetail(
  detail: GarminActivityDetail,
  laps: GarminLap[],
  zones: GarminHrZone[],
  sets: GarminExerciseSet[] | undefined
) {
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
    hrZones: zones.map((z) => ({ zone: z.zoneNumber, fromBpm: z.zoneLowBoundary ?? undefined, minutes: scaled(z.secsInZone, 1 / 60, 1) })),
    laps: laps.map((lap) => ({
      lap: lap.lapIndex,
      distanceKm: scaled(lap.distance, 1 / 1000, 2),
      durationMin: scaled(lap.duration, 1 / 60, 1),
      averageSpeedKmh: scaled(lap.averageSpeed, 3.6, 1),
      averageHr: lap.averageHR ?? undefined,
      maxHr: lap.maxHR ?? undefined,
      averagePowerW: lap.averagePower ?? undefined,
      averageCadence: lap.averageBikeCadence ?? lap.averageRunCadence ?? undefined
    })),
    exerciseSets: sets
      ?.filter((set) => set.setType === "ACTIVE")
      .map((set) => ({
        exercise: set.exercises?.[0]?.name ?? set.exercises?.[0]?.category,
        reps: set.repetitionCount ?? undefined,
        // Unit unconfirmed (Garmin stores workout weights in grams), so passed through as is.
        weight: set.weight ?? undefined,
        durationSec: scaled(set.duration, 1, 0)
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
  values?: {
    sleepScore?: Num;
    sleepScoreQuality?: string;
    totalSleepTimeInSeconds?: Num;
    deepTime?: Num;
    remTime?: Num;
    lightTime?: Num;
    awakeTime?: Num;
    sleepNeed?: Num;
    restingHeartRate?: Num;
    avgHeartRate?: Num;
    avgOvernightHrv?: Num;
    bodyBatteryChange?: Num;
    respiration?: Num;
    skinTempC?: Num;
  };
}

export interface GarminHrvDay {
  calendarDate: string;
  lastNightAvg?: Num;
  lastNight5MinHigh?: Num;
  weeklyAvg?: Num;
  status?: string;
  baseline?: { balancedLow?: Num; balancedUpper?: Num };
}

export interface GarminReadiness {
  calendarDate: string;
  timestamp?: string;
  inputContext?: string | null;
  score?: Num;
  level?: string;
  feedbackShort?: string;
  acuteLoad?: Num;
  hrvFactorFeedback?: string;
  sleepHistoryFactorFeedback?: string;
  stressHistoryFactorFeedback?: string;
}

// Training readiness is recalculated during the day; the morning value is the one that
// reflects the night's recovery.
function morningReadiness(entries: GarminReadiness[]): GarminReadiness | undefined {
  return (
    entries.find((e) => e.inputContext === "AFTER_WAKEUP_RESET") ??
    [...entries].sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? ""))[0]
  );
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
    readiness: GarminReadiness[];
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
  const readiness = byDate(data.readiness);

  return dateRange(start, end).map((date) => {
    const day = summaries.get(date)?.[0];
    const night = sleep.get(date)?.[0]?.values;
    const hrvDay = hrv.get(date)?.[0];
    const ready = morningReadiness(readiness.get(date) ?? []);
    return {
      date,
      restingHr: day?.heartRate?.restingValue ?? night?.restingHeartRate ?? undefined,
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
        score: night.sleepScore ?? undefined,
        quality: night.sleepScoreQuality,
        totalHours: hours(night.totalSleepTimeInSeconds),
        deepMin: minutes(night.deepTime),
        remMin: minutes(night.remTime),
        lightMin: minutes(night.lightTime),
        awakeMin: minutes(night.awakeTime),
        needMin: night.sleepNeed ?? undefined,
        avgHr: night.avgHeartRate ?? undefined,
        bodyBatteryGained: night.bodyBatteryChange ?? undefined,
        respiration: scaled(night.respiration, 1, 1),
        skinTempDeviationC: night.skinTempC ?? undefined
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
      trainingReadiness: ready && {
        score: ready.score ?? undefined,
        level: ready.level,
        feedback: ready.feedbackShort,
        acuteLoad: ready.acuteLoad ?? undefined,
        hrvFactor: ready.hrvFactorFeedback,
        sleepHistoryFactor: ready.sleepHistoryFactorFeedback,
        stressHistoryFactor: ready.stressHistoryFactorFeedback
      },
      steps: day?.movement?.steps?.value ?? undefined,
      activeCalories: day?.calories?.burnedActive ?? undefined,
      moderateIntensityMin: day?.intensityMinutes?.moderate ?? undefined,
      vigorousIntensityMin: day?.intensityMinutes?.vigorous ?? undefined,
      respiration: day?.respiration?.avgValue ?? undefined
    };
  });
}

// ---------- training status ----------

interface DeviceKeyed<T> {
  [deviceId: string]: T;
}

export interface GarminTrainingStatus {
  mostRecentVO2Max?: {
    generic?: { calendarDate?: string; vo2MaxPreciseValue?: Num; fitnessAge?: Num } | null;
    cycling?: { calendarDate?: string; vo2MaxPreciseValue?: Num } | null;
  } | null;
  mostRecentTrainingLoadBalance?: {
    metricsTrainingLoadBalanceDTOMap?: DeviceKeyed<{
      calendarDate?: string;
      monthlyLoadAerobicLow?: Num;
      monthlyLoadAerobicHigh?: Num;
      monthlyLoadAnaerobic?: Num;
      monthlyLoadAerobicLowTargetMin?: Num;
      monthlyLoadAerobicLowTargetMax?: Num;
      monthlyLoadAerobicHighTargetMin?: Num;
      monthlyLoadAerobicHighTargetMax?: Num;
      monthlyLoadAnaerobicTargetMin?: Num;
      monthlyLoadAnaerobicTargetMax?: Num;
      trainingBalanceFeedbackPhrase?: string;
    }> | null;
    recordedDevices?: { deviceId: number; deviceName?: string }[];
  } | null;
  mostRecentTrainingStatus?: {
    latestTrainingStatusData?: DeviceKeyed<{
      calendarDate?: string;
      sinceDate?: string;
      sport?: string;
      weeklyTrainingLoad?: Num;
      loadTunnelMin?: Num;
      loadTunnelMax?: Num;
      trainingStatusFeedbackPhrase?: string;
      acuteTrainingLoadDTO?: {
        acwrStatus?: string;
        dailyTrainingLoadAcute?: Num;
        dailyTrainingLoadChronic?: Num;
        minTrainingLoadChronic?: Num;
        maxTrainingLoadChronic?: Num;
        dailyAcuteChronicWorkloadRatio?: Num;
      } | null;
    }> | null;
    recordedDevices?: { deviceId: number; deviceName?: string }[];
  } | null;
}

const round = (value: Num) => scaled(value, 1, 0);

export function summarizeTrainingStatus(data: GarminTrainingStatus) {
  const devices = new Map<string, string | undefined>();
  for (const d of [
    ...(data.mostRecentTrainingStatus?.recordedDevices ?? []),
    ...(data.mostRecentTrainingLoadBalance?.recordedDevices ?? [])
  ]) {
    devices.set(String(d.deviceId), d.deviceName);
  }
  const vo2 = data.mostRecentVO2Max;
  return {
    vo2Max: {
      general: vo2?.generic?.vo2MaxPreciseValue != null ? { value: vo2.generic.vo2MaxPreciseValue, date: vo2.generic.calendarDate } : undefined,
      cycling: vo2?.cycling?.vo2MaxPreciseValue != null ? { value: vo2.cycling.vo2MaxPreciseValue, date: vo2.cycling.calendarDate } : undefined,
      fitnessAge: vo2?.generic?.fitnessAge ?? undefined
    },
    trainingStatus: Object.entries(data.mostRecentTrainingStatus?.latestTrainingStatusData ?? {}).map(([deviceId, s]) => ({
      device: devices.get(deviceId) ?? deviceId,
      date: s.calendarDate,
      status: s.trainingStatusFeedbackPhrase,
      since: s.sinceDate,
      sport: s.sport,
      acuteLoad: round(s.acuteTrainingLoadDTO?.dailyTrainingLoadAcute),
      chronicLoad: round(s.acuteTrainingLoadDTO?.dailyTrainingLoadChronic),
      optimalChronicLoadRange:
        s.acuteTrainingLoadDTO?.minTrainingLoadChronic != null
          ? [round(s.acuteTrainingLoadDTO.minTrainingLoadChronic), round(s.acuteTrainingLoadDTO.maxTrainingLoadChronic)]
          : undefined,
      acuteChronicRatio: s.acuteTrainingLoadDTO?.dailyAcuteChronicWorkloadRatio ?? undefined,
      acuteChronicStatus: s.acuteTrainingLoadDTO?.acwrStatus
    })),
    fourWeekLoadFocus: Object.entries(data.mostRecentTrainingLoadBalance?.metricsTrainingLoadBalanceDTOMap ?? {}).map(
      ([deviceId, b]) => ({
        device: devices.get(deviceId) ?? deviceId,
        date: b.calendarDate,
        feedback: b.trainingBalanceFeedbackPhrase,
        lowAerobic: { load: round(b.monthlyLoadAerobicLow), target: [round(b.monthlyLoadAerobicLowTargetMin), round(b.monthlyLoadAerobicLowTargetMax)] },
        highAerobic: { load: round(b.monthlyLoadAerobicHigh), target: [round(b.monthlyLoadAerobicHighTargetMin), round(b.monthlyLoadAerobicHighTargetMax)] },
        anaerobic: { load: round(b.monthlyLoadAnaerobic), target: [round(b.monthlyLoadAnaerobicTargetMin), round(b.monthlyLoadAnaerobicTargetMax)] }
      })
    )
  };
}

export interface GarminMaxMet {
  generic?: { calendarDate?: string; vo2MaxPreciseValue?: Num } | null;
  cycling?: { calendarDate?: string; vo2MaxPreciseValue?: Num } | null;
}

export function summarizeVo2MaxHistory(rows: GarminMaxMet[]) {
  return rows
    .map((row) => ({
      date: row.generic?.calendarDate ?? row.cycling?.calendarDate,
      general: row.generic?.vo2MaxPreciseValue ?? undefined,
      cycling: row.cycling?.vo2MaxPreciseValue ?? undefined
    }))
    .filter((row) => row.date && (row.general !== undefined || row.cycling !== undefined));
}
