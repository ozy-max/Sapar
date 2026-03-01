import { Module } from '@nestjs/common';
import { InternalConfigController } from './controllers/internal-config.controller';
import { InternalCommandsController } from './controllers/internal-commands.controller';
import { HmacGuard } from './guards/hmac.guard';

@Module({
  controllers: [InternalConfigController, InternalCommandsController],
  providers: [HmacGuard],
})
export class InternalModule {}
