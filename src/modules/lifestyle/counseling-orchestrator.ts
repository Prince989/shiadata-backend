import { Inject, Injectable, Logger } from '@nestjs/common';



import { CrisisLexiconService } from '@modules/safety/crisis-lexicon.service';

import { CrisisResourceService } from '@modules/safety/crisis-resource.service';

import { CrisisEventStore } from '@modules/safety/crisis-event.store';

import { PythonEngineClient } from '@modules/ai-engine-client/python-engine.client';

import {

  LIFESTYLE_AGENTS,

  closedCitationIds,

  type LifestyleAgents,

  type PsychologistDraft,

  type QueryBucket,

  type SearchQuery,

} from './lifestyle-agents';



export const LIFESTYLE_CITATION_KINDS = ['hadith', 'quran', 'scholar'] as const;

export type LifestyleCitationKind = (typeof LIFESTYLE_CITATION_KINDS)[number];



const HADITH_SEARCH_MS = 15_000;

const CANDIDATE_K = 20;

const PER_BUCKET_QUOTA = 4;

const SEARCH_CONCURRENCY = 8;

const SEARCH_TOP_K = 10;

const EXCERPT_CHARS = 300;

const MIN_CONTENT_CHARS = 24;

const MAX_DISTANCE = 1.15;

const TOC_MARKERS = /رقم الصفحة|عناوين الأبواب|عناوين الابواب|عدد الأحاديث|عدد الاحاديث/;



const QUERY_BUCKETS: QueryBucket[] = ['avoid', 'action', 'dua', 'conceptual'];



type SearchLane = { domain: string } | { book_title: string };



const SEARCH_LANES: SearchLane[] = [

  { domain: 'lifestyle_akhlaq' },

  { domain: 'theology_akhlaq' },

  { book_title: 'vasael-o-shia-12' },

  { book_title: 'vasael-o-shia-20' },

  { book_title: 'vasael-o-shia-21' },

  { book_title: 'al-kafi-5' },

];



const MIXED_SEED_QUERIES: SearchQuery[] = [

  { type: 'avoid', text: 'كَرَاهَةِ النَّوْمِ' },

  { type: 'action', text: 'طَلَبِ الرِّزْقِ' },

  { type: 'dua', text: 'الدُّعَاءُ لِلرِّزْقِ' },

  { type: 'conceptual', text: 'حُسْنِ الْخُلُقِ' },

  { type: 'avoid', text: 'يُورِثُ الْفَقْرَ' },

  { type: 'action', text: 'الصَّوْمُ' },

  { type: 'dua', text: 'الدُّعَاءُ فِي الْكَرْبِ' },

  { type: 'conceptual', text: 'الرِّفْقِ' },

];



const NO_SCRIPTURE_REPLY =

  'من کنارت هستم. الان نتوانستم حدیثی مرتبط از منابع بازیابی کنم، پس هیچ روایتی نقل نمی‌کنم. اگر خواستی دوباره می‌پرسیم.';



export interface RetrievedHadith {

  content: string;

  book_title?: string | null;

  chapter?: string | null;

  domain?: string | null;

  distance: number | null;

  bucket?: QueryBucket;

}



export interface CounselingCitation {

  citationId: string;

  kind: LifestyleCitationKind;

  book_title?: string | null;

  chapter?: string | null;

  domain?: string | null;

  content: string;

}



export interface RetrievalHitLog {

  citationId: string;

  book_title?: string | null;

  chapter?: string | null;

  domain?: string | null;

  snippet: string;

}



export interface RetrievalReport {

  queries: string[];

  degraded: boolean;

  reason: string | null;

  hits: RetrievalHitLog[];

}



export interface CounselingTurn {

  reply: string;

  citations: CounselingCitation[];

  degraded: boolean;

  crisis: boolean;

  psychologist?: PsychologistDraft;

  retrieval: RetrievalReport;

}



export interface CounselingContext {

  userId?: string;

  countryCode?: string;

}



export interface StreamChunk {

  event: 'lexicon' | 'safety' | 'sources' | 'complete';

  data: unknown;

}



function laneLabel(lane: SearchLane): string {

  return 'domain' in lane ? `domain=${lane.domain}` : `book_title=${lane.book_title}`;

}



function laneFilters(lane: SearchLane): Record<string, string> {

  return 'domain' in lane ? { domain: lane.domain } : { book_title: lane.book_title };

}



export function hadithDocKey(doc: Pick<RetrievedHadith, 'book_title' | 'content'>): string {

  return `${doc.book_title ?? ''}:${doc.content.slice(0, 80)}`;

}



export function isLifestyleTocChunk(content: string): boolean {

  return TOC_MARKERS.test(content);

}



export function isUsableHadith(doc: RetrievedHadith): boolean {

  const text = doc.content.trim();

  if (text.length < MIN_CONTENT_CHARS) return false;

  if (isLifestyleTocChunk(text)) return false;

  if (doc.distance != null && doc.distance > MAX_DISTANCE) return false;

  return true;

}



