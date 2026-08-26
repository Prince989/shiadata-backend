import { historicalYearIsPlausible } from './historical-year';

describe('historicalYearIsPlausible', () => {
  it('accepts early Islamic centuries and rejects nonsense years', () => {
    expect(historicalYearIsPlausible(5)).toBe(true);
    expect(historicalYearIsPlausible(0)).toBe(false);
    expect(historicalYearIsPlausible(9000)).toBe(false);
    expect(historicalYearIsPlausible(undefined)).toBe(true);
  });
});
