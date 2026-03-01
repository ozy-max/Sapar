import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { ProfileRepository } from './profile.repository';
import { RatingRepository } from './rating.repository';
import { RatingEligibilityRepository } from './rating-eligibility.repository';
import { ConsumedEventRepository } from './consumed-event.repository';

@Global()
@Module({
  providers: [
    PrismaService,
    ProfileRepository,
    RatingRepository,
    RatingEligibilityRepository,
    ConsumedEventRepository,
  ],
  exports: [
    PrismaService,
    ProfileRepository,
    RatingRepository,
    RatingEligibilityRepository,
    ConsumedEventRepository,
  ],
})
export class DatabaseModule {}
