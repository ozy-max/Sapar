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

export async function closeSharedDispatcher(): Promise<void> {
  if (!sharedDispatcher) return;
  try {
    await (sharedDispatcher as Agent).close();
  } catch {
    /* best-effort */
  }
  sharedDispatcher = undefined;
}

export function resetSharedDispatcher(): void {
  sharedDispatcher = undefined;
}
