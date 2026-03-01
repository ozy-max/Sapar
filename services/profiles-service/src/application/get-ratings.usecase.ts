import { Injectable } from '@nestjs/common';
import { RatingRepository } from '../adapters/db/rating.repository';

interface GetRatingsInput {
  userId: string;
  limit: number;
  offset: number;
}

interface RatingItem {
  id: string;
  tripId: string;
  role: string;
  score: number;
  comment: string | null;
  createdAt: string;
}

interface GetRatingsOutput {
  items: RatingItem[];
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class GetRatingsUseCase {
  constructor(private readonly ratingRepo: RatingRepository) {}

  async execute(input: GetRatingsInput): Promise<GetRatingsOutput> {
    const { items, total } = await this.ratingRepo.findByRatedUser(
      input.userId,
      input.limit,
      input.offset,
    );

    return {
      items: items.map((r) => ({
        id: r.id,
        tripId: r.tripId,
        role: r.role,
        score: r.score,
        comment: r.comment,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      limit: input.limit,
      offset: input.offset,
    };
  }
}
