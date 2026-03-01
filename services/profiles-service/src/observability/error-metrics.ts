import { appErrorsTotal } from './metrics.registry';

export function recordAppError(code: string): void {
  appErrorsTotal.labels(code).inc();
}
