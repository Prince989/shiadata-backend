import { closedCitationIds } from './lifestyle-agents';

describe('lifestyle-agents citation lock', () => {
  it('makes a fabricated citationId a no-op', () => {
    expect(closedCitationIds(['c0'], ['الكافي'])).toEqual([]);
  });
});
