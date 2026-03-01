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
} from '@nestjs/common';
import { AdminCommandRepository } from '../../db/admin-command.repository';
import { HmacGuard } from '../guards/hmac.guard';
import { loadEnv } from '../../../config/env';

interface AckBody {
  status: 'APPLIED' | 'FAILED_RETRY' | 'FAILED_FINAL';
  error?: string;
}

@Controller('internal/commands')
@UseGuards(HmacGuard)
export class InternalCommandsController {
  private readonly logger = new Logger(InternalCommandsController.name);

  constructor(private readonly commandRepo: AdminCommandRepository) {}

  @Get()
  async listPending(
    @Query('service') service: string,
    @Query('limit') limitStr: string | undefined,
  ): Promise<{ items: unknown[] }> {
    const limit = Math.min(parseInt(limitStr ?? '10', 10) || 10, 50);

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
    @Param('id') id: string,
    @Body() body: AckBody,
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
