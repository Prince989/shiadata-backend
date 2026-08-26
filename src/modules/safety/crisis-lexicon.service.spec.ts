import { CrisisLexiconService } from './crisis-lexicon.service';

describe('CrisisLexiconService', () => {
  const lexicon = new CrisisLexiconService();

  it('does not trigger on common Persian idioms', () => {
    expect(lexicon.scan('مُردم از خنده').level).toBe('none');
    expect(lexicon.scan('کشتی منو با این جوک').level).toBe('none');
  });

  it('flags explicit ideation as imminent', () => {
    expect(lexicon.scan('میخوام بمیرم').level).toBe('imminent');
    expect(lexicon.scan('I want to kill myself').level).toBe('imminent');
  });
});
