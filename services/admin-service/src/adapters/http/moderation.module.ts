import { Module } from '@nestjs/common';
import { ModerationController } from './controllers/moderation.controller';
import { BanUserUseCase } from '../../application/ban-user.usecase';
import { UnbanUserUseCase } from '../../application/unban-user.usecase';
import { CancelTripUseCase } from '../../application/cancel-trip.usecase';

@Module({
  controllers: [ModerationController],
  providers: [BanUserUseCase, UnbanUserUseCase, CancelTripUseCase],
})
export class ModerationModule {}
