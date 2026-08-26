import { CrisisResourceService } from './crisis-resource.service';

describe('CrisisResourceService', () => {
  const resources = new CrisisResourceService();

  it('returns Iran-specific helplines', () => {
    const ir = resources.forCountry('IR');
    expect(ir.lines.join(' ')).toMatch(/۱۲۳/);
    expect(ir.lines.join(' ')).toMatch(/۱۴۸۰/);
  });

  it('falls back to the global directory for an unknown country', () => {
    const other = resources.forCountry('XX');
    expect(other.countryCode).toBe('*');
    expect(other.lines.some((l) => l.includes('findahelpline'))).toBe(true);
  });
});
