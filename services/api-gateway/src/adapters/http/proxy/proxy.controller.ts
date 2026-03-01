import { All, Controller, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { buildRouteTable, resolveRoute, RouteEntry } from './route-table';
import { handleProxy } from './proxy.handler';
import { ProxyMetrics } from './metrics';
import { PrometheusProxyMetrics } from '../../../observability/proxy-metrics.impl';

@ApiTags('Proxy')
@Controller()
export class ProxyController {
  private readonly routeTable: ReadonlyArray<RouteEntry>;
  private readonly metrics: ProxyMetrics;

  constructor() {
    this.routeTable = buildRouteTable();
    this.metrics = new PrometheusProxyMetrics();
  }

  @All('identity/*')
  @ApiOperation({ summary: 'Proxy to Identity service (e.g. GET /identity/ping)' })
  @ApiResponse({ status: 200, description: 'Proxied response from Identity' })
  @ApiResponse({ status: 502, description: 'Downstream unavailable' })
  @ApiResponse({ status: 504, description: 'Downstream timeout' })
  async proxyIdentity(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.dispatchProxy(req, res);
  }

  @All('trips/*')
  @ApiOperation({ summary: 'Proxy to Trips service (e.g. GET /trips/ping)' })
  @ApiResponse({ status: 200, description: 'Proxied response from Trips' })
  @ApiResponse({ status: 502, description: 'Downstream unavailable' })
  @ApiResponse({ status: 504, description: 'Downstream timeout' })
  async proxyTrips(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.dispatchProxy(req, res);
  }

  @All('payments/*')
  @ApiOperation({ summary: 'Proxy to Payments service (e.g. GET /payments/ping)' })
  @ApiResponse({ status: 200, description: 'Proxied response from Payments' })
  @ApiResponse({ status: 502, description: 'Downstream unavailable' })
  @ApiResponse({ status: 504, description: 'Downstream timeout' })
  async proxyPayments(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
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
    await handleProxy(req, res, resolved.route, resolved.downstream, this.metrics);
  }
}
