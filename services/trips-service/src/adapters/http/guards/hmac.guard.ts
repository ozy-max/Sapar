import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { verifyEvent } from '../../../shared/hmac';
import { loadEnv } from '../../../config/env';
import { UnauthorizedError } from '../../../shared/errors';

interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

@Injectable()
export class HmacGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RawBodyRequest>();
    const signature = req.headers['x-event-signature'] as string | undefined;
    const timestampStr = req.headers['x-event-timestamp'] as string | undefined;
    const rawBody = req.rawBody;

    if (!signature || !timestampStr || !rawBody) {
      throw new UnauthorizedError();
    }

    const timestamp = parseInt(timestampStr, 10);
    if (isNaN(timestamp)) {
      throw new UnauthorizedError();
    }

    const env = loadEnv();
    const valid = verifyEvent(
      rawBody.toString('utf-8'),
      timestamp,
      signature,
      env.EVENTS_HMAC_SECRET,
    );

    if (!valid) {
      throw new UnauthorizedError();
    }

    return true;
  }
}
