import { Injectable, Logger } from '@nestjs/common';
import { RefreshTokenRepository } from '../adapters/db/refresh-token.repository';
import { UserRepository } from '../adapters/db/user.repository';
import { CryptoService } from '../shared/crypto.service';
import { JwtTokenService } from '../shared/jwt.service';
import { InvalidRefreshTokenError } from '../shared/errors';
import { loadEnv } from '../config/env';

interface RefreshInput {
  refreshToken: string;
}

interface RefreshOutput {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
}

@Injectable()
export class RefreshSessionUseCase {
  private readonly logger = new Logger(RefreshSessionUseCase.name);

  constructor(
    private readonly refreshTokenRepo: RefreshTokenRepository,
    private readonly userRepo: UserRepository,
    private readonly crypto: CryptoService,
    private readonly jwt: JwtTokenService,
  ) {}

  async execute(input: RefreshInput): Promise<RefreshOutput> {
    const tokenHash = this.crypto.hashToken(input.refreshToken);

    const existing = await this.refreshTokenRepo.findActiveByTokenHash(tokenHash);
    if (!existing) {
      throw new InvalidRefreshTokenError();
    }

    const user = await this.userRepo.findById(existing.userId);
    if (!user) {
      throw new InvalidRefreshTokenError();
    }

    const env = loadEnv();
    const rawRefreshToken = this.crypto.generateOpaqueToken();
    const newTokenHash = this.crypto.hashToken(rawRefreshToken);

    const newToken = await this.refreshTokenRepo.create({
      userId: user.id,
      tokenHash: newTokenHash,
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_SEC * 1000),
    });

    await this.refreshTokenRepo.revokeById(existing.id, newToken.id);

    const { token: accessToken, expiresInSec } = this.jwt.signAccessToken({
      sub: user.id,
      email: user.email,
      roles: user.roles,
    });

    this.logger.log(`Session refreshed: userId=${user.id}`);

    return { accessToken, refreshToken: rawRefreshToken, expiresInSec };
  }
}
