import { Injectable } from '@nestjs/common';
import { ProfileRepository } from '../adapters/db/profile.repository';

interface UpdateProfileInput {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
  bio?: string | null;
  city?: string | null;
}

interface UpdateProfileOutput {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  city: string | null;
}

@Injectable()
export class UpdateProfileUseCase {
  constructor(private readonly profileRepo: ProfileRepository) {}

  async execute(input: UpdateProfileInput): Promise<UpdateProfileOutput> {
    const profile = await this.profileRepo.upsert(input.userId, {
      displayName: input.displayName,
      avatarUrl: input.avatarUrl ?? null,
      bio: input.bio ?? null,
      city: input.city ?? null,
    });

    return {
      userId: profile.userId,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      bio: profile.bio,
      city: profile.city,
    };
  }
}
