import { GetProfileUseCase } from '../get-profile.usecase';
import { ProfileRepository } from '../../adapters/db/profile.repository';
import { RatingRepository } from '../../adapters/db/rating.repository';
import { ProfileNotFoundError } from '../../shared/errors';

const USER_ID = 'user-001';

function makeProfile(): Record<string, unknown> {
  return {
    userId: USER_ID,
    displayName: 'Test User',
    avatarUrl: null,
    bio: 'Hello',
    city: 'Bishkek',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function buildDeps(): {
  useCase: GetProfileUseCase;
  profileRepo: jest.Mocked<Pick<ProfileRepository, 'findByUserId'>>;
  ratingRepo: jest.Mocked<Pick<RatingRepository, 'getAggregate'>>;
} {
  const profileRepo = {
    findByUserId: jest.fn().mockResolvedValue(makeProfile()),
  };
  const ratingRepo = {
    getAggregate: jest.fn().mockResolvedValue({ ratingAvg: 4.5, ratingCount: 10 }),
  };

  const useCase = new GetProfileUseCase(
    profileRepo as unknown as ProfileRepository,
    ratingRepo as unknown as RatingRepository,
  );

  return { useCase, profileRepo, ratingRepo };
}

describe('GetProfileUseCase', () => {
  it('should throw ProfileNotFoundError when profile does not exist', async () => {
    const { useCase, profileRepo } = buildDeps();
    profileRepo.findByUserId.mockResolvedValue(null);

    await expect(useCase.execute(USER_ID)).rejects.toThrow(ProfileNotFoundError);
  });

  it('should return profile with rating aggregate', async () => {
    const { useCase } = buildDeps();

    const result = await useCase.execute(USER_ID);

    expect(result.userId).toBe(USER_ID);
    expect(result.displayName).toBe('Test User');
    expect(result.ratingAvg).toBe(4.5);
    expect(result.ratingCount).toBe(10);
  });

  it('should return zero ratings when no aggregate exists', async () => {
    const { useCase, ratingRepo } = buildDeps();
    ratingRepo.getAggregate.mockResolvedValue(null);

    const result = await useCase.execute(USER_ID);

    expect(result.ratingAvg).toBe(0);
    expect(result.ratingCount).toBe(0);
  });
});
