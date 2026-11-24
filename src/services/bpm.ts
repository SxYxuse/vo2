export const BPM_MIN = 40;
export const BPM_MAX = 230;

export function emptyHistogram() {
  return Array.from({ length: BPM_MAX + 1 }, () => 0);
}

export function isPlausibleBpm(value: number | null | undefined) {
  return value != null && Number.isFinite(value) && value >= BPM_MIN && value <= BPM_MAX;
}
