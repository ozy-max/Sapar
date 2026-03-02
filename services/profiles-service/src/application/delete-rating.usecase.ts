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
    await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const rows = await tx.$queryRaw<
          Array<{ id: string; status: string; rated_user_id: string; score: number }>
        >`SELECT id, status, rated_user_id, score FROM ratings WHERE id = ${ratingId}::uuid FOR UPDATE`;

        const existing = rows[0];
        if (!existing || existing.status === RatingStatus.DELETED) {
          throw new RatingNotFoundError();
        }

        await this.ratingRepo.softDelete(ratingId, existing.rated_user_id, existing.score, tx);
      },
      { timeout: 10_000 },
    );

    recordAggregateUpdated();
    this.logger.log({ msg: 'Rating deleted by admin', ratingId });

    return { id: ratingId, status: 'DELETED' };
  }
}
