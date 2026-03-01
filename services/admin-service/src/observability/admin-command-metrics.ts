import { registry } from './metrics.registry';
import { Counter, Histogram } from 'prom-client';

const commandsTotal = new Counter({
  name: 'admin_commands_total',
  help: 'Total admin commands by service, type and status',
  labelNames: ['service', 'type', 'status'] as const,
  registers: [registry],
});

const commandApplyDuration = new Histogram({
  name: 'admin_command_apply_duration_ms',
  help: 'Command application latency in downstream services',
  labelNames: ['service', 'type'] as const,
  buckets: [50, 100, 250, 500, 1000, 2500, 5000],
  registers: [registry],
});

const commandErrors = new Counter({
  name: 'admin_command_errors_total',
  help: 'Command application errors',
  labelNames: ['service', 'type'] as const,
  registers: [registry],
});

export function recordCommandTotal(service: string, type: string, status: string): void {
  commandsTotal.inc({ service, type, status });
}

export function recordCommandDuration(service: string, type: string, ms: number): void {
  commandApplyDuration.observe({ service, type }, ms);
}

export function recordCommandError(service: string, type: string): void {
  commandErrors.inc({ service, type });
}
