import { AsyncLocalStorage } from 'node:async_hooks';

interface RequestContext {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(
  context: RequestContext,
  fn: () => T,
): T {
  return storage.run(context, fn);
}

/**
 * Lets code deep in the call stack (AiGatewayService, PythonEngineClient)
 * attach the current request's id to its own logs/outbound headers without
 * threading it through every function signature.
 */
export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}
