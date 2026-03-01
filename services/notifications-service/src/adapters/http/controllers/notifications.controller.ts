import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
  ParseUUIDPipe,
  Headers,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import { Request } from 'express';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import {
  createNotificationSchema,
  CreateNotificationInput,
  EnqueueResponseDto,
  NotificationDetailDto,
  CancelResponseDto,
} from '../dto/notification.dto';
import { EnqueueNotificationUseCase } from '../../../application/enqueue-notification.usecase';
import { GetNotificationUseCase } from '../../../application/get-notification.usecase';
import { CancelNotificationUseCase } from '../../../application/cancel-notification.usecase';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(
    private readonly enqueue: EnqueueNotificationUseCase,
    private readonly getNotification: GetNotificationUseCase,
    private readonly cancelNotification: CancelNotificationUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Enqueue a notification (async send via worker)' })
  @ApiHeader({ name: 'idempotency-key', required: false })
  @ApiResponse({ status: 201, type: EnqueueResponseDto })
  @ApiResponse({ status: 400, description: 'Template not found / validation error' })
  @ApiResponse({ status: 409, description: 'Idempotency conflict' })
  async create(
    @Body(new ZodValidationPipe(createNotificationSchema)) input: CreateNotificationInput,
    @Req() _req: Request,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<EnqueueResponseDto> {
    return this.enqueue.execute({
      userId: input.userId,
      channel: input.channel,
      templateKey: input.templateKey,
      payload: input.payload,
      idempotencyKey,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get notification status' })
  @ApiResponse({ status: 200, type: NotificationDetailDto })
  @ApiResponse({ status: 404, description: 'Notification not found' })
  async findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<NotificationDetailDto> {
    return this.getNotification.execute(id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a pending notification' })
  @ApiResponse({ status: 200, type: CancelResponseDto })
  @ApiResponse({ status: 404, description: 'Notification not found' })
  @ApiResponse({ status: 409, description: 'Invalid state for cancellation' })
  async cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<CancelResponseDto> {
    return this.cancelNotification.execute(id);
  }
}
