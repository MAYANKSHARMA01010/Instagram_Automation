import { calculateWarmupDay, getWarmupLimit, isWarmupCompleted } from '../src/utils/warmup.util';
import { subDays, formatISO } from 'date-fns';

describe('Warm-up Utilities', () => {
  it('should return day 1 if no start date is provided', () => {
    expect(calculateWarmupDay()).toBe(1);
  });

  it('should calculate the correct day since start date', () => {
    const today = new Date();
    const threeDaysAgo = subDays(today, 2); // 0 days ago = day 1, 2 days ago = day 3
    const dateStr = formatISO(threeDaysAgo);

    expect(calculateWarmupDay(dateStr)).toBe(3);
  });

  it('should cap the limit at the target limit', () => {
    // Day 30 normally has 40
    expect(getWarmupLimit(30, 20)).toBe(20);
    expect(getWarmupLimit(30, 40)).toBe(40);
  });

  it('should correctly map day index to the schedule array', () => {
    expect(getWarmupLimit(1, 40)).toBe(1);
    expect(getWarmupLimit(5, 40)).toBe(3);
    expect(getWarmupLimit(15, 40)).toBe(12);
    expect(getWarmupLimit(30, 40)).toBe(40);
  });

  it('should return the maximum schedule value if day > 30', () => {
    expect(getWarmupLimit(45, 40)).toBe(40);
  });

  it('should identify when warm-up is completed', () => {
    expect(isWarmupCompleted(15)).toBe(false);
    expect(isWarmupCompleted(30)).toBe(false); // Day 30 is the last day
    expect(isWarmupCompleted(31)).toBe(true);
  });
});
