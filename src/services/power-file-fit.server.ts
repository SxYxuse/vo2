import { inflateRawSync } from "node:zlib";

import {
  Decoder,
  Stream,
  type DeviceInfoMesg,
  type EventMesg,
  type FitMessages,
  type LapMesg,
  type RecordMesg,
  type SessionMesg,
} from "@garmin/fitsdk";

import type {
  FitAngles,
  FitRide,
  FitSample,
  PowerFileLap,
  PowerMeterInfo,
} from "./power-file-analysis.ts";

/** A file the athlete picked that VO2 cannot analyse, with the reason in their words. */
export class PowerFileRejected extends Error {}

/** Garmin Connect's "Export original" is a zip holding the .fit; nothing larger is a ride. */
const MAX_FIT_BYTES = 50 * 1024 * 1024;

function u16(bytes: Uint8Array, at: number) {
  return bytes[at] | (bytes[at + 1] << 8);
}

function u32(bytes: Uint8Array, at: number) {
  return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
}

/** The first .fit file inside a zip, read from the central directory. */
function fitFromZip(bytes: Uint8Array): Uint8Array {
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65_557); at -= 1) {
    if (u32(bytes, at) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new PowerFileRejected("This zip could not be read.");
  let entry = u32(bytes, end + 16);
  for (let index = 0; index < u16(bytes, end + 10); index += 1) {
    if (u32(bytes, entry) !== 0x02014b50) break;
    const method = u16(bytes, entry + 10);
    const size = u32(bytes, entry + 20);
    const nameLength = u16(bytes, entry + 28);
    const name = new TextDecoder().decode(bytes.subarray(entry + 46, entry + 46 + nameLength));
    const local = u32(bytes, entry + 42);
    if (name.toLowerCase().endsWith(".fit") && u32(bytes, local) === 0x04034b50) {
      const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
      const data = bytes.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data, { maxOutputLength: MAX_FIT_BYTES });
      throw new PowerFileRejected("This zip is compressed in a way VO2 cannot read.");
    }
    entry += 46 + nameLength + u16(bytes, entry + 30) + u16(bytes, entry + 32);
  }
  throw new PowerFileRejected("This zip has no .fit file in it.");
}

/** The FIT bytes of an upload: the file itself, or the one inside Garmin's zip. */
export function fitBytes(upload: Uint8Array): Uint8Array {
  const zipped = upload[0] === 0x50 && upload[1] === 0x4b && upload[2] === 0x03;
  return zipped ? fitFromZip(upload) : upload;
}

const MAKERS: Record<string, string> = {
  faveroElectronics: "Favero",
  garmin: "Garmin",
  sram: "SRAM",
  srm: "SRM",
  quarq: "Quarq",
  "4iiiis": "4iiii",
  stagesCycling: "Stages",
  wahooFitness: "Wahoo",
  powertap: "PowerTap",
  rotor: "Rotor",
  pioneer: "Pioneer",
  shimano: "Shimano",
  magene: "Magene",
};

