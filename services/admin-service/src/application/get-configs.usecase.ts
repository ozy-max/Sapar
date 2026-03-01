import { Injectable } from '@nestjs/common';
import { ConfigRepository } from '../adapters/db/config.repository';

interface ConfigItem {
  key: string;
  type: string;
  value: unknown;
  description: string | null;
  scope: string | null;
}

@Injectable()
export class GetConfigsUseCase {
  constructor(private readonly configRepo: ConfigRepository) {}

  async execute(): Promise<{ items: ConfigItem[] }> {
    const configs = await this.configRepo.findAll();
    return {
      items: configs.map((c) => ({
        key: c.key,
        type: c.type,
        value: c.valueJson,
        description: c.description,
        scope: c.scope,
      })),
    };
  }
}
