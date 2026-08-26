import type { z } from 'zod';

import {
  ChatResponseSchema,
  CollectionInfoSchema,
  ConflictResolutionResponseSchema,
  EngineHealthResponseSchema,
  IjtihadVerdictResponseSchema,
  SanadExtractionResponseSchema,
  SanadValidationResponseSchema,
  SearchResponseSchema,
} from './contracts/engine-responses';

export type EngineWeight = 'light' | 'heavy';

export interface EngineEndpointDef {
  id: string;
  method: 'GET' | 'POST';
  path: string;
  weight: EngineWeight;
  /** HTTP-layer retries. Heavy routes MUST stay 0. */
  retries: number;
  timeoutMs: number;
  schema: z.ZodType;
}

/**
 * Paths NestJS is never allowed to call. The Python storyteller is still
 * broken by design. /api/v1/chat used to be a REPL; it is now the canonical
 * RAG route and is listed below, not here.
 */
export const ENGINE_FORBIDDEN_PATHS: readonly string[] = [
  '/api/v1/story/generate-step',
];

const LIGHT_MS = 15_000;
const HEAVY_MS = 180_000;

export const ENGINE_ENDPOINTS = {
  health: {
    id: 'health',
    method: 'GET',
    path: '/api/v1/health',
    weight: 'light',
    retries: 1,
    timeoutMs: 5_000,
    schema: EngineHealthResponseSchema,
  },
  search: {
    id: 'search',
    method: 'POST',
    path: '/api/v1/search',
    weight: 'light',
    retries: 1,
    timeoutMs: LIGHT_MS,
    schema: SearchResponseSchema,
  },
  collections: {
    id: 'collections',
    method: 'GET',
    path: '/api/v1/search/collections',
    weight: 'light',
    retries: 1,
    timeoutMs: LIGHT_MS,
    schema: CollectionInfoSchema.array(),
  },
  chat: {
    id: 'chat',
    method: 'POST',
    path: '/api/v1/chat',
    weight: 'light',
    retries: 0,
    timeoutMs: 60_000,
    schema: ChatResponseSchema,
  },
  extractSanad: {
    id: 'extractSanad',
    method: 'POST',
    path: '/api/v1/hadith/extract-sanad',
    weight: 'light',
    retries: 0,
    timeoutMs: 60_000,
    schema: SanadExtractionResponseSchema,
  },
  validateSanad: {
    id: 'validateSanad',
    method: 'POST',
    path: '/api/v1/rijal/validate',
    weight: 'heavy',
    retries: 0,
    timeoutMs: HEAVY_MS,
    schema: SanadValidationResponseSchema,
  },
  grandIjtihad: {
    id: 'grandIjtihad',
    method: 'POST',
    path: '/api/v1/ijtihad/grand-ijtihad',
    weight: 'heavy',
    retries: 0,
    timeoutMs: HEAVY_MS,
    schema: IjtihadVerdictResponseSchema,
  },
  conflictResolution: {
    id: 'conflictResolution',
    method: 'POST',
    path: '/api/v1/ijtihad/conflict-resolution',
    weight: 'heavy',
    retries: 0,
    timeoutMs: HEAVY_MS,
    schema: ConflictResolutionResponseSchema,
  },
} as const satisfies Record<string, EngineEndpointDef>;

export type EngineEndpointId = keyof typeof ENGINE_ENDPOINTS;
