import { Injectable } from '@nestjs/common';

import { z } from 'zod';



import { AiGatewayService } from '@modules/ai-gateway/services/ai-gateway.service';

import type { CrisisLevel } from '@modules/safety/crisis-lexicon.service';

import type {

  CitationPickCandidate,

  LifestyleAgents,

  PsychologistDraft,

  QueryBucket,

  SearchQuery,

  SynthesizeInput,

} from './lifestyle-agents';

import { closedCitationIds } from './lifestyle-agents';



const CrisisSchema = z.object({

  level: z.enum(['none', 'low', 'high', 'imminent']),

});



const PsychologistSchema = z.object({

  themes: z.array(z.string()).default([]),

  reflection: z.string().default(''),

});



const QueryBucketSchema = z.enum(['avoid', 'action', 'dua', 'conceptual']);



const QueriesSchema = z.object({

  queries: z

    .array(

      z.object({

        type: QueryBucketSchema,

        text: z.string().min(1),

      }),

    )

    .min(6)

    .max(8),

});



@Injectable()

export class GatewayLifestyleAgents implements LifestyleAgents {

  constructor(private readonly gateway: AiGatewayService) {}



  async classifyCrisis(text: string): Promise<{ level: CrisisLevel }> {

    try {

      const result = await this.gateway.completeStructured({

        schema: CrisisSchema,

        schemaName: 'lifestyle-crisis',

        prompt: text,

        system:

          'Classify suicide/self-harm risk. Idioms like "died laughing" are none.',

        budget: { feature: 'lifestyle.crisis' },

        maxOutputTokens: 64,

      });

      return result.data;

    } catch {

      return { level: 'none' };

    }

  }



  async psychologist(userMessage: string): Promise<PsychologistDraft> {

    try {

      const result = await this.gateway.completeStructured({

        schema: PsychologistSchema,

        schemaName: 'lifestyle-psychologist',

        prompt: userMessage,

        system:

          'فقط فارسی بنویس. حدیث نساز و نام پیامبر یا امام نیاور. احساس و فشار واقعی همین کاربر را نام ببر. حداکثر سه جمله کوتاه. این لایه‌ی درونی است نه متن نهایی کاربر.',

        budget: { feature: 'lifestyle.psychologist' },

        maxOutputTokens: 256,

      });

      return result.data;

    } catch {

      return { themes: [], reflection: '' };

    }

  }



  async searchQueries(userMessage: string): Promise<SearchQuery[]> {

    try {

      const result = await this.gateway.completeStructured({

        schema: QueriesSchema,

        schemaName: 'lifestyle-queries',

        prompt: userMessage,

        system:

          'You are a Shia hadith search analyst. Read the user problem and output 6-8 classical Arabic hadith-search keywords. ' +

          'Write each WITH full tashkeel (اعراب) as in printed hadith books. ' +

          'Mix all four types from THIS user problem: avoid (things to stop), action (things to do), dua (supplication keywords), conceptual (ethics/theme). ' +

          'Arabic only. No Persian, no commentary, no hadith text.',

        budget: { feature: 'lifestyle.queries' },

        maxOutputTokens: 384,

      });

      return result.data.queries

        .map((q) => ({

          type: q.type as QueryBucket,

          text: q.text.trim(),

        }))

        .filter((q) => q.text.length > 0)

        .slice(0, 8);

    } catch {

      return [];

    }

  }



  async pickCitations(

    candidates: CitationPickCandidate[],

    userMessage: string,

  ): Promise<string[]> {

    if (candidates.length === 0) return [];

    const candidateIds = candidates.map((c) => c.citationId);

    const idEnum = z.enum(candidateIds as [string, ...string[]]);

    const schema = z.object({

      citationIds: z.array(idEnum).max(10),

    });

    const listing = candidates

      .map(

        (c) =>

          `${c.citationId} | ${c.queryBucket ?? '?'} | ${c.book_title ?? '?'} | ${c.chapter ?? '?'} | ${c.excerpt}`,

      )

      .join('\n');

    try {

      const result = await this.gateway.completeStructured({

        schema,

        schemaName: 'lifestyle-muhaddith',

        prompt: `User: ${userMessage}\n\nCandidates:\n${listing}`,

        system:

          'Pick up to 10 citationId values whose excerpt actually addresses this user problem. ' +

          'Prefer imperative or causal action (فَلْيَقُلْ، إِيَّاكُمْ، تَطْرُدُ، يُورِثُ) over abstract piety when both exist. ' +

          'Aim for a practical mix across queryBucket types (avoid, action, dua, conceptual). ' +

          'Return an empty list for table-of-contents pages, astrology, theology-of-creation, ' +

          'khawf-Allah as generic piety, or unrelated fiqh. Never invent ids.',

        budget: { feature: 'lifestyle.muhaddith' },

        maxOutputTokens: 256,

      });

      return closedCitationIds(candidateIds, result.data.citationIds);

    } catch {

      return [];

    }

  }



  async synthesize(input: SynthesizeInput): Promise<string> {

    const sources = input.citations

      .map((c) => {

        const loc = [c.book_title, c.chapter].filter(Boolean).join(' / ');

        return `[${c.citationId}] ${loc}\n${c.content}`;

      })

      .join('\n\n');



    const grounded = input.allowScripture && input.citations.length > 0;



    const system = grounded

      ? [

          'به فارسی پاسخ بده. تو مشاور نیستی؛ روایت‌یار هستی.',

          'فقط از بلوک‌های منبع زیر نقل کن. متن عربی را عیناً بیاور و منبع را با عنوان کتاب و باب بنویس.',

          'هیچ حدیث، قول پیامبر یا امام، یا نام کتابی خارج از این بلوک‌ها نساز.',

          'اول مشکل واقعی همین کاربر را به رسمیت بشناس. هر کار عملی را فقط از همین منابع استخراج کن؛ چیزی از خودت اضافه نکن.',

          'چند حدیث عملی را بر یک خط فلسفی انتزاعی ترجیح بده.',

          'فهرست ابواب، جدول صفحات، یا متن بی‌ربط را نقل نکن؛ اگر هیچ منبعی نچسبید حدیث نیاور و نام پیامبر یا امام یا کتاب نبر.',

        ].join(' ')

      : [

          'به فارسی پاسخ بده.',

          'هیچ حدیث، روایت، قول پیامبر یا امام، و هیچ نام کتاب حدیثی نیاور. بازیابی شکست خورده است.',

          'صریحاً بگو الان نتوانستیم از منابع حدیثی چیزی بیاوریم. تشخیص پزشکی نده.',

        ].join(' ');



    const result = await this.gateway.complete({

      prompt: grounded

        ? `پیام کاربر:\n${input.userMessage}\n\nیادداشت درونی (حدیث نیست):\n${input.psychologist.reflection}\n\nمنابع بازیابی‌شده از RAG — فقط همین‌ها مجازند:\n${sources}`

        : `پیام کاربر:\n${input.userMessage}\n\nبازیابی حدیث شکست خورد (degraded=${input.degraded}). بدون نقل دینی پاسخ بده.`,

      system,

      budget: { feature: 'lifestyle.synthesize' },

      maxOutputTokens: 2048,

    });

    return result.data;

  }

}


