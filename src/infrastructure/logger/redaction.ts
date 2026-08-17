/**
 * Second-layer secret scrubbing, on top of pino's path-based `redact`.
 *
 * Path-based redaction only catches secrets living at a known field path
 * (req.headers.authorization, req.body.password, ...). It misses a key
 * concatenated into a free-text error message -- which is exactly how a
 * leaked API key usually shows up in logs. This regex pass runs on every
 * serialized log line as a backstop.
 */
const SECRET_PATTERNS: RegExp[] = [
  /AIza[0-9A-Za-z_-]{35}/g, // Google API key
  /sk-[A-Za-z0-9_-]{20,}/g, // OpenAI-style secret key
  /Bearer\s+[A-Za-z0-9._-]{20,}/gi, // bearer tokens
];

export function scrubSecrets(input: string): string {
  let out = input;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, '[REDACTED]');
  }
  return out;
}

export const PINO_REDACT_PATHS: string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-internal-api-key"]',
  'req.headers["x-engine-key"]',
  'res.headers["set-cookie"]',
  'req.body.password',
  'req.body.refreshToken',
  'req.body.currentPassword',
  'req.body.newPassword',
  '*.apiKey',
  '*.api_key',
  '*.secret',
  '*.token',
  '*.prompt',
  '*.system',
  '*.raw',
  '*.rawResponse',
];
