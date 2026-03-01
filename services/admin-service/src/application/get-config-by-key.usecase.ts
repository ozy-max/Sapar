import { Injectable } from '@nestjs/common';
import { ConfigRepository } from '../adapters/db/config.repository';
import { ConfigNotFoundError } from '../shared/errors';

interface ConfigOutput {
  key: string;
  type: string;
  value: unknown;
  description: string | null;
  scope: string | null;
}

@Injectable()
export class GetConfigByKeyUseCase {
  constructor(private readonly configRepo: ConfigRepository) {}

  async execute(key: string): Promise<ConfigOutput> {
    const config = await this.configRepo.findByKey(key);
    if (!config) {
      throw new ConfigNotFoundError(key);
    }
    return {
      key: config.key,
      type: config.type,
      value: config.valueJson,
      description: config.description,
      scope: config.scope,
    };
  }
}
