import { Module } from '@nestjs/common';
import { DisputeController } from './controllers/dispute.controller';
import { CreateDisputeUseCase } from '../../application/create-dispute.usecase';
import { GetDisputeUseCase } from '../../application/get-dispute.usecase';
import { ResolveDisputeUseCase } from '../../application/resolve-dispute.usecase';
import { CloseDisputeUseCase } from '../../application/close-dispute.usecase';

@Module({
  controllers: [DisputeController],
  providers: [CreateDisputeUseCase, GetDisputeUseCase, ResolveDisputeUseCase, CloseDisputeUseCase],
})
export class DisputeModule {}
