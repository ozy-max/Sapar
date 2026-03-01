import { randomUUID } from 'node:crypto';
import {
  Controller,
  Post,
  Param,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { CurrentUser, CurrentUserRoles } from '../decorators/current-user.decorator';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';
import { BanUserUseCase } from '../../../application/ban-user.usecase';
import { UnbanUserUseCase } from '../../../application/unban-user.usecase';
import { CancelTripUseCase } from '../../../application/cancel-trip.usecase';
import {
  banUserSchema,
  BanUserInput,
  BanUserBodyDto,
  unbanUserSchema,
  UnbanUserInput,
  UnbanUserBodyDto,
  cancelTripSchema,
  CancelTripInput,
  CancelTripBodyDto,
  ModerationCommandResponseDto,
} from '../dto/moderation.dto';
import { ErrorResponseDto } from '../dto/error.dto';
import { ForbiddenError } from '../../../shared/errors';

@ApiTags('moderation')
@Controller('moderation')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class ModerationController {
  constructor(
    private readonly banUser: BanUserUseCase,
    private readonly unbanUser: UnbanUserUseCase,
    private readonly cancelTrip: CancelTripUseCase,
  ) {}

  @Post('users/:userId/ban')
  @Roles('ADMIN', 'OPS')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Ban a user' })
  @ApiParam({ name: 'userId', type: 'string', format: 'uuid' })
  @ApiBody({ type: BanUserBodyDto })
  @ApiResponse({ status: 201, type: ModerationCommandResponseDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto })
  async ban(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body(new ZodValidationPipe(banUserSchema)) input: BanUserInput,
    @CurrentUser() actorId: string,
    @CurrentUserRoles() roles: string[],
    @Headers('x-request-id') rawTraceId: string | undefined,
  ): Promise<ModerationCommandResponseDto> {
    const traceId = rawTraceId || randomUUID();
    if (userId === actorId) {
      throw new ForbiddenError('Cannot ban yourself');
    }
    return this.banUser.execute({
      userId,
      reason: input.reason,
      until: input.until,
      actorUserId: actorId,
      actorRoles: roles,
      traceId,
    });
  }

  @Post('users/:userId/unban')
  @Roles('ADMIN', 'OPS')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Unban a user' })
  @ApiParam({ name: 'userId', type: 'string', format: 'uuid' })
  @ApiBody({ type: UnbanUserBodyDto })
  @ApiResponse({ status: 201, type: ModerationCommandResponseDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto })
  async unban(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body(new ZodValidationPipe(unbanUserSchema)) input: UnbanUserInput,
    @CurrentUser() actorId: string,
    @CurrentUserRoles() roles: string[],
    @Headers('x-request-id') rawTraceId: string | undefined,
  ): Promise<ModerationCommandResponseDto> {
    const traceId = rawTraceId || randomUUID();
    return this.unbanUser.execute({
      userId,
      reason: input.reason,
      actorUserId: actorId,
      actorRoles: roles,
      traceId,
    });
  }

  @Post('trips/:tripId/cancel')
  @Roles('ADMIN', 'OPS')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Cancel a trip (admin)' })
  @ApiParam({ name: 'tripId', type: 'string', format: 'uuid' })
  @ApiBody({ type: CancelTripBodyDto })
  @ApiResponse({ status: 201, type: ModerationCommandResponseDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto })
  async cancel(
    @Param('tripId', new ParseUUIDPipe()) tripId: string,
    @Body(new ZodValidationPipe(cancelTripSchema)) input: CancelTripInput,
    @CurrentUser() actorId: string,
    @CurrentUserRoles() roles: string[],
    @Headers('x-request-id') rawTraceId: string | undefined,
  ): Promise<ModerationCommandResponseDto> {
    const traceId = rawTraceId || randomUUID();
    return this.cancelTrip.execute({
      tripId,
      reason: input.reason,
      actorUserId: actorId,
      actorRoles: roles,
      traceId,
    });
  }
}