/** "edge540" → "Edge 540", "faveroElectronics" → "Favero Electronics". */
function humanize(value: string) {
  const spaced = value
    .replace(/([a-z])([A-Z0-9])/g, "$1 $2")
    .replace(/([0-9])([a-zA-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function makerName(manufacturer: unknown) {
  if (typeof manufacturer !== "string") return null;
  return MAKERS[manufacturer] ?? humanize(manufacturer);
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function time(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  return null;
}

/** Strava's sport type for the session, so VO2's ride rules (e-bikes, indoor) apply. */
function sportTypeOf(session: SessionMesg): string | null {
  const sport = String(session.sport ?? "");
  const sub = String(session.subSport ?? "");
  if (sport === "eBiking" || sub === "eBikeMountain" || sub === "eBikeFitness") {
    return sub === "eBikeMountain" ? "EMountainBikeRide" : "EBikeRide";
  }
  if (sport !== "cycling") return null;
  if (sub === "indoorCycling" || sub === "virtualActivity" || sub === "spin") return "VirtualRide";
  if (sub === "mountain" || sub === "downhill") return "MountainBikeRide";
  if (sub === "gravelCycling" || sub === "cyclocross") return "GravelRide";
  return "Ride";
}

function sportName(session: SessionMesg) {
  const sport = String(session.sport ?? "activity");
  return humanize(sport).toLowerCase();
}

/** `left_right_balance`: the low 7 bits are the right pedal's share when bit 7 says so. */
function rightShare(value: unknown) {
  const raw = num(value);
  if (raw == null || !(raw & 0x80)) return null;
  const pct = raw & 0x7f;
  return pct <= 100 ? pct : null;
}

/** `left_right_balance_100`: the same in hundredths of a percent, flagged by bit 15. */
function rightShare100(value: unknown) {
  const raw = num(value);
  if (raw == null || !(raw & 0x8000)) return null;
  const pct = Math.round((raw & 0x3fff) / 10) / 10;
  return pct <= 100 ? pct : null;
}

function angles(value: unknown): FitAngles | null {
  if (!Array.isArray(value)) return null;
  const start = num(value[0]);
  const end = num(value[1]);
  return start == null || end == null ? null : [start, end];
}

/** Lap and session phase arrays hold start, end, arc length, and center. */
function arcOf(value: unknown) {
  const arc = Array.isArray(value) ? num(value[2]) : null;
  return arc == null ? null : Math.round(arc);
}

/** Each record's position from the rider position events: standing until seated again. */
function positionAt(events: EventMesg[]) {
  const changes = events
    .filter((event) => event.event === "riderPositionChange")
    .flatMap((event) => {
      const at = time(event.timestamp);
      return at == null ? [] : [{ at, position: String(event.riderPosition) }];
    })
    .sort((a, b) => a.at - b.at);
  if (!changes.length) return null;
  let next = 0;
  let standing = false;
  return (at: number) => {
    while (next < changes.length && changes[next].at <= at) {
      const position = changes[next].position;
      // A rise can be abandoned ("transitionToStanding" then "seated"); Garmin counts the stand
      // from "standing" until the rider is back in the saddle.
      standing = position === "standing" || position === "transitionToSeated";
      next += 1;
    }
    return standing;
  };
}

function gearAt(events: EventMesg[]) {
  const changes = events
    .filter((event) => event.event === "rearGearChange" || event.event === "frontGearChange")
    .flatMap((event) => {
      const at = time(event.timestamp);
      const rear = num(event.rearGear);
      if (at == null || !rear) return [];
      return [{ at, gear: [num(event.frontGear) ?? 0, rear] as [number, number] }];
    })
    .sort((a, b) => a.at - b.at);
  if (!changes.length) return null;
  let next = 0;
  let gear: [number, number] | null = null;
  return (at: number) => {
    while (next < changes.length && changes[next].at <= at) gear = changes[next++].gear;
    return gear;
  };
}

function sampleOf(
  record: RecordMesg,
  startMs: number,
  standing: ((at: number) => boolean) | null,
  gear: ((at: number) => [number, number] | null) | null,
): FitSample | null {
  const at = time(record.timestamp);
  if (at == null) return null;
  return {
    t: (at - startMs) / 1000,
    watts: num(record.power),
    heartrate: num(record.heartRate),
    cadence: num(record.cadence),
    speed: num(record.enhancedSpeed) ?? num(record.speed),
    distance: num(record.distance),
    altitude: num(record.enhancedAltitude) ?? num(record.altitude),
    rightPct: rightShare(record.leftRightBalance),
    pcoLeft: num(record.leftPco),
    pcoRight: num(record.rightPco),
    phaseLeft: angles(record.leftPowerPhase),
    phaseRight: angles(record.rightPowerPhase),
    peakLeft: angles(record.leftPowerPhasePeak),
    peakRight: angles(record.rightPowerPhasePeak),
    teLeft: num(record.leftTorqueEffectiveness),
    teRight: num(record.rightTorqueEffectiveness),
    psLeft: num(record.leftPedalSmoothness),
    psRight: num(record.rightPedalSmoothness),
    standing: standing ? standing(at) : null,
    gear: gear ? gear(at) : null,
  };
}

function lapOf(lap: LapMesg, startMs: number): PowerFileLap {
  const speed = num(lap.enhancedAvgSpeed) ?? num(lap.avgSpeed);
  const lapStart = time(lap.startTime);
  return {
    startSec: lapStart == null ? 0 : Math.max(0, Math.round((lapStart - startMs) / 1000)),
    movingSec: Math.round(num(lap.totalTimerTime) ?? 0),
    distanceM: num(lap.totalDistance),
    avgWatts: num(lap.avgPower),
    normalizedWatts: num(lap.normalizedPower),
    maxWatts: num(lap.maxPower),
    avgHeartrate: num(lap.avgHeartRate),
    maxHeartrate: num(lap.maxHeartRate),
    avgCadence: num(lap.avgCadence),
    avgSpeedKmh: speed == null ? null : Math.round(speed * 36) / 10,
    ascentM: num(lap.totalAscent),
    rightPct: rightShare100(lap.leftRightBalance),
    pcoLeft: num(lap.avgLeftPco),
    pcoRight: num(lap.avgRightPco),
    arcLeft: arcOf(lap.avgLeftPowerPhase),
    arcRight: arcOf(lap.avgRightPowerPhase),
    standingSec: num(lap.timeStanding),
  };
}

function powerMeterOf(devices: DeviceInfoMesg[]): PowerMeterInfo | null {
  const meter = devices
    .filter(
      (device) =>
        device.antplusDeviceType === "bikePower" ||
        device.bleDeviceType === "bikePower" ||
        device.deviceType === 11,
    )
    .at(-1);
  if (!meter) return null;
  const firmware = num(meter.softwareVersion);
  return {
    maker: makerName(meter.manufacturer) ?? "Power meter",
    firmware: firmware == null ? null : String(firmware),
    battery: typeof meter.batteryStatus === "string" ? meter.batteryStatus : null,
  };
}

function deviceName(messages: FitMessages) {
  const file = messages.fileIdMesgs?.[0];
  if (!file) return null;
  const maker = makerName(file.manufacturer);
  if (typeof file.garminProduct === "string") return `Garmin ${humanize(file.garminProduct)}`;
  return maker;
}

function shiftsOf(session: SessionMesg, events: EventMesg[]) {
  const count = (kind: string) => events.filter((event) => event.event === kind).length;
  const front = num(session.frontGearShiftCount) ?? count("frontGearChange");
  const rear = num(session.rearGearShiftCount) ?? count("rearGearChange");
  return front || rear ? { front, rear } : null;
}

function triple(avg: unknown, min: unknown, max: unknown) {
  const values = { avg: num(avg), min: num(min), max: num(max) };
  return values.avg == null && values.min == null && values.max == null ? null : values;
}

/** Reads a ride from a FIT file into plain samples, or says why it cannot. */
export function readFitRide(bytes: Uint8Array): FitRide {
  const stream = Stream.fromByteArray(bytes);
  if (!Decoder.isFIT(stream)) {
    throw new PowerFileRejected("This is not a FIT file. Export the original file of a ride.");
  }
  const decoder = new Decoder(stream);
  const { messages, errors } = decoder.read({ convertTypesToStrings: true });
  const sessions = messages.sessionMesgs ?? [];
  if (!sessions.length) {
    throw new PowerFileRejected(
      errors.length
        ? "This FIT file is damaged and could not be read."
        : "This FIT file holds no activity.",
    );
  }
  const session = sessions.find((candidate) => sportTypeOf(candidate) != null);
  const sportType = session ? sportTypeOf(session) : null;
  if (!session || !sportType) {
    throw new PowerFileRejected(
      `This file is a ${sportName(sessions[0])}: only rides are analysed here.`,
    );
  }

  const startMs = time(session.startTime) ?? time(messages.recordMesgs?.[0]?.timestamp);
  if (startMs == null) throw new PowerFileRejected("This FIT file has no start time.");
  const elapsedSec = num(session.totalElapsedTime) ?? 0;
  const endMs = startMs + elapsedSec * 1000;
  const events = messages.eventMesgs ?? [];
  const standing = positionAt(events);
  const gear = gearAt(events);
  // A multisport file holds every leg; only the ride's records belong to it.
  const records = (messages.recordMesgs ?? []).filter((record) => {
    const at = time(record.timestamp);
    return at != null && (sessions.length === 1 || (at >= startMs && at <= endMs));
  });
  const samples = records.flatMap((record) => {
    const sample = sampleOf(record, startMs, standing, gear);
    return sample ? [sample] : [];
  });
  if (!samples.some((sample) => (sample.watts ?? 0) > 0)) {
    throw new PowerFileRejected("This ride has no power: VO2 analyses rides with a power meter.");
  }

  const zones = messages.zonesTargetMesgs?.[0];
  const profile = messages.userProfileMesgs?.[0];
  const laps = (messages.lapMesgs ?? []).filter((lap) => {
    const at = time(lap.startTime);
    return sessions.length === 1 || (at != null && at >= startMs && at < endMs);
  });
  return {
    start: new Date(startMs),
    sportType,
    elapsedSec,
    timerSec: num(session.totalTimerTime),
    distanceM: num(session.totalDistance),
    ascentM: num(session.totalAscent),
    calories: num(session.totalCalories),
    temperature: triple(session.avgTemperature, session.minTemperature, session.maxTemperature),
    trainingEffect:
      num(session.totalTrainingEffect) == null
        ? null
        : {
            aerobic: num(session.totalTrainingEffect),
            anaerobic: num(session.totalAnaerobicTrainingEffect),
          },
    respiration: triple(
      session.enhancedAvgRespirationRate,
      session.enhancedMinRespirationRate,
      session.enhancedMaxRespirationRate,
    ),
    ftp: num(zones?.functionalThresholdPower) || num(session.thresholdPower) || null,
    weightKg: num(profile?.weight) || null,
    device: deviceName(messages),
    powerMeter: powerMeterOf(messages.deviceInfoMesgs ?? []),
    shifts: shiftsOf(session, events),
    laps: laps.length > 1 ? laps.map((lap) => lapOf(lap, startMs)) : [],
    samples,
  };
}
