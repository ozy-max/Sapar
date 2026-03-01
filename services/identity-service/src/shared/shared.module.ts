import { Global, Module } from '@nestjs/common';
import { JwtTokenService } from './jwt.service';
import { CryptoService } from './crypto.service';
import { ConfigClient } from './config-client';

@Global()
@Module({
  providers: [JwtTokenService, CryptoService, ConfigClient],
  exports: [JwtTokenService, CryptoService, ConfigClient],
})
export class SharedModule {}
