import { assertPublishable } from './content-status';

describe('content-factory publish rules', () => {
  it('blocks publishing with an empty citation list', () => {
    expect(assertPublishable('published', [])).toEqual([
      'published content must cite at least one source',
    ]);
  });

  it('allows a drafted piece with no citations yet', () => {
    expect(assertPublishable('draft', [])).toEqual([]);
  });
});
