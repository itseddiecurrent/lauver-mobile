import { AsyncLocalStorage } from 'node:async_hooks';

const requestContext = new AsyncLocalStorage<{ requestId: string }>();

export function runRequestContext(requestId: string, callback: () => void): void {
  requestContext.run({ requestId }, callback);
}

export function currentRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}
