import { Encoder, Profile } from "@garmin/fitsdk";

/**
 * A 30-minute ride as an Edge with dual-sided pedals and electronic shifting writes it: power
 * with left/right balance, platform center offset, and power phases, two stands, a few shifts,
 * and two laps. Built from formulas, so every run makes the same file.
 */
export function rideFitFile(start: Date) {
  const encoder = new Encoder();
  const at = (seconds: number) => new Date(start.getTime() + seconds * 1000);
  const duration = 1800;
  const write = (mesgNum: number, fields: Record<string, unknown>) =>
    encoder.writeMesg({ mesgNum, ...fields });
  const { MesgNum } = Profile;

  write(MesgNum.FILE_ID, {
    type: "activity",
    manufacturer: "garmin",
    product: 4061,
    timeCreated: start,
    serialNumber: 1234,
  });
  write(MesgNum.DEVICE_INFO, {
    timestamp: start,
    deviceIndex: 1,
    deviceType: 11,
    manufacturer: "faveroElectronics",
    softwareVersion: 7.11,
    batteryStatus: "ok",
    sourceType: "antplus",
  });
  write(MesgNum.USER_PROFILE, { weight: 72 });
  write(MesgNum.ZONES_TARGET, { functionalThresholdPower: 250 });
  write(MesgNum.EVENT, { timestamp: start, event: "timer", eventType: "start" });

  // Stand twice; shift up and down on a 2x cassette (data packs rear and front gears).
  const position = { seated: 0, standing: 1, transitionToSeated: 2, transitionToStanding: 3 };
  for (const [second, riderPosition] of [
    [0, "seated"],
    [600, "transitionToStanding"],
    [603, "standing"],
    [630, "transitionToSeated"],
    [633, "seated"],
    [1200, "transitionToStanding"],
    [1203, "standing"],
    [1240, "transitionToSeated"],
    [1243, "seated"],
  ] as const) {
    write(MesgNum.EVENT, {
      timestamp: at(second),
      event: "riderPositionChange",
      eventType: "marker",
      data: position[riderPosition],
    });
  }
  for (const [second, front, rear] of [
    [0, 50, 17],
    [300, 50, 15],
    [900, 34, 21],
    [1500, 50, 14],
  ] as const) {
    write(MesgNum.EVENT, {
      timestamp: at(second),
      event: "rearGearChange",
      eventType: "marker",
      data: 1 + rear * 2 ** 8 + 2 * 2 ** 16 + front * 2 ** 24,
    });
  }

  let distance = 0;
  for (let second = 0; second < duration; second += 1) {
    const coasting = second % 300 >= 290;
    const surge = second % 600 < 30 && second > 0;
    const watts = coasting ? 0 : Math.round(185 + 45 * Math.sin(second / 90) + (surge ? 220 : 0));
    const speed = 8 + 1.5 * Math.sin(second / 200);
    distance += speed;
    write(MesgNum.RECORD, {
      timestamp: at(second),
      power: watts,
      heartRate: Math.round(128 + 18 * (second / duration) + (surge ? 8 : 0)),
      cadence: coasting ? 0 : Math.round(88 + 6 * Math.sin(second / 120) - (surge ? 10 : 0)),
      speed,
      distance,
      altitude: 120 + 25 * Math.sin(second / 300),
      ...(coasting
        ? {}
        : {
            leftRightBalance: 0x80 | (watts > 300 ? 49 : 48),
            leftPco: Math.round((watts - 185) / 60),
            rightPco: 6 + Math.round((watts - 185) / 40),
            leftPowerPhase: [356, 196],
            leftPowerPhasePeak: [70, 126],
            rightPowerPhase: [2, 200],
            rightPowerPhasePeak: [63, 121],
          }),
    });
  }

  for (const lap of [0, 1]) {
    const lapStart = lap * 900;
    write(MesgNum.LAP, {
      timestamp: at(lapStart + 900),
      startTime: at(lapStart),
      totalElapsedTime: 900,
      totalTimerTime: 900,
      totalDistance: distance / 2,
      avgPower: 190,
      maxPower: 450,
      normalizedPower: 205,
      avgHeartRate: 132 + lap * 8,
      avgCadence: 87,
      leftRightBalance: 0x8000 | 4810,
      avgLeftPco: 0,
      avgRightPco: 6,
      avgLeftPowerPhase: [356, 196, 200, 96],
      avgRightPowerPhase: [2, 200, 198, 101],
      timeStanding: lap ? 40 : 30,
      event: "lap",
      eventType: "stop",
      messageIndex: lap,
    });
  }
  write(MesgNum.EVENT, { timestamp: at(duration), event: "timer", eventType: "stopAll" });
  write(MesgNum.SESSION, {
    timestamp: at(duration),
    startTime: start,
    sport: "cycling",
    subSport: "road",
    totalElapsedTime: duration,
    totalTimerTime: duration,
    totalDistance: distance,
    totalAscent: 160,
    totalCalories: 420,
    firstLapIndex: 0,
    numLaps: 2,
    frontGearShiftCount: 2,
    rearGearShiftCount: 3,
    event: "session",
    eventType: "stop",
    messageIndex: 0,
  });
  write(MesgNum.ACTIVITY, {
    timestamp: at(duration),
    totalTimerTime: duration,
    numSessions: 1,
    type: "manual",
    event: "activity",
    eventType: "stop",
  });
  return Buffer.from(encoder.close());
}
