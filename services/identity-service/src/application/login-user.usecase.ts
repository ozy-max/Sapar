import { Injectable, Logger } from '@nestjs/common';
import { UserRepository } from '../adapters/db/user.repository';
import { RefreshTokenRepository } from '../adapters/db/refresh-token.repository';
import { CryptoService } from '../shared/crypto.service';
import { JwtTokenService } from '../shared/jwt.service';
import { InvalidCredentialsError } from '../shared/errors';
import { loadEnv } from '../config/env';

interface LoginInput {
  email: string;
  password: string;
}

interface LoginOutput {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
}

@Injectable()
export class LoginUserUseCase {
  private readonly logger = new Logger(LoginUserUseCase.name);

  constructor(
    private readonly userRepo: UserRepository,
    private readonly refreshTokenRepo: RefreshTokenRepository,
    private readonly crypto: CryptoService,
    private readonly jwt: JwtTokenService,
  ) {}

  async execute(input: LoginInput): Promise<LoginOutput> {
    const email = input.email.toLowerCase().trim();

    const user = await this.userRepo.findByEmail(email);
    if (!user) {
      await this.crypto.hashPassword('dummy-password-for-timing');
      throw new InvalidCredentialsError();
    }

    const valid = await this.crypto.verifyPassword(user.passwordHash, input.password);
    if (!valid) {
      throw new InvalidCredentialsError();
    }

    await this.refreshTokenRepo.revokeAllByUserId(user.id);

    const { token: accessToken, expiresInSec } = this.jwt.signAccessToken({
      sub: user.id,
      email: user.email,
    });

    const env = loadEnv();
    const rawRefreshToken = this.crypto.generateOpaqueToken();
    const tokenHash = this.crypto.hashToken(rawRefreshToken);

    await this.refreshTokenRepo.create({
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_SEC * 1000),
    });

    this.logger.log(`User logged in: userId=${user.id}`);

    return { accessToken, refreshToken: rawRefreshToken, expiresInSec };
  }
}
