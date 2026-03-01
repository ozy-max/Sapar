import { Agent, type Dispatcher } from 'undici';

let sharedDispatcher: Dispatcher | undefined;

export function getSharedDispatcher(): Dispatcher {
  if (!sharedDispatcher) {
    sharedDispatcher = new Agent({
      keepAliveTimeout: 30_000,
      keepAliveMaxTimeout: 60_000,
      connections: 128,
      pipelining: 1,
    });
  }
  return sharedDispatcher;
}

export function resetSharedDispatcher(): void {
  sharedDispatcher = undefined;
}
