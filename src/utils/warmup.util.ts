import { parseISO, isValid } from 'date-fns';

const WARMUP_SCHEDULE = [
  1,
  2,
  2,
  3,
  3, // Days 1-5
  4,
  4,
  5,
  5,
  6, // Days 6-10
  6,
  7,
  7,
  8,
  10, // Days 11-15
  10,
  12,
  12,
  14,
  14, // Days 16-20
  16,
  18,
  20,
  22,
  24, // Days 21-25
  26,
  28,
  30,
  31,
  32, // Days 26-30
];

/**
 * Calculates the current "warm-up day" for an account.
 * Day 1 is the start date.
 * If no start date is provided, or it's invalid, returns 1.
 */
export function calculateWarmupDay(startDateStr?: string): number {
  if (!startDateStr) return 1;

  // Append 'T00:00:00Z' if it's just a date string, forcing strict UTC parsing
  const isoStr = startDateStr.includes('T') ? startDateStr : `${startDateStr}T00:00:00Z`;
  const startDate = parseISO(isoStr);

  if (!isValid(startDate)) return 1;

  const now = new Date();

  // Strip time from both dates to compare purely on UTC days
  const startUtc = Date.UTC(
    startDate.getUTCFullYear(),
    startDate.getUTCMonth(),
    startDate.getUTCDate(),
  );
  const nowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  const daysDiff = Math.floor((nowUtc - startUtc) / (1000 * 60 * 60 * 24));

  return daysDiff < 0 ? 1 : daysDiff + 1;
}

/**
 * Returns the maximum upload limit for the given warm-up day.
 * Capped by the global target limit.
 */
export function getWarmupLimit(dayIndex: number, targetDailyLimit: number): number {
  if (dayIndex <= 0) return 1;

  let limit: number;
  if (dayIndex > WARMUP_SCHEDULE.length) {
    limit = WARMUP_SCHEDULE[WARMUP_SCHEDULE.length - 1]; // Day 30+ limit
  } else {
    limit = WARMUP_SCHEDULE[dayIndex - 1];
  }

  return Math.min(limit, targetDailyLimit);
}

/**
 * Checks if the account has passed the defined 30-day warm-up curve.
 */
export function isWarmupCompleted(dayIndex: number): boolean {
  return dayIndex > WARMUP_SCHEDULE.length;
}

/**
 * Returns a human-readable stage description for logging/notifications.
 */
export function getWarmupStage(dayIndex: number): string {
  if (isWarmupCompleted(dayIndex)) {
    return 'Completed (Target Limit)';
  }
  return `Warm-up Phase (Day ${dayIndex}/30)`;
}
