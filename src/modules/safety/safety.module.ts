import { Module } from '@nestjs/common';

import { CrisisLexiconService } from './crisis-lexicon.service';
import { CrisisResourceService } from './crisis-resource.service';
import { CrisisEventStore } from './crisis-event.store';

@Module({
  providers: [CrisisLexiconService, CrisisResourceService, CrisisEventStore],
  exports: [CrisisLexiconService, CrisisResourceService, CrisisEventStore],
})
export class SafetyModule {}
