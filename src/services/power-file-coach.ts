import type { Pedaling, SidePedaling } from "./power-file-analysis.ts";
import { powerFileTitle, type PowerFileDetail, type PowerFileListItem } from "./power-file.ts";
import { dayKey } from "./day-key.ts";
import { roundLoad } from "./training-load.ts";

/*
 * The coach chat's reading of a power file (ADR 0057): the analysis the Power page shows, without
 * the chart series, in the words of `src/coaching/power-files.md`.
 */

const COACH_CURVE_SECONDS = new Set([5, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600, 7200, 10800]);
const MAX_LAPS = 40;
const MAX_GEARS = 12;
const CADENCE_BAND_RPM = 10;

const UNITS = {
  pcoMm:
    "Platform center offset in mm: positive toward the outside of the pedal, negative toward the crank.",
  angles:
    "Crank angles in degrees: 0 with the pedal at the top, 90 forward (3 o'clock), 180 at the bottom.",
  rightPct: "The right leg's share of power, in %; the left's is 100 minus it.",
  timeS: "Seconds of pedaling or riding time.",
};

function share(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}

function round2(value: number | null) {
  return value == null ? null : Math.round(value * 100) / 100;
}

/** Torque effectiveness and pedal smoothness only when the file has them, as most don't. */
function side(pedal: SidePedaling) {
  return {
    pcoMm: pedal.pco,
    powerPhase: pedal.phase,
    peakPowerPhase: pedal.peak,
    ...(pedal.torqueEffectiveness == null
      ? {}
      : { torqueEffectivenessPct: pedal.torqueEffectiveness }),
    ...(pedal.pedalSmoothness == null ? {} : { pedalSmoothnessPct: pedal.pedalSmoothness }),
  };
}

function pedaling(value: Pedaling) {
  return {
    timeS: value.sec,
    avgWatts: value.avgWatts,
    avgCadence: value.avgCadence,
    rightPct: value.rightPct,
    left: side(value.left),
    right: side(value.right),
  };
}

/** Pedaling time in 10 rpm bands, as % of pedaling time; bands under 1 % are left out. */
function cadenceBands(histogram: [number, number][]) {
  const bands = new Map<number, number>();
  for (const [rpm, seconds] of histogram) {
    const band = Math.floor(rpm / CADENCE_BAND_RPM) * CADENCE_BAND_RPM;
    bands.set(band, (bands.get(band) ?? 0) + seconds);
  }
  const total = [...bands.values()].reduce((sum, seconds) => sum + seconds, 0);
  return [...bands]
    .sort(([a], [b]) => a - b)
    .map(([rpm, seconds]) => ({
      rpm: `${rpm}–${rpm + CADENCE_BAND_RPM - 1}`,
      pct: share(seconds, total),
    }))
    .filter((band) => band.pct >= 1);
}

export function powerFileForCoach(file: PowerFileDetail, timeZone: string) {
  const view = file.analysis;
  const weight = view.weightKg?.value ?? null;
  return {
    id: file.id,
    title: powerFileTitle({ activity: file.activity, start: view.start }),
    day: dayKey(new Date(view.start), timeZone),
    start: view.start,
    /** The synced ride it belongs to, read with the activity tools. */
    activity: file.activity,
    units: UNITS,
    ride: {
      sportType: view.sportType,
      movingS: view.movingSec,
      elapsedS: view.elapsedSec,
      distanceKm: view.distanceM == null ? null : Math.round(view.distanceM / 100) / 10,
      ascentM: view.ascentM,
      avgSpeedKmh: view.avgSpeedKmh,
      temperatureC: view.temperature,
      calories: view.calories,
    },
    anchors: { ftp: view.ftp, weightKg: view.weightKg },
    power: {
      avgWatts: view.power.avg,
      normalizedWatts: view.power.normalized,
      maxWatts: view.power.max,
      workKj: view.power.workKj,
      intensityFactor: round2(view.power.intensityFactor),
      variabilityIndex: round2(view.power.variabilityIndex),
      efficiencyFactor: view.power.efficiencyFactor,
      trainingLoad: view.power.tss == null ? null : roundLoad(view.power.tss),
      curve: view.power.curve
        .filter((best) => COACH_CURVE_SECONDS.has(best.seconds))
        .map((best) => ({
          seconds: best.seconds,
          watts: best.watts,
          wPerKg: weight ? round2(best.watts / weight) : null,
        })),
    },
    zones: view.zones.map((zone) => ({
      zone: zone.id,
      minWatts: zone.minWatts,
      maxWatts: zone.maxWatts,
      pctOfTime: zone.pct,
    })),
    pedaling: {
      overall: pedaling(view.pedaling.overall),
      /** The same metrics in each zone with at least 30 s, to compare at similar power. */
      byZone: view.zones
        .filter((zone) => zone.sec >= 30)
        .map((zone) => ({ zone: zone.id, ...pedaling(zone) })),
      seated: view.pedaling.seated ? pedaling(view.pedaling.seated) : null,
      standing: view.pedaling.standing ? pedaling(view.pedaling.standing) : null,
      standCount: view.standCount,
    },
    cadence: view.cadence
      ? {
          avg: view.cadence.avg,
          max: view.cadence.max,
          coastingS: view.cadence.coastingSec,
          bands: cadenceBands(view.cadence.histogram),
        }
      : null,
    torqueNm: view.torque,
    quadrants: view.quadrants
      ? {
          cadenceLine: view.quadrants.cadence,
          torqueLineNm: view.quadrants.torque,
          pct: {
            highForceFast: view.quadrants.pct[0],
            highForceSlow: view.quadrants.pct[1],
            lowForceSlow: view.quadrants.pct[2],
            lowForceFast: view.quadrants.pct[3],
          },
        }
      : null,
    heart: view.heart,
    breathing: view.respiration,
    garminTrainingEffect: view.trainingEffect,
    terrain: view.terrain?.bands ?? null,
    laps: view.laps.slice(0, MAX_LAPS),
    gears: view.gears
      ? {
          chainrings: view.gears.chainrings,
          cogs: view.gears.cogs,
          frontShifts: view.gears.frontShifts,
          rearShifts: view.gears.rearShifts,
          crossChainS: view.gears.crossChainSec,
          mostUsed: [...view.gears.uses].sort((a, b) => b.sec - a.sec).slice(0, MAX_GEARS),
        }
      : null,
    recording: {
      headUnit: view.device,
      powerMeter: view.powerMeter,
      samples: view.quality.samples,
      missingPowerS: view.quality.missingPowerSec,
      balancePct: view.quality.balancePct,
      dynamicsPct: view.quality.dynamicsPct,
    },
  };
}

export function powerFilesForCoach(files: PowerFileListItem[], timeZone: string, limit: number) {
  return {
    total: files.length,
    powerFiles: files.slice(0, limit).map((file) => ({
      id: file.id,
      title: powerFileTitle(file),
      day: dayKey(new Date(file.start), timeZone),
      activityId: file.activity?.id ?? null,
      movingS: file.movingSec,
      distanceKm: file.distanceM == null ? null : Math.round(file.distanceM / 100) / 10,
      avgWatts: file.avgWatts,
      normalizedWatts: file.normalizedWatts,
      rightPct: file.rightPct,
    })),
  };
}
