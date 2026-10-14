export class StravaDailyLimitError extends Error {
  constructor(message = "Strava daily read rate limit reached") {
    super(message);
    this.name = "StravaDailyLimitError";
  }
}

export class StravaShortLimitError extends Error {
  constructor(message = "Strava 15-minute read rate limit reached") {
    super(message);
    this.name = "StravaShortLimitError";
  }
}

export class StravaRateLimit {
  shortLimit = 100;
  shortUsage = 0;
  dailyLimit = 1000;
  dailyUsage = 0;

  get shortRemaining() {
    return Math.max(this.shortLimit - this.shortUsage, 0);
  }

  get dailyRemaining() {
    return Math.max(this.dailyLimit - this.dailyUsage, 0);
  }

  snapshot() {
    return {
      shortLimit: this.shortLimit,
      shortUsage: this.shortUsage,
      shortRemaining: this.shortRemaining,
      dailyLimit: this.dailyLimit,
      dailyUsage: this.dailyUsage,
      dailyRemaining: this.dailyRemaining,
      nextWindowAt: nextFifteenMinuteWindow().toISOString(),
    };
  }

  updateFromHeaders(headers: Headers) {
    const readLimit = parsePair(
      headers.get("x-readratelimit-limit") ?? headers.get("X-ReadRateLimit-Limit"),
    );
    const readUsage = parsePair(
      headers.get("x-readratelimit-usage") ?? headers.get("X-ReadRateLimit-Usage"),
    );
    if (readLimit) {
      this.shortLimit = readLimit[0];
      this.dailyLimit = readLimit[1];
    }
    if (readUsage) {
      this.shortUsage = readUsage[0];
      this.dailyUsage = readUsage[1];
    }
  }

  async waitIfNeeded(buffer = 5) {
    if (this.dailyRemaining <= 0) {
      throw new StravaDailyLimitError();
    }
    if (this.shortRemaining <= buffer) {
      throw new StravaShortLimitError();
    }
  }
}

function nextFifteenMinuteWindow(now = new Date()) {
  const windowMs = 15 * 60 * 1000;
  return new Date(Math.ceil((now.getTime() + 1) / windowMs) * windowMs);
}

function parsePair(value: string | null) {
  if (!value) return null;
  const [short, daily] = value.split(",").map((part) => Number(part.trim()));
  if (!Number.isFinite(short) || !Number.isFinite(daily)) return null;
  return [short, daily] as const;
}

