import { CrisisLexiconService } from '@modules/safety/crisis-lexicon.service';

import { CrisisResourceService } from '@modules/safety/crisis-resource.service';

import { CrisisEventStore } from '@modules/safety/crisis-event.store';

import { PythonEngineClient } from '@modules/ai-engine-client/python-engine.client';

import {

  CounselingOrchestrator,

  isLifestyleCitationKind,

  isLifestyleTocChunk,

  selectCandidatesWithQuotas,

  type RetrievedHadith,

} from './counseling-orchestrator';

import {

  closedCitationIds,

  type CitationPickCandidate,

  type LifestyleAgents,

  type SearchQuery,

} from './lifestyle-agents';



function delay(ms: number) {

  return new Promise((resolve) => setTimeout(resolve, ms));

}



const RIFQ_HADITH =

  'قال أبو عبد الله عليه السلام: الرفق يمن والخرق شؤم. مداراة الناس نصف الإيمان.';



const DEFAULT_SEARCH_QUERIES: SearchQuery[] = [

  { type: 'conceptual', text: 'كَظْمِ الْغَيْظِ' },

  { type: 'action', text: 'الرِّفْقِ' },

];



function hadithDoc(

  overrides: Record<string, unknown> = {},

): Record<string, unknown> {

  return {

    content: RIFQ_HADITH,

    book_title: 'الكافي',

    chapter: 'باب الرفق',

    domain: 'lifestyle_akhlaq',

    distance: 0.4,

    ...overrides,

  };

}



function build(

  search: jest.Mock,

  agents: Partial<LifestyleAgents> = {},

): {

  orch: CounselingOrchestrator;

  events: CrisisEventStore;

  synthesize: jest.Mock;

  classifyCrisis: jest.Mock;

  pickCitations: jest.Mock;

} {

  const synthesize = jest.fn().mockResolvedValue('پاسخ گرم آزمایشی');

  const classifyCrisis = jest.fn().mockResolvedValue({ level: 'none' });

  const pickCitations = jest.fn(async (cands: CitationPickCandidate[]) =>

    cands.slice(0, 1).map((c) => c.citationId),

  );

  const full: LifestyleAgents = {

    classifyCrisis,

    psychologist: jest.fn().mockResolvedValue({

      themes: ['فشار'],

      reflection: 'شنیدم که سخت است',

    }),

    searchQueries: jest.fn().mockResolvedValue(DEFAULT_SEARCH_QUERIES),

    pickCitations,

    synthesize,

    ...agents,

  };

  const events = new CrisisEventStore();

  const orch = new CounselingOrchestrator(

    new CrisisLexiconService(),

    new CrisisResourceService(),

    events,

    { search } as unknown as PythonEngineClient,

    full,

  );

  return { orch, events, synthesize, classifyCrisis, pickCitations };

}



describe('closedCitationIds', () => {

  it('drops ids that were not in the retrieved candidate set', () => {

    expect(closedCitationIds(['c0', 'c1'], ['c0', 'invented'])).toEqual(['c0']);

  });

});



describe('isLifestyleTocChunk', () => {

  it('flags table-of-contents pages', () => {

    expect(isLifestyleTocChunk('رقم الصفحة/ عناوين الأبواب/ عدد الأحاديث')).toBe(

      true,

    );

    expect(isLifestyleTocChunk(RIFQ_HADITH)).toBe(false);

  });

});



describe('selectCandidatesWithQuotas', () => {

  it('reserves action hits even when conceptual hits are closer', () => {

    const merged = new Map<string, RetrievedHadith>();

    for (let i = 0; i < 10; i++) {

      merged.set(`conceptual-${i}`, {

        content: `conceptual hadith number ${i} with enough length here`,

        book_title: `concept-${i}`,

        distance: 0.1 + i * 0.01,

        bucket: 'conceptual',

      });

    }

    merged.set('action-1', {

      content:

        'فَلْيَقُلْ دعاء الرزق when livelihood is tight and money is scarce today',

      book_title: 'action-book',

      distance: 1.0,

      bucket: 'action',

    });

    const selected = selectCandidatesWithQuotas(merged);
    const globalTop8 = [...merged.values()]
      .sort((a, b) => (a.distance ?? 999) - (b.distance ?? 999))
      .slice(0, 8);
    expect(selected.some((doc) => doc.bucket === 'action')).toBe(true);
    expect(globalTop8.some((doc) => doc.bucket === 'action')).toBe(false);
  });

});



