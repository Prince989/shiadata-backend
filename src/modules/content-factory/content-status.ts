export const CONTENT_STATUSES = [
  'draft',
  'in_review',
  'published',
  'rejected',
] as const;

export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export function assertPublishable(status: ContentStatus, citationIds: string[]): string[] {
  const errors: string[] = [];
  if (status === 'published' && citationIds.length === 0) {
    errors.push('published content must cite at least one source');
  }
  return errors;
}
