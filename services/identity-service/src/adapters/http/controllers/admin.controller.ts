import { Controller, Post, Param, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';
import { AssignRolesUseCase } from '../../../application/assign-roles.usecase';
import {
  assignRolesSchema,
  AssignRolesInput,
  AssignRolesBodyDto,
  AssignRolesResponseDto,
} from '../dto/assign-roles.dto';
import { ErrorResponseDto } from '../dto/error.dto';

@ApiTags('admin')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AdminController {
  constructor(private readonly assignRoles: AssignRolesUseCase) {}

  @Post('users/:userId/roles')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign roles to a user (ADMIN only)' })
  @ApiParam({ name: 'userId', type: 'string', format: 'uuid' })
  @ApiBody({ type: AssignRolesBodyDto })
  @ApiResponse({ status: 200, type: AssignRolesResponseDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  async assign(
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(assignRolesSchema)) input: AssignRolesInput,
  ): Promise<AssignRolesResponseDto> {
    return this.assignRoles.execute({ userId, roles: input.roles });
  }
}
