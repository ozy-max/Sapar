import {
  Controller,
  Delete,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { CurrentUserRoles } from '../decorators/current-user.decorator';
import { ForbiddenError } from '../../../shared/errors';
import { DeleteRatingUseCase } from '../../../application/delete-rating.usecase';
import { ErrorResponseDto } from '../dto/error.dto';

@ApiTags('admin / ratings')
@Controller('admin/ratings')
export class AdminRatingsController {
  constructor(private readonly deleteRating: DeleteRatingUseCase) {}

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Soft-delete a rating (admin only)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, schema: { example: { id: 'uuid', status: 'DELETED' } } })
  @ApiResponse({ status: 401, type: ErrorResponseDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUserRoles() roles: string[],
  ): Promise<{ id: string; status: string }> {
    if (!roles.includes('ADMIN')) {
      throw new ForbiddenError();
    }
    return this.deleteRating.execute(id);
  }
}
