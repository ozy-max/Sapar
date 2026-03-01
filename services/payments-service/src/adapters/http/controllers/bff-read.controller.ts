import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { z } from 'zod';
import { PaymentIntentRepository } from '../../db/payment-intent.repository';
import { ReceiptRepository } from '../../db/receipt.repository';
import { HmacGuard } from '../guards/hmac.guard';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';

const batchSummarySchema = z.object({
  bookingIds: z.array(z.string().uuid()).min(1).max(200),
});

interface PaymentSummary {
  bookingId: string;
  paymentIntentId: string | null;
  paymentStatus: string | null;
  amountKgs: number | null;
  receiptStatus: string | null;
}

@ApiTags('BFF Read')
@UseGuards(HmacGuard)
@Controller('bff')
export class BffReadController {
  constructor(
    private readonly intentRepo: PaymentIntentRepository,
    private readonly receiptRepo: ReceiptRepository,
  ) {}

  @Get('bookings/:bookingId/payment-summary')
  @ApiOperation({ summary: 'Payment summary for a booking (BFF read)' })
  @ApiParam({ name: 'bookingId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Payment summary' })
  async getPaymentSummary(
    @Param('bookingId', new ParseUUIDPipe()) bookingId: string,
  ): Promise<PaymentSummary> {
    const intent = await this.intentRepo.findByBookingId(bookingId);
    if (!intent) {
      return {
        bookingId,
        paymentIntentId: null,
        paymentStatus: null,
        amountKgs: null,
        receiptStatus: null,
      };
    }

    const receipt = await this.receiptRepo.findByPaymentIntentId(intent.id);

    return {
      bookingId,
      paymentIntentId: intent.id,
      paymentStatus: intent.status,
      amountKgs: intent.amountKgs,
      receiptStatus: receipt?.status ?? null,
    };
  }

  @Post('payments/summary')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch payment summaries for bookings (BFF read)' })
  @ApiResponse({ status: 200, description: 'Batch payment summaries' })
  async batchPaymentSummary(
    @Body(new ZodValidationPipe(batchSummarySchema)) body: { bookingIds: string[] },
  ): Promise<{ items: PaymentSummary[] }> {
    const ids = body.bookingIds;

    const intents = await this.intentRepo.findByBookingIds(ids);
    const intentMap = new Map(intents.map((i) => [i.bookingId, i]));

    const intentIds = intents.map((i) => i.id);
    const receipts = await this.receiptRepo.findByPaymentIntentIds(intentIds);
    const receiptMap = new Map(receipts.map((r) => [r.paymentIntentId, r.status]));

    const items: PaymentSummary[] = ids.map((bookingId) => {
      const intent = intentMap.get(bookingId);
      if (!intent) {
        return {
          bookingId,
          paymentIntentId: null,
          paymentStatus: null,
          amountKgs: null,
          receiptStatus: null,
        };
      }
      return {
        bookingId,
        paymentIntentId: intent.id,
        paymentStatus: intent.status,
        amountKgs: intent.amountKgs,
        receiptStatus: receiptMap.get(intent.id) ?? null,
      };
    });

    return { items };
  }
}
