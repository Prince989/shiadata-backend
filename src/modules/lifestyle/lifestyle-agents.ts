import type { CrisisLevel } from '@modules/safety/crisis-lexicon.service';



export const LIFESTYLE_AGENTS = Symbol('LIFESTYLE_AGENTS');



export type QueryBucket = 'avoid' | 'action' | 'dua' | 'conceptual';



export interface SearchQuery {

  type: QueryBucket;

  text: string;

}



export interface PsychologistDraft {

  themes: string[];

  reflection: string;

}



export interface SynthesizeInput {

  userMessage: string;

  psychologist: PsychologistDraft;

  citations: Array<{

    citationId: string;

    book_title?: string | null;

    chapter?: string | null;

    content: string;

  }>;

  degraded: boolean;

  allowScripture: boolean;

}



export interface CitationPickCandidate {

  citationId: string;

  book_title?: string | null;

  chapter?: string | null;

  excerpt: string;

  queryBucket?: QueryBucket;

}



export interface LifestyleAgents {

  classifyCrisis(text: string): Promise<{ level: CrisisLevel }>;

  psychologist(userMessage: string): Promise<PsychologistDraft>;

  searchQueries(userMessage: string): Promise<SearchQuery[]>;

  pickCitations(

    candidates: CitationPickCandidate[],

    userMessage: string,

  ): Promise<string[]>;

  synthesize(input: SynthesizeInput): Promise<string>;

}



export function closedCitationIds(

  candidateIds: string[],

  chosen: string[],

): string[] {

  const allowed = new Set(candidateIds);

  return chosen.filter((id) => allowed.has(id));

}


