import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { loadEnv } from '../config/env';

@Injectable()
export class CryptoService {
  async hashPassword(password: string): Promise<string> {
    const env = loadEnv();
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: env.PASSWORD_HASH_MEMORY_COST ?? 65_536,
      timeCost: env.PASSWORD_HASH_TIME_COST ?? 3,
    });
  }

  async verifyPassword(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  generateOpaqueToken(): string {
    return randomBytes(32).toString('base64url');
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  constantTimeCompare(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}
