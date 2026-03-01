import { Global, Module } from '@nestjs/common';
import { JwtTokenService } from './jwt.service';
import { ConfigClient } from './config-client';

@Global()
@Module({
  providers: [JwtTokenService, ConfigClient],
  exports: [JwtTokenService, ConfigClient],
})
export class SharedModule {}
