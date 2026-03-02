import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { CurrentUser } from '../decorators/current-user.decorator';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';
import { CreateRatingUseCase } from '../../../application/create-rating.usecase';
import {
  createRatingSchema,
  CreateRatingInput,
  CreateRatingBodyDto,
  RatingResponseDto,
} from '../dto/rating.dto';
import { ErrorResponseDto } from '../dto/error.dto';

@ApiTags('ratings')
@Controller('ratings')
export class RatingsController {
  constructor(private readonly createRating: CreateRatingUseCase) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a rating for a completed trip' })
  @ApiBody({ type: CreateRatingBodyDto })
  @ApiResponse({ status: 201, type: RatingResponseDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto })
  @ApiResponse({ status: 401, type: ErrorResponseDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto })
  @ApiResponse({ status: 409, type: ErrorResponseDto })
  async create(
    @CurrentUser() userId: string,
    @Body(new ZodValidationPipe(createRatingSchema)) input: CreateRatingInput,
  ): Promise<RatingResponseDto> {
    const result = await this.createRating.execute({
      raterUserId: userId,
      bookingId: input.bookingId,
      score: input.score,
      comment: input.comment,
    });

    return {
      id: result.id,
      tripId: result.tripId,
      role: result.role,
      score: result.score,
      comment: result.comment,
      createdAt: result.createdAt,
    };
  }
}
