import { Injectable, Logger } from '@nestjs/common';
import { UserRepository } from '../adapters/db/user.repository';
import { PrismaService } from '../adapters/db/prisma.service';
import { CryptoService } from '../shared/crypto.service';
import { JwtTokenService } from '../shared/jwt.service';
import { InvalidRefreshTokenError, AccountBannedError } from '../shared/errors';
import { loadEnv } from '../config/env';

interface RefreshInput {
  refreshToken: string;
}

interface RefreshOutput {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
}

interface LockedTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
}

@Injectable()
export class RefreshSessionUseCase {
  private readonly logger = new Logger(RefreshSessionUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly userRepo: UserRepository,
    private readonly crypto: CryptoService,
    private readonly jwt: JwtTokenService,
  ) {}

  async execute(input: RefreshInput): Promise<RefreshOutput> {
    const tokenHash = this.crypto.hashToken(input.refreshToken);
    const env = loadEnv();
    const rawRefreshToken = this.crypto.generateOpaqueToken();
    const newTokenHash = this.crypto.hashToken(rawRefreshToken);

    const { userId, userEmail, userRoles } = await this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<LockedTokenRow[]>`
          SELECT id, user_id, token_hash, expires_at, revoked_at
          FROM refresh_tokens
          WHERE token_hash = ${tokenHash}
            AND revoked_at IS NULL
            AND expires_at > NOW()
          FOR UPDATE
        `;

        if (rows.length === 0) {
          throw new InvalidRefreshTokenError();
        }
        const existing = rows[0];

        const user = await this.userRepo.findById(existing.user_id);
        if (!user) {
          throw new InvalidRefreshTokenError();
        }

        if (user.bannedUntil && user.bannedUntil > new Date()) {
          throw new AccountBannedError(user.bannedUntil);
        }

        const newToken = await tx.refreshToken.create({
          data: {
            userId: user.id,
            tokenHash: newTokenHash,
            expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_SEC * 1000),
          },
        });

        await tx.refreshToken.update({
          where: { id: existing.id },
          data: {
            revokedAt: new Date(),
            replacedByTokenId: newToken.id,
          },
        });

        return {
          userId: user.id,
          userEmail: user.email,
          userRoles: user.roles,
        };
      },
      { timeout: 5000 },
    );

    const { token: accessToken, expiresInSec } = this.jwt.signAccessToken({
      sub: userId,
      email: userEmail,
      roles: userRoles,
    });

    this.logger.log(`Session refreshed: userId=${userId}`);

    return { accessToken, refreshToken: rawRefreshToken, expiresInSec };
  }
}
