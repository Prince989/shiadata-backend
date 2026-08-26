import type { SubmitResult } from './analysis-jobs.service';

export function analysisResponse(submitted: SubmitResult): {
  status: 200 | 202;
  location?: string;
  body: Record<string, unknown>;
} {
  if (submitted.status === 'completed') {
    return {
      status: 200,
      body: {
        jobId: submitted.jobId,
        reused: submitted.reused,
        result: submitted.result,
      },
    };
  }
  return {
    status: 202,
    location: `/api/v1/analysis/jobs/${submitted.jobId}`,
    body: {
      jobId: submitted.jobId,
      reused: submitted.reused,
    },
  };
}