export function compareDistance(a: RetrievedHadith, b: RetrievedHadith): number {

  if (a.distance == null && b.distance == null) return 0;

  if (a.distance == null) return 1;

  if (b.distance == null) return -1;

  return a.distance - b.distance;

}



export function selectCandidatesWithQuotas(

  merged: Map<string, RetrievedHadith>,

  candidateK = CANDIDATE_K,

  perBucketQuota = PER_BUCKET_QUOTA,

): RetrievedHadith[] {

  const usable = [...merged.values()].filter(isUsableHadith);

  const selected: RetrievedHadith[] = [];

  const selectedKeys = new Set<string>();



  for (const bucket of QUERY_BUCKETS) {

    const bucketDocs = usable

      .filter((doc) => doc.bucket === bucket)

      .sort(compareDistance)

      .slice(0, perBucketQuota);

    for (const doc of bucketDocs) {

      const key = hadithDocKey(doc);

      if (!selectedKeys.has(key)) {

        selectedKeys.add(key);

        selected.push(doc);

      }

    }

  }



  const remaining = usable

    .filter((doc) => !selectedKeys.has(hadithDocKey(doc)))

    .sort(compareDistance);



  for (const doc of remaining) {

    if (selected.length >= candidateK) break;

    selected.push(doc);

  }



  return selected.slice(0, candidateK);

}



async function mapPool<T, R>(

  items: T[],

  concurrency: number,

  fn: (item: T, index: number) => Promise<R>,

): Promise<R[]> {

  if (items.length === 0) return [];

  const results: R[] = new Array(items.length);

  let next = 0;

  async function worker() {

    while (true) {

      const index = next++;
      if (index >= items.length) break;
      const item = items[index];
      if (item === undefined) break;
      results[index] = await fn(item, index);

    }

  }

  await Promise.all(

    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),

  );

  return results;

}



@Injectable()

export class CounselingOrchestrator {

  private readonly logger = new Logger(CounselingOrchestrator.name);



  constructor(

    private readonly lexicon: CrisisLexiconService,

    private readonly resources: CrisisResourceService,

    private readonly events: CrisisEventStore,

    private readonly engine: PythonEngineClient,

    @Inject(LIFESTYLE_AGENTS) private readonly agents: LifestyleAgents,

  ) {}



  async turn(

    userMessage: string,

    ctx: CounselingContext = {},

  ): Promise<CounselingTurn> {

    let result: CounselingTurn | undefined;

    for await (const chunk of this.streamTurn(userMessage, ctx)) {

      if (chunk.event === 'complete') {

        result = chunk.data as CounselingTurn;

      }

    }

    return result!;

  }



  async *streamTurn(

    userMessage: string,

    ctx: CounselingContext = {},

  ): AsyncGenerator<StreamChunk> {

    const countryCode = ctx.countryCode ?? '*';

    const layer0 = this.lexicon.scan(userMessage);

    yield { event: 'lexicon', data: layer0 };



    if (layer0.level === 'high' || layer0.level === 'imminent') {

      this.events.record({

        userId: ctx.userId,

        level: layer0.level,

        source: 'lexicon',

      });

      yield { event: 'complete', data: this.crisisTurn(countryCode) };

      return;

    }



    const [safety, psychologist, retrieved] = await Promise.all([

      this.agents.classifyCrisis(userMessage),

      this.agents.psychologist(userMessage),

      this.muhaddith(userMessage),

    ]);



    yield { event: 'safety', data: safety };



    if (safety.level === 'high' || safety.level === 'imminent') {

      this.events.record({

        userId: ctx.userId,

        level: safety.level,

        source: 'classifier',

      });

      yield { event: 'complete', data: this.crisisTurn(countryCode) };

      return;

    }



    yield { event: 'sources', data: retrieved.report };



    const reply = await this.safeSynthesize({

      userMessage,

      psychologist,

      citations: retrieved.citations,

      degraded: retrieved.report.degraded,

    });



    yield {

      event: 'complete',

      data: {

        reply,

        citations: retrieved.citations,

        degraded: retrieved.report.degraded,

        crisis: false,

        psychologist,

        retrieval: retrieved.report,

      } satisfies CounselingTurn,

    };

  }



  private crisisTurn(countryCode: string): CounselingTurn {

    return {

      reply: this.resources.card(countryCode),

      citations: [],

      degraded: false,

      crisis: true,

      retrieval: { queries: [], degraded: false, reason: null, hits: [] },

    };

  }



