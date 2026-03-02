import { All, Controller, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { buildRouteTable, resolveRoute, RouteEntry } from './route-table';
import { handleProxy } from './proxy.handler';
import { ProxyMetrics } from './metrics';
import { PrometheusProxyMetrics } from '../../../observability/proxy-metrics.impl';
import { CircuitBreaker } from '../../../shared/resilience/circuit-breaker';
import { gatewayBreakerListener } from '../../../observability/resilience-metrics';
import { loadEnv } from '../../../config/env';

@ApiTags('Proxy')
@Controller()
export class ProxyController {
  private readonly routeTable: ReadonlyArray<RouteEntry>;
  private readonly metrics: ProxyMetrics;
  private readonly breakers: ReadonlyMap<string, CircuitBreaker>;

  constructor() {
    this.routeTable = buildRouteTable();
    this.metrics = new PrometheusProxyMetrics();
    this.breakers = this.initBreakers();
  }

  @All(['identity', 'identity/*'])
  @ApiOperation({ summary: 'Proxy to Identity service (e.g. GET /identity/ping)' })
  @ApiResponse({ status: 200, description: 'Proxied response from Identity' })
  @ApiResponse({ status: 502, description: 'Downstream unavailable' })
  @ApiResponse({ status: 503, description: 'Circuit breaker open' })
  @ApiResponse({ status: 504, description: 'Downstream timeout' })
  async proxyIdentity(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.dispatchProxy(req, res);
  }

  @All(['trips', 'trips/*'])
  @ApiOperation({ summary: 'Proxy to Trips service (e.g. GET /trips/ping)' })
  @ApiResponse({ status: 200, description: 'Proxied response from Trips' })
  @ApiResponse({ status: 502, description: 'Downstream unavailable' })
  @ApiResponse({ status: 503, description: 'Circuit breaker open' })
  @ApiResponse({ status: 504, description: 'Downstream timeout' })
  async proxyTrips(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.dispatchProxy(req, res);
  }

  @All(['payments', 'payments/*'])
  @ApiOperation({ summary: 'Proxy to Payments service (e.g. GET /payments/ping)' })
  @ApiResponse({ status: 200, description: 'Proxied response from Payments' })
  @ApiResponse({ status: 502, description: 'Downstream unavailable' })
  @ApiResponse({ status: 503, description: 'Circuit breaker open' })
  @ApiResponse({ status: 504, description: 'Downstream timeout' })
  async proxyPayments(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.dispatchProxy(req, res);
  }

  @All(['admin', 'admin/*'])
  @ApiOperation({ summary: 'Proxy to Admin service (e.g. GET /admin/configs)' })
  @ApiResponse({ status: 200, description: 'Proxied response from Admin' })
  @ApiResponse({ status: 502, description: 'Downstream unavailable' })
  @ApiResponse({ status: 503, description: 'Circuit breaker open' })
  @ApiResponse({ status: 504, description: 'Downstream timeout' })
  async proxyAdmin(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.dispatchProxy(req, res);
  }

  @All(['profiles', 'profiles/*'])
  @ApiOperation({ summary: 'Proxy to Profiles service (e.g. GET /profiles/:userId)' })
  @ApiResponse({ status: 200, description: 'Proxied response from Profiles' })
  @ApiResponse({ status: 502, description: 'Downstream unavailable' })
  @ApiResponse({ status: 503, description: 'Circuit breaker open' })
  @ApiResponse({ status: 504, description: 'Downstream timeout' })
  async proxyProfiles(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.dispatchProxy(req, res);
  }

  private async dispatchProxy(req: Request, res: Response): Promise<void> {
    const resolved = resolveRoute(req.path, this.routeTable);
    if (!resolved) {
      res.status(404).json({
        code: 'NOT_FOUND',
        message: 'No upstream configured for this path',
        traceId: (req.headers['x-request-id'] as string) ?? 'unknown',
      });
      return;
    }

    const breaker = this.breakers.get(resolved.route.upstream)!;
    await handleProxy(req, res, resolved.route, resolved.downstream, this.metrics, breaker);
  }

  private initBreakers(): ReadonlyMap<string, CircuitBreaker> {
    const env = loadEnv();
    const map = new Map<string, CircuitBreaker>();

    for (const route of this.routeTable) {
      map.set(
        route.upstream,
        new CircuitBreaker(
          {
            name: route.upstream,
            rollingWindowMs: env.CB_ROLLING_WINDOW_MS,
            errorThresholdPercent: env.CB_ERROR_THRESHOLD_PERCENT,
            minimumRequests: env.CB_MIN_REQUESTS,
            openDurationMs: env.CB_OPEN_DURATION_MS,
            halfOpenMaxProbes: env.CB_HALF_OPEN_MAX_PROBES,
          },
          gatewayBreakerListener,
        ),
      );
    }

    return map;
  }
}
