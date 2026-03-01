import { Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { loadEnv } from '../config/env';

export interface AccessTokenPayload {
  sub: string;
  email: string;
}

export interface SignedToken {
  token: string;
  expiresInSec: number;
}

@Injectable()
export class JwtTokenService {
  signAccessToken(payload: AccessTokenPayload): SignedToken {
    const env = loadEnv();
    const token = jwt.sign(payload, env.JWT_ACCESS_SECRET, {
      expiresIn: env.JWT_ACCESS_TTL_SEC,
    });
    return { token, expiresInSec: env.JWT_ACCESS_TTL_SEC };
  }

  verifyAccessToken(token: string): AccessTokenPayload & { iat: number; exp: number } {
    const env = loadEnv();
    return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload & {
      iat: number;
      exp: number;
    };
  }
}
