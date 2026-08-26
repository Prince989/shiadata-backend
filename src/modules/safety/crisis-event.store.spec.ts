import { CrisisEventStore } from './crisis-event.store';

describe('CrisisEventStore', () => {
  it('keeps imminent events with pending review and no TTL', () => {
    const store = new CrisisEventStore();
    const event = store.record({
      userId: 'u1',
      level: 'imminent',
      source: 'lexicon',
    });
    expect(event.reviewStatus).toBe('pending');
    expect(store.events).toHaveLength(1);
  });
});