  private async muhaddith(userMessage: string): Promise<{

    citations: CounselingCitation[];

    report: RetrievalReport;

  }> {

    const { documents, report } = await this.searchHadiths(userMessage);

    const candidates: CounselingCitation[] = documents.map((doc, index) => ({

      citationId: `c${index}`,

      kind: 'hadith',

      book_title: doc.book_title,

      chapter: doc.chapter,

      domain: doc.domain,

      content: doc.content,

    }));



    this.logger.log(

      `lifestyle RAG pre-pick degraded=${report.degraded} reason=${report.reason} ranked=${JSON.stringify(

        candidates.map((c, i) => ({

          citationId: c.citationId,

          book_title: c.book_title,

          chapter: c.chapter,

          domain: c.domain,

          bucket: documents[i]?.bucket ?? null,

          distance: documents[i]?.distance ?? null,

          snippet: c.content.slice(0, 160),

        })),

      )}`,

    );



    const picked = closedCitationIds(

      candidates.map((c) => c.citationId),

      await this.agents.pickCitations(

        candidates.map((c, i) => ({

          citationId: c.citationId,

          book_title: c.book_title,

          chapter: c.chapter,

          excerpt: c.content.slice(0, EXCERPT_CHARS),

          queryBucket: documents[i]?.bucket,

        })),

        userMessage,

      ),

    );

    const citations = candidates.filter((c) => picked.includes(c.citationId));



    report.hits = citations.map((c) => ({

      citationId: c.citationId,

      book_title: c.book_title,

      chapter: c.chapter,

      domain: c.domain,

      snippet: c.content.slice(0, 240),

    }));



    this.logger.log(

      `lifestyle RAG selected degraded=${report.degraded} reason=${report.reason} hits=${JSON.stringify(report.hits)}`,

    );



    return { citations, report };

  }



  private async searchHadiths(userMessage: string): Promise<{

    documents: RetrievedHadith[];

    report: RetrievalReport;

  }> {

    const transformed = await this.agents.searchQueries(userMessage);

    const usedSeedFallback = transformed.length === 0;

    const queries = usedSeedFallback ? [...MIXED_SEED_QUERIES] : transformed;

    const sent: string[] = [];

    const merged = new Map<string, RetrievedHadith>();

    let lastError: string | null = null;



    const runSearches = async (searchQueries: SearchQuery[]) => {

      const jobs = searchQueries.flatMap((query) =>

        SEARCH_LANES.map((lane) => ({ query, lane })),

      );

      await mapPool(jobs, SEARCH_CONCURRENCY, async ({ query, lane }) => {

        const label = laneLabel(lane);

        sent.push(query.text);

        try {

          const result = await this.searchOnce(query.text, lane);

          this.logger.log(

            `lifestyle RAG query="${query.text.slice(0, 80)}" bucket=${query.type} ${label} total_found=${result.total_found} books=${JSON.stringify(result.documents.map((d) => d.book_title))} distances=${JSON.stringify(result.documents.map((d) => d.distance ?? null))} snippets=${JSON.stringify(result.documents.map((d) => d.content.slice(0, 160)))}`,

          );

          for (const doc of result.documents) {

            const retrieved: RetrievedHadith = {

              content: doc.content,

              book_title: doc.book_title,

              chapter: doc.chapter,

              domain: doc.domain,

              distance: doc.distance ?? null,

              bucket: query.type,

            };

            const key = hadithDocKey(retrieved);

            const existing = merged.get(key);

            if (!existing || compareDistance(retrieved, existing) < 0) {

              merged.set(key, retrieved);

            }

          }

        } catch (err) {

          lastError = err instanceof Error ? err.message : String(err);

          this.logger.error(

            `lifestyle RAG failed query="${query.text.slice(0, 80)}" bucket=${query.type} ${label} err=${lastError}`,

          );

        }

      });

    };



    await runSearches(queries);



    if (merged.size === 0 && !usedSeedFallback) {

      await runSearches(MIXED_SEED_QUERIES);

    }



    const documents = selectCandidatesWithQuotas(merged);

    const degraded = documents.length === 0;

    return {

      documents,

      report: {

        queries: [...new Set(sent)],

        degraded,

        reason: degraded

          ? lastError

            ? `rag_failed:${lastError}`

            : 'rag_empty'

          : null,

        hits: [],

      },

    };

  }



  private async searchOnce(query: string, lane: SearchLane) {

    let timer: ReturnType<typeof setTimeout> | undefined;

    try {

      return await Promise.race([

        this.engine.search({

          query,

          collection: 'hadith',

          filters: laneFilters(lane),

          top_k: SEARCH_TOP_K,

        }),

        new Promise<never>((_, reject) => {

          timer = setTimeout(

            () => reject(new Error('hadith-timeout')),

            HADITH_SEARCH_MS,

          );

        }),

      ]);

    } finally {

      if (timer) clearTimeout(timer);

    }

  }



  private async safeSynthesize(input: {

    userMessage: string;

    psychologist: PsychologistDraft;

    citations: CounselingCitation[];

    degraded: boolean;

  }): Promise<string> {

    try {

      return await this.agents.synthesize({

        ...input,

        allowScripture: input.citations.length > 0,

      });

    } catch {

      return NO_SCRIPTURE_REPLY;

    }

  }

}



export function isLifestyleCitationKind(

  value: string,

): value is LifestyleCitationKind {

  return (LIFESTYLE_CITATION_KINDS as readonly string[]).includes(value);

}


