import { Module } from '@nestjs/common';
import { ConfigController } from './controllers/config.controller';
import { GetConfigsUseCase } from '../../application/get-configs.usecase';
import { GetConfigByKeyUseCase } from '../../application/get-config-by-key.usecase';
import { UpsertConfigUseCase } from '../../application/upsert-config.usecase';
import { DeleteConfigUseCase } from '../../application/delete-config.usecase';

@Module({
  controllers: [ConfigController],
  providers: [GetConfigsUseCase, GetConfigByKeyUseCase, UpsertConfigUseCase, DeleteConfigUseCase],
})
export class ConfigModule {}
