import { Module } from '@nestjs/common';
import { ProfilesController } from './controllers/profiles.controller';
import { RatingsController } from './controllers/ratings.controller';
import { AdminRatingsController } from './controllers/admin-ratings.controller';
import { InternalEventsController } from './controllers/internal-events.controller';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { HmacGuard } from './guards/hmac.guard';
import { GetProfileUseCase } from '../../application/get-profile.usecase';
import { UpdateProfileUseCase } from '../../application/update-profile.usecase';
import { GetRatingsUseCase } from '../../application/get-ratings.usecase';
import { CreateRatingUseCase } from '../../application/create-rating.usecase';
import { DeleteRatingUseCase } from '../../application/delete-rating.usecase';
import { OnTripCompletedHandler } from '../../application/handlers/on-trip-completed.handler';

@Module({
  controllers: [
    ProfilesController,
    RatingsController,
    AdminRatingsController,
    InternalEventsController,
  ],
  providers: [
    JwtAuthGuard,
    HmacGuard,
    GetProfileUseCase,
    UpdateProfileUseCase,
    GetRatingsUseCase,
    CreateRatingUseCase,
    DeleteRatingUseCase,
    OnTripCompletedHandler,
  ],
})
export class ProfilesModule {}
