import { Injectable, Logger } from '@nestjs/common';
import { RefreshTokenRepository } from '../adapters/db/refresh-token.repository';
import { CryptoService } from '../shared/crypto.service';

interface LogoutInput {
  refreshToken: string;
}

@Injectable()
export class LogoutUseCase {
  private readonly logger = new Logger(LogoutUseCase.name);

  constructor(
    private readonly refreshTokenRepo: RefreshTokenRepository,
    private readonly crypto: CryptoService,
  ) {}

  async execute(input: LogoutInput): Promise<void> {
    const tokenHash = this.crypto.hashToken(input.refreshToken);

    const existing = await this.refreshTokenRepo.findActiveByTokenHash(tokenHash);
    if (!existing) {
      return;
    }

    await this.refreshTokenRepo.revokeById(existing.id);
    this.logger.log(`User logged out: userId=${existing.userId}`);
  }
}
