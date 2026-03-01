import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  Logger,
  ParseUUIDPipe,
} from '@nestjs/common';
import { z } from 'zod';
import { AdminCommandRepository } from '../../db/admin-command.repository';
import { AuditLogRepository } from '../../db/audit-log.repository';
import { HmacGuard } from '../guards/hmac.guard';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';
import { loadEnv } from '../../../config/env';
import { ValidationError } from '../../../shared/errors';

const ackBodySchema = z.object({
  status: z.enum(['APPLIED', 'FAILED_RETRY', 'FAILED_FINAL']),
  error: z.string().optional(),
});

type AckBody = z.infer<typeof ackBodySchema>;

@Controller('internal/commands')
@UseGuards(HmacGuard)
export class InternalCommandsController {
  private readonly logger = new Logger(InternalCommandsController.name);

  constructor(
    private readonly commandRepo: AdminCommandRepository,
    private readonly auditLogRepo: AuditLogRepository,
  ) {}

  @Get()
  async listPending(
    @Query('service') service: string,
    @Query('limit') limitStr: string | undefined,
  ): Promise<{ items: unknown[] }> {
    const limit = Math.min(parseInt(limitStr ?? '10', 10) || 10, 50);

    if (service && service.length > 64) {
      throw new ValidationError({ service: 'Service name must be at most 64 characters' });
    }

    if (!service) {
      return { items: [] };
    }

    const commands = await this.commandRepo.findPendingByService(service, limit);

    return {
      items: commands.map((c) => ({
        id: c.id,
        targetService: c.targetService,
        type: c.type,
        payload: c.payload,
        status: c.status,
        tryCount: c.tryCount,
        traceId: c.traceId,
        createdAt: c.createdAt,
      })),
    };
  }

  @Post(':id/ack')
  @HttpCode(200)
  async acknowledge(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(ackBodySchema)) body: AckBody,
  ): Promise<{ id: string; status: string }> {
    const env = loadEnv();

    const command = await this.commandRepo.findById(id);
    if (!command) {
      return { id, status: 'NOT_FOUND' };
    }

    if (command.status === 'APPLIED' || command.status === 'FAILED_FINAL') {
      return { id, status: command.status };
    }

    let finalStatus = body.status;
    if (finalStatus === 'FAILED_RETRY' && command.tryCount + 1 >= env.COMMAND_MAX_RETRIES) {
      finalStatus = 'FAILED_FINAL';
    }

    const updated = await this.commandRepo.ack(id, finalStatus, body.error);

    await this.auditLogRepo.create({
      actorUserId: '00000000-0000-0000-0000-000000000000',
      actorRoles: ['SYSTEM'],
      action: 'COMMAND_ACK',
      targetType: 'AdminCommand',
      targetId: id,
      payloadJson: { status: updated.status, tryCount: updated.tryCount, error: body.error },
      traceId: command.traceId,
    });

    this.logger.log({
      msg: 'Command acknowledged',
      commandId: id,
      status: updated.status,
      tryCount: updated.tryCount,
      traceId: command.traceId,
    });

    return { id: updated.id, status: updated.status };
  }
}
