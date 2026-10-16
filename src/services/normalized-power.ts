/** Coggan normalized power: 30 s mean, raise to 4th, average, 4th root. */

export function normalizedPowerFromWatts(
  watts: number[] | null | undefined,
  time?: number[] | null,
): number | null {
  if (!watts || watts.length < 2) return null;
  const timed = time && time.length === watts.length;
  let left = 0;
  let windowSum = 0;
  let count = 0;
  let fourthSum = 0;
  let windows = 0;

  for (let index = 0; index < watts.length; index += 1) {
    windowSum += Math.max(0, watts[index] ?? 0);
    count += 1;
    const end = timed ? time[index] : index;
    const minSpan = timed ? 30 * 0.9 : 29;
    while (left < index) {
      const start = timed ? time[left] : left;
      if (end - start < 30) break;
      windowSum -= Math.max(0, watts[left] ?? 0);
      count -= 1;
      left += 1;
    }
    const span = end - (timed ? time[left] : left);
    if (span >= minSpan && count > 0) {
      const mean = windowSum / count;
      fourthSum += mean * mean * mean * mean;
      windows += 1;
    }
  }

  if (windows === 0) return null;
  const value = (fourthSum / windows) ** 0.25;
  return Number.isFinite(value) && value > 0 ? value : null;
}
