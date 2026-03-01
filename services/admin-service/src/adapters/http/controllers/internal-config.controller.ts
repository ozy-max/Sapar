import {
  Controller,
  Get,
  Param,
  Query,
  Headers,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { ConfigRepository } from '../../db/config.repository';
import { HmacGuard } from '../guards/hmac.guard';

interface ConfigItem {
  key: string;
  type: string;
  valueJson: unknown;
  version: number;
}

interface ConfigsEnvelope {
  items: ConfigItem[];
  meta: { traceId: string };
}

@Controller('internal/configs')
@UseGuards(HmacGuard)
export class InternalConfigController {
  constructor(private readonly configRepo: ConfigRepository) {}

  @Get()
  async list(
    @Query('keys') keysParam: string | undefined,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Headers('x-request-id') traceId: string,
    @Res() res: Response,
  ): Promise<void> {
    const keys = keysParam
      ? keysParam.split(',').map((k) => k.trim()).filter(Boolean)
      : undefined;

    const configs = keys && keys.length > 0
      ? await this.configRepo.findByKeys(keys)
      : await this.configRepo.findAll();

    const maxVersion = configs.reduce((max, c) => Math.max(max, c.version), 0);
    const etag = `"v${maxVersion}"`;

    if (ifNoneMatch === etag) {
      res.status(304).end();
      return;
    }

    const items: ConfigItem[] = configs.map((c) => ({
      key: c.key,
      type: c.type,
      valueJson: c.valueJson,
      version: c.version,
    }));

    const body: ConfigsEnvelope = {
      items,
      meta: { traceId: traceId ?? '' },
    };

    res.setHeader('ETag', etag);
    res.status(200).json(body);
  }

  @Get(':key')
  async getByKey(
    @Param('key') key: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Headers('x-request-id') traceId: string,
    @Res() res: Response,
  ): Promise<void> {
    const config = await this.configRepo.findByKey(key);
    if (!config) {
      res.status(404).json({
        code: 'CONFIG_NOT_FOUND',
        message: `Config key '${key}' not found`,
      });
      return;
    }

    const etag = `"v${config.version}"`;

    if (ifNoneMatch === etag) {
      res.status(304).end();
      return;
    }

    const body: ConfigsEnvelope = {
      items: [{
        key: config.key,
        type: config.type,
        valueJson: config.valueJson,
        version: config.version,
      }],
      meta: { traceId: traceId ?? '' },
    };

    res.setHeader('ETag', etag);
    res.status(200).json(body);
  }
}
