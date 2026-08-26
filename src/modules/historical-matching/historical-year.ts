export function historicalYearIsPlausible(yearHijri?: number): boolean {
  if (yearHijri === undefined) return true;
  return yearHijri >= 1 && yearHijri <= 1600;
}
