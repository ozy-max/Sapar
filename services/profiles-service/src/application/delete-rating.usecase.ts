import { Injectable, Logger } from '@nestjs/common';
import { Prisma, RatingStatus } from '@prisma/client';
import { PrismaService } from '../adapters/db/prisma.service';
import { RatingRepository } from '../adapters/db/rating.repository';
import { RatingNotFoundError } from '../shared/errors';
import { recordAggregateUpdated } from '../observability/rating-metrics';

@Injectable()
export class DeleteRatingUseCase {
  private readonly logger = new Logger(DeleteRatingUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ratingRepo: RatingRepository,
  ) {}

  async execute(ratingId: string): Promise<{ id: string; status: string }> {
    const existing = await this.ratingRepo.findById(ratingId);
    if (!existing || existing.status === RatingStatus.DELETED) {
      throw new RatingNotFoundError();
    }

    await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        await this.ratingRepo.softDelete(ratingId, existing.ratedUserId, existing.score, tx);
      },
      { timeout: 10_000 },
    );

    recordAggregateUpdated();
    this.logger.log({ msg: 'Rating deleted by admin', ratingId });

    return { id: ratingId, status: 'DELETED' };
  }
}
