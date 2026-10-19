export type GradeBand = { label: string; min: number; max: number };

/** Gradient bands (percent) shared by the AI effort summary and the ride terrain table. */
export const GRADE_BANDS: readonly GradeBand[] = [
  { label: "Steep descent", min: -100, max: -6 },
  { label: "Descent", min: -6, max: -2.5 },
  { label: "Flat / rolling", min: -2.5, max: 2.5 },
  { label: "Climb", min: 2.5, max: 6 },
  { label: "Steep climb", min: 6, max: 12 },
  { label: "Very steep", min: 12, max: 100 },
];

export function bandIndexForGrade(grade: number) {
  for (let index = 0; index < GRADE_BANDS.length; index += 1) {
    const band = GRADE_BANDS[index];
    if (grade >= band.min && grade < band.max) return index;
  }
  return -1;
}
