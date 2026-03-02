import { Controller, Get, Put, Body, Param, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { CurrentUser } from '../decorators/current-user.decorator';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';
import { GetProfileUseCase } from '../../../application/get-profile.usecase';
import { UpdateProfileUseCase } from '../../../application/update-profile.usecase';
import { GetRatingsUseCase } from '../../../application/get-ratings.usecase';
import { updateProfileSchema, UpdateProfileInput, ProfileResponseDto } from '../dto/profile.dto';
import { RatingsListResponseDto } from '../dto/rating.dto';
import { ErrorResponseDto } from '../dto/error.dto';

@ApiTags('profiles')
@Controller()
export class ProfilesController {
  constructor(
    private readonly getProfile: GetProfileUseCase,
    private readonly updateProfile: UpdateProfileUseCase,
    private readonly getRatings: GetRatingsUseCase,
  ) {}

  @Get('profiles/:userId')
  @ApiOperation({ summary: 'Get public profile with rating aggregate' })
  @ApiParam({ name: 'userId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: ProfileResponseDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  async get(@Param('userId', ParseUUIDPipe) userId: string): Promise<ProfileResponseDto> {
    return this.getProfile.execute(userId);
  }

  @Get('profiles/:userId/ratings')
  @ApiOperation({ summary: 'Get paginated ratings for a user' })
  @ApiParam({ name: 'userId', type: 'string', format: 'uuid' })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiQuery({ name: 'offset', required: false, example: 0 })
  @ApiResponse({ status: 200, type: RatingsListResponseDto })
  async listRatings(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ): Promise<RatingsListResponseDto> {
    const limit = Math.min(Math.max(parseInt(limitStr ?? '20', 10) || 20, 1), 100);
    const offset = Math.max(parseInt(offsetStr ?? '0', 10) || 0, 0);
    return this.getRatings.execute({ userId, limit, offset });
  }

  @Put('me/profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update own profile (upsert)' })
  @ApiResponse({ status: 200, type: ProfileResponseDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto })
  @ApiResponse({ status: 401, type: ErrorResponseDto })
  async update(
    @CurrentUser() userId: string,
    @Body(new ZodValidationPipe(updateProfileSchema)) input: UpdateProfileInput,
  ): Promise<ProfileResponseDto> {
    const profile = await this.updateProfile.execute({ userId, ...input });
    return { ...profile, ratingAvg: 0, ratingCount: 0 };
  }
}
