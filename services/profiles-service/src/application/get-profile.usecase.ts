import { Injectable } from '@nestjs/common';
import { ProfileRepository } from '../adapters/db/profile.repository';
import { RatingRepository } from '../adapters/db/rating.repository';
import { ProfileNotFoundError } from '../shared/errors';

interface GetProfileOutput {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  city: string | null;
  ratingAvg: number;
  ratingCount: number;
}

@Injectable()
export class GetProfileUseCase {
  constructor(
    private readonly profileRepo: ProfileRepository,
    private readonly ratingRepo: RatingRepository,
  ) {}

  async execute(userId: string): Promise<GetProfileOutput> {
    const profile = await this.profileRepo.findByUserId(userId);
    if (!profile) throw new ProfileNotFoundError();

    const aggregate = await this.ratingRepo.getAggregate(userId);

    return {
      userId: profile.userId,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      bio: profile.bio,
      city: profile.city,
      ratingAvg: aggregate?.ratingAvg ?? 0,
      ratingCount: aggregate?.ratingCount ?? 0,
    };
  }
}
