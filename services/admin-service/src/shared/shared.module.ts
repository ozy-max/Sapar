import { Global, Module } from '@nestjs/common';
import { JwtTokenService } from './jwt.service';
import { OutboxService } from './outbox.service';

@Global()
@Module({
  providers: [JwtTokenService, OutboxService],
  exports: [JwtTokenService, OutboxService],
})
export class SharedModule {}