describe('CounselingOrchestrator', () => {

  it('returns a static crisis card and never calls search or synthesizer', async () => {

    const search = jest.fn();

    const { orch, synthesize, events } = build(search);

    const turn = await orch.turn('میخوام بمیرم', { countryCode: 'IR' });

    expect(turn.crisis).toBe(true);

    expect(turn.reply).toContain('۱۲۳');

    expect(search).not.toHaveBeenCalled();

    expect(synthesize).not.toHaveBeenCalled();

    expect(events.events[0]?.source).toBe('lexicon');

  });



  it('aborts the synthesizer when the LLM classifier flags imminent risk', async () => {

    const search = jest.fn().mockResolvedValue({ documents: [], total_found: 0 });

    const { orch, synthesize, events } = build(search, {

      classifyCrisis: jest.fn().mockResolvedValue({ level: 'imminent' }),

    });

    const turn = await orch.turn('I feel empty today');

    expect(turn.crisis).toBe(true);

    expect(synthesize).not.toHaveBeenCalled();

    expect(events.events[0]?.source).toBe('classifier');

  });



  it('marks retrieval degraded and forbids scripture when RAG throws', async () => {

    const search = jest.fn().mockRejectedValue(new Error('hadith-timeout'));

    const { orch, synthesize } = build(search);

    const turn = await orch.turn('امروز خیلی خسته‌ام');

    expect(turn.crisis).toBe(false);

    expect(turn.degraded).toBe(true);

    expect(turn.citations).toEqual([]);

    expect(turn.retrieval.reason).toMatch(/rag_failed/);

    expect(synthesize).toHaveBeenCalledWith(

      expect.objectContaining({ allowScripture: false, citations: [] }),

    );

  });



  it('searches transformed Islamic keywords, not the user paragraph', async () => {

    const search = jest.fn().mockResolvedValue({ documents: [], total_found: 0 });

    const slotted: SearchQuery[] = [

      { type: 'conceptual', text: 'كَظْمِ الْغَيْظِ' },

      { type: 'action', text: 'حُسْنِ الْخُلُقِ' },

    ];

    const { orch } = build(search, {

      searchQueries: jest.fn().mockResolvedValue(slotted),

    });

    const message = 'با همسرم دعوا می‌کنیم و خسته‌ام';

    const turn = await orch.turn(message);

    const queries = search.mock.calls.map(

      (call) =>

        call[0] as {

          query: string;

          filters?: { domain?: string; book_title?: string };

        },

    );

    expect(queries.every((q) => q.query !== message)).toBe(true);

    expect(

      queries.some(

        (q) =>

          q.query === 'كَظْمِ الْغَيْظِ' &&

          q.filters?.domain === 'lifestyle_akhlaq',

      ),

    ).toBe(true);

    expect(

      queries.some((q) => q.filters?.book_title === 'vasael-o-shia-12'),

    ).toBe(true);

    expect(

      queries.some((q) => q.filters?.book_title === 'vasael-o-shia-20'),

    ).toBe(true);

    expect(

      queries.some((q) => q.filters?.book_title === 'vasael-o-shia-21'),

    ).toBe(true);

    expect(queries.some((q) => q.filters?.book_title === 'al-kafi-5')).toBe(

      true,

    );

    expect(turn.retrieval.queries).toEqual(

      expect.arrayContaining(['كَظْمِ الْغَيْظِ', 'حُسْنِ الْخُلُقِ']),

    );

  });



  it('falls back to mixed seed queries when transformer returns empty', async () => {

    const search = jest.fn().mockResolvedValue({ documents: [], total_found: 0 });

    const { orch } = build(search, {

      searchQueries: jest.fn().mockResolvedValue([]),

    });

    const message = 'پول ندارم';

    await orch.turn(message);

    const queries = search.mock.calls.map(

      (call) => (call[0] as { query: string }).query,

    );

    expect(queries.every((q) => q !== message)).toBe(true);

    expect(queries).toEqual(

      expect.arrayContaining(['طَلَبِ الرِّزْقِ', 'الدُّعَاءُ لِلرِّزْقِ']),

    );

  });



  it('drops off-topic RAG hits when pickCitations returns none', async () => {

    const search = jest.fn().mockResolvedValue({

      total_found: 1,

      documents: [hadithDoc({ content: 'ثواب ازدواج در روایات بسیار آمده است و این متن به دعوا مربوط نیست.' })],

    });

    const { orch, synthesize } = build(search, {

      pickCitations: jest.fn().mockResolvedValue([]),

    });

    const turn = await orch.turn('با همسرم دعوا می‌کنیم');

    expect(turn.citations).toEqual([]);

    expect(synthesize).toHaveBeenCalledWith(

      expect.objectContaining({ allowScripture: false, citations: [] }),

    );

  });



  it('does not paste retrieved chunk text when synthesize throws', async () => {

    const search = jest.fn().mockResolvedValue({

      total_found: 1,

      documents: [hadithDoc()],

    });

    const { orch } = build(search, {

      synthesize: jest.fn().mockRejectedValue(new Error('llm-down')),

    });

    const turn = await orch.turn('چطور مهربان‌تر باشم؟');

    expect(turn.reply).not.toContain('الرفق يمن');

    expect(turn.reply).not.toContain('الكافي');

    expect(turn.reply).not.toContain('فقط همین احادیث');

  });



  it('exposes retrieved hadiths on the turn and only cites those ids', async () => {

    const search = jest.fn().mockImplementation(

      async (input: { filters?: { domain?: string } }) => {

        if (input.filters?.domain !== 'lifestyle_akhlaq') {

          return { documents: [], total_found: 0 };

        }

        return {

          total_found: 1,

          documents: [hadithDoc()],

        };

      },

    );

    const { orch, synthesize } = build(search, {

      pickCitations: jest.fn().mockResolvedValue(['c0', 'hadith-from-nowhere']),

    });

    const turn = await orch.turn('چطور مهربان‌تر باشم؟');

    expect(turn.degraded).toBe(false);

    expect(turn.citations).toHaveLength(1);

    expect(turn.citations[0]?.citationId).toBe('c0');

    expect(turn.citations[0]?.book_title).toBe('الكافي');

    expect(turn.retrieval.hits[0]?.snippet).toContain('الرفق');

    expect(isLifestyleCitationKind(turn.citations[0]!.kind)).toBe(true);

    expect(synthesize).toHaveBeenCalledWith(

      expect.objectContaining({ allowScripture: true }),

    );

  });



  it('drops TOC pages even when they arrive first with a closer distance', async () => {

    const search = jest.fn().mockImplementation(

      async (input: { filters?: { domain?: string } }) => {

        if (input.filters?.domain === 'lifestyle_akhlaq') {

          return {

            total_found: 1,

            documents: [

              hadithDoc({

                content:

                  'رقم الصفحة/ عناوين الأبواب/ عدد الأحاديث\n416/ باب ثبوت الإيمان و هل يجوز أن ينقله اللّه.',

                book_title: 'al-kafi-2',

                chapter: 'جلد 2 - صفحه 685',

                distance: 0.3,

              }),

            ],

          };

        }

        await delay(40);

        return {

          total_found: 1,

          documents: [

            hadithDoc({

              content:

                'قال الصادق عليه السلام كظم الغيظ من أفضل الأخلاق مع الأهل عند الغضب.',

              book_title: 'makarem-ol-akhlagh-1',

              chapter: 'جلد 1 - صفحه 200',

              domain: 'theology_akhlaq',

              distance: 0.5,

            }),

          ],

        };

      },

    );

    const pickCitations = jest.fn(async (cands: CitationPickCandidate[]) =>

      cands.slice(0, 1).map((c) => c.citationId),

    );

    const { orch } = build(search, { pickCitations });

    const turn = await orch.turn('با همسرم دعوا می‌کنیم');

    expect(turn.citations[0]?.book_title).toBe('makarem-ol-akhlagh-1');

    expect(pickCitations.mock.calls[0]?.[0]?.[0]?.excerpt).toContain('كظم الغيظ');

    expect(JSON.stringify(pickCitations.mock.calls[0]?.[0])).not.toContain(

      'عناوين الأبواب',

    );

  });



  it('does not send far-distance hits to the citation picker', async () => {

    const search = jest.fn().mockResolvedValue({

      total_found: 1,

      documents: [hadithDoc({ distance: 2.0 })],

    });

    const pickCitations = jest.fn(async (cands: CitationPickCandidate[]) =>

      cands.map((c) => c.citationId),

    );

    const { orch } = build(search, { pickCitations });

    const turn = await orch.turn('چطور مهربان‌تر باشم؟');

    expect(pickCitations).toHaveBeenCalledWith([], expect.any(String));

    expect(turn.citations).toEqual([]);

    expect(turn.degraded).toBe(true);

  });



  it('ranks closer hadiths ahead of later arrivals', async () => {

    const search = jest.fn().mockImplementation(

      async (input: { filters?: { domain?: string } }) => {

        if (input.filters?.domain === 'lifestyle_akhlaq') {

          await delay(40);

          return {

            total_found: 1,

            documents: [

              hadithDoc({

                content: 'كظم الغيظ عند الخصومة مع الزوجة من حسن العشرة في البيت.',

                book_title: 'al-khesal-1',

                distance: 0.2,

              }),

            ],

          };

        }

        return {

          total_found: 1,

          documents: [

            hadithDoc({

              content: 'خوف الله كأنك تراه وإن كنت لا تراه فإنه يراك في كل حال.',

              book_title: 'al-kafi-2',

              chapter: 'جلد 2 - صفحه 68',

              domain: 'theology_akhlaq',

              distance: 0.9,

            }),

          ],

        };

      },

    );

    const pickCitations = jest.fn(async (cands: CitationPickCandidate[]) =>

      cands.slice(0, 1).map((c) => c.citationId),

    );

    const { orch } = build(search, { pickCitations });

    const turn = await orch.turn('با همسرم دعوا می‌کنیم');

    expect(turn.citations[0]?.book_title).toBe('al-khesal-1');

    expect(pickCitations.mock.calls[0]?.[0]?.[0]?.excerpt).toContain('كظم الغيظ');

  });



  it('runs psychologist, classifier, and retrieval in parallel', async () => {

    let inflight = 0;

    let max = 0;

    const mark = async <T>(value: T): Promise<T> => {

      inflight += 1;

      max = Math.max(max, inflight);

      await delay(40);

      inflight -= 1;

      return value;

    };

    const search = jest.fn().mockImplementation(async () => {

      return mark({ documents: [], total_found: 0 });

    });

    const { orch } = build(search, {

      classifyCrisis: jest.fn().mockImplementation(() => mark({ level: 'none' })),

      psychologist: jest.fn().mockImplementation(() =>

        mark({ themes: [], reflection: '' }),

      ),

    });

    await orch.turn('سلام، کمی تنها هستم');

    expect(max).toBeGreaterThanOrEqual(2);

  });



  it('streams lexicon, safety, sources, then complete', async () => {

    const search = jest.fn().mockResolvedValue({ documents: [], total_found: 0 });

    const { orch } = build(search);

    const events: string[] = [];

    for await (const chunk of orch.streamTurn('سلام')) {

      events.push(chunk.event);

    }

    expect(events).toEqual(['lexicon', 'safety', 'sources', 'complete']);

  });

});


