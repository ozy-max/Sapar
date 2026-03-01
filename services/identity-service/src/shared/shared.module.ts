import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';
import { JwtTokenService } from './jwt.service';

@Global()
@Module({
  providers: [CryptoService, JwtTokenService],
  exports: [CryptoService, JwtTokenService],
})
export class SharedModule {}
