import { analysisResponse } from './analysis-http';

describe('analysisResponse', () => {
  it('returns HTTP 200 when the job already finished', () => {
    const res = analysisResponse({
      jobId: 'abc',
      status: 'completed',
      result: { final_verdict: 'حجت' },
      reused: true,
    });
    expect(res.status).toBe(200);
    expect(res.location).toBeUndefined();
    expect(res.body.result).toEqual({ final_verdict: 'حجت' });
  });

  it('returns HTTP 202 with a Location header when still queued', () => {
    const res = analysisResponse({
      jobId: 'abc',
      status: 'queued',
      reused: false,
    });
    expect(res.status).toBe(202);
    expect(res.location).toBe('/api/v1/analysis/jobs/abc');
  });
});
