import { Global, Module } from '@nestjs/common';
import { JwtTokenService } from './jwt.service';

@Global()
@Module({
  providers: [JwtTokenService],
  exports: [JwtTokenService],
})
export class SharedModule {}
