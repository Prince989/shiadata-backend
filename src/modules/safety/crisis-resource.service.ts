import { Injectable } from '@nestjs/common';

export interface CrisisResource {
  countryCode: string;
  lines: string[];
  disclaimer: string;
}

const RESOURCES: CrisisResource[] = [
  {
    countryCode: 'IR',
    lines: ['اورژانس اجتماعی ۱۲۳', 'صدای مشاور ۱۴۸۰'],
    disclaimer: 'این جایگزین درمان نیست.',
  },
  {
    countryCode: '*',
    lines: ['https://findahelpline.com', 'local emergency services'],
    disclaimer: 'This is not therapy.',
  },
];

@Injectable()
export class CrisisResourceService {
  forCountry(countryCode: string): CrisisResource {
    return (
      RESOURCES.find((r) => r.countryCode === countryCode) ??
      RESOURCES.find((r) => r.countryCode === '*')!
    );
  }

  card(countryCode: string): string {
    const resource = this.forCountry(countryCode);
    return `اگر در بحران هستی: ${resource.lines.join(' / ')}. ${resource.disclaimer}`;
  }
}
