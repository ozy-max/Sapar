import {
  Controller,
  Post,
  Param,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
  ParseUUIDPipe,
  Headers,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { Request } from 'express';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import {
  createIntentSchema,
  CreateIntentInput,
  CreateIntentResponseDto,
  StatusResponseDto,
} from '../dto/create-intent.dto';
import { CreateIntentUseCase } from '../../../application/create-intent.usecase';
import { CaptureIntentUseCase } from '../../../application/capture-intent.usecase';
import { CancelIntentUseCase } from '../../../application/cancel-intent.usecase';
import { RefundIntentUseCase } from '../../../application/refund-intent.usecase';

@ApiTags('Payment Intents')
@ApiBearerAuth()
@Controller('payments/intents')
@UseGuards(JwtAuthGuard)
export class IntentsController {
  constructor(
    private readonly createIntent: CreateIntentUseCase,
    private readonly captureIntent: CaptureIntentUseCase,
    private readonly cancelIntent: CancelIntentUseCase,
    private readonly refundIntent: RefundIntentUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a payment intent (place hold)' })
  @ApiHeader({ name: 'idempotency-key', required: false })
  @ApiResponse({ status: 201, type: CreateIntentResponseDto })
  @ApiResponse({ status: 409, description: 'Idempotency conflict or booking exists' })
  @ApiResponse({ status: 502, description: 'PSP unavailable' })
  async create(
    @Body(new ZodValidationPipe(createIntentSchema)) input: CreateIntentInput,
    @Req() req: Request,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<CreateIntentResponseDto> {
    const userId = (req as unknown as Record<string, unknown>)['userId'] as string;
    const traceId = (req.headers['x-request-id'] as string) ?? '';
    return this.createIntent.execute({
      bookingId: input.bookingId,
      amountKgs: input.amountKgs,
      payerId: userId,
      idempotencyKey,
      traceId,
    });
  }

  @Post(':id/capture')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Capture a held payment' })
  @ApiResponse({ status: 200, type: StatusResponseDto })
  @ApiResponse({ status: 404, description: 'Intent not found' })
  @ApiResponse({ status: 409, description: 'Invalid state for capture' })
  @ApiResponse({ status: 502, description: 'PSP unavailable' })
  async capture(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
    @Headers('x-request-id') traceId?: string,
  ): Promise<StatusResponseDto> {
    const userId = (req as unknown as Record<string, unknown>)['userId'] as string;
    return this.captureIntent.execute(id, userId, traceId ?? '');
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a payment intent' })
  @ApiResponse({ status: 200, type: StatusResponseDto })
  @ApiResponse({ status: 404, description: 'Intent not found' })
  @ApiResponse({ status: 409, description: 'Invalid state for cancel' })
  @ApiResponse({ status: 502, description: 'PSP unavailable' })
  async cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
    @Headers('x-request-id') traceId?: string,
  ): Promise<StatusResponseDto> {
    const userId = (req as unknown as Record<string, unknown>)['userId'] as string;
    return this.cancelIntent.execute(id, userId, traceId ?? '');
  }

  @Post(':id/refund')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refund a captured payment' })
  @ApiResponse({ status: 200, type: StatusResponseDto })
  @ApiResponse({ status: 404, description: 'Intent not found' })
  @ApiResponse({ status: 409, description: 'Invalid state for refund' })
  @ApiResponse({ status: 502, description: 'PSP unavailable' })
  async refund(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
    @Headers('x-request-id') traceId?: string,
  ): Promise<StatusResponseDto> {
    const userId = (req as unknown as Record<string, unknown>)['userId'] as string;
    return this.refundIntent.execute(id, userId, traceId ?? '');
  }
}
