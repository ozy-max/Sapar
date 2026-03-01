import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { UserRepository } from './user.repository';
import { RefreshTokenRepository } from './refresh-token.repository';
import { ConsumedEventRepository } from './consumed-event.repository';

@Global()
@Module({
  providers: [PrismaService, UserRepository, RefreshTokenRepository, ConsumedEventRepository],
  exports: [PrismaService, UserRepository, RefreshTokenRepository, ConsumedEventRepository],
})
export class DatabaseModule {}
