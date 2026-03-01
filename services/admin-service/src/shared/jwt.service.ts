import { Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { loadEnv } from '../config/env';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  roles?: string[];
}

@Injectable()
export class JwtTokenService {
  verifyAccessToken(token: string): AccessTokenPayload & { iat: number; exp: number } {
    const env = loadEnv();
    return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload & {
      iat: number;
      exp: number;
    };
  }
}
