import { Injectable } from '@nestjs/common';

import type { CrisisLevel } from './crisis-lexicon.service';

export interface CrisisEvent {
  id: string;
  userId?: string;
  level: CrisisLevel;
  source: 'lexicon' | 'classifier';
  reviewStatus: 'pending' | 'reviewed';
  createdAt: string;
}

@Injectable()
export class CrisisEventStore {
  readonly events: CrisisEvent[] = [];

  record(input: {
    userId?: string;
    level: CrisisLevel;
    source: CrisisEvent['source'];
  }): CrisisEvent {
    const event: CrisisEvent = {
      id: `${Date.now()}-${this.events.length}`,
      userId: input.userId,
      level: input.level,
      source: input.source,
      reviewStatus: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.events.push(event);
    return event;
  }
}
