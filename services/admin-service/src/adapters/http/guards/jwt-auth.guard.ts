import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { JwtTokenService } from '../../../shared/jwt.service';
import { UnauthorizedError, ForbiddenError } from '../../../shared/errors';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtTokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedError();
    }

    const token = authHeader.slice(7);
    try {
      const payload = this.jwtService.verifyAccessToken(token);
      const roles = payload.roles ?? [];

      if (roles.length === 0) {
        throw new ForbiddenError('No admin roles assigned');
      }

      (request as unknown as Record<string, unknown>)['userId'] = payload.sub;
      (request as unknown as Record<string, unknown>)['userEmail'] = payload.email;
      (request as unknown as Record<string, unknown>)['userRoles'] = roles;
      return true;
    } catch (err) {
      if (err instanceof ForbiddenError) throw err;
      throw new UnauthorizedError();
    }
  }
}
