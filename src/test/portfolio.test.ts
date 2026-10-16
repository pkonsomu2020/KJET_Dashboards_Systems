import { describe, it, expect } from 'vitest';
import { money, number, percent } from '@/data/portfolio';

// portfolio.ts is now pure utilities — data lives in PostgreSQL via the API.
// These tests verify the formatting functions remain correct.

describe('Portfolio utility functions', () => {
  it('formats numbers with Kenyan locale', () => {
    expect(number(1000000)).toBe('1,000,000');
  });

  it('formats money compact — billions', () => {
    expect(money(2_450_000_000)).toBe('KES 2.45B');
  });

  it('formats money compact — millions', () => {
    expect(money(15_876_000)).toBe('KES 15.88M');
  });

  it('formats money non-compact', () => {
    expect(money(15_876_000, false)).toBe('KES 15,876,000');
  });

  it('calculates percent correctly', () => {
    expect(percent(50, 100)).toBe(50);
    expect(percent(0, 0)).toBe(0);   // no divide-by-zero
  });
});
