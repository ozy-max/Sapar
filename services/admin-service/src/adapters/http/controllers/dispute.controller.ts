import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  UseGuards,
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
import { CreateDisputeUseCase } from '../../../application/create-dispute.usecase';
import { GetDisputeUseCase } from '../../../application/get-dispute.usecase';
import { ResolveDisputeUseCase } from '../../../application/resolve-dispute.usecase';
import { CloseDisputeUseCase } from '../../../application/close-dispute.usecase';
import {
  createDisputeSchema,
  CreateDisputeInput,
  CreateDisputeBodyDto,
  resolveDisputeSchema,
  ResolveDisputeInput,
  ResolveDisputeBodyDto,
  DisputeResponseDto,
} from '../dto/dispute.dto';
import { ErrorResponseDto } from '../dto/error.dto';

@ApiTags('disputes')
@Controller('disputes')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class DisputeController {
  constructor(
    private readonly createDispute: CreateDisputeUseCase,
    private readonly getDispute: GetDisputeUseCase,
    private readonly resolveDispute: ResolveDisputeUseCase,
    private readonly closeDispute: CloseDisputeUseCase,
  ) {}

  @Post()
  @Roles('ADMIN', 'SUPPORT')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new dispute' })
  @ApiBody({ type: CreateDisputeBodyDto })
  @ApiResponse({ status: 201, type: DisputeResponseDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto })
  async create(
    @Body(new ZodValidationPipe(createDisputeSchema)) input: CreateDisputeInput,
    @CurrentUser() userId: string,
    @CurrentUserRoles() roles: string[],
    @Headers('x-request-id') traceId: string,
  ): Promise<DisputeResponseDto> {
    return this.createDispute.execute({
      ...input,
      actorUserId: userId,
      actorRoles: roles,
      traceId,
    }) as unknown as DisputeResponseDto;
  }

  @Get(':id')
  @Roles('ADMIN', 'SUPPORT')
  @ApiOperation({ summary: 'Get dispute by ID' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: DisputeResponseDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  async getById(@Param('id') id: string): Promise<DisputeResponseDto> {
    return this.getDispute.execute(id) as unknown as DisputeResponseDto;
  }

  @Post(':id/resolve')
  @Roles('ADMIN', 'SUPPORT')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve a dispute' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiBody({ type: ResolveDisputeBodyDto })
  @ApiResponse({ status: 200, type: DisputeResponseDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'SLA expired or invalid state' })
  async resolve(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(resolveDisputeSchema)) input: ResolveDisputeInput,
    @CurrentUser() userId: string,
    @CurrentUserRoles() roles: string[],
    @Headers('x-request-id') traceId: string,
  ): Promise<DisputeResponseDto> {
    return this.resolveDispute.execute({
      disputeId: id,
      resolution: input.resolution,
      actorUserId: userId,
      actorRoles: roles,
      traceId,
    }) as unknown as DisputeResponseDto;
  }

  @Post(':id/close')
  @Roles('ADMIN', 'SUPPORT')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close a dispute' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  @ApiResponse({ status: 409, type: ErrorResponseDto })
  async close(
    @Param('id') id: string,
    @CurrentUser() userId: string,
    @CurrentUserRoles() roles: string[],
    @Headers('x-request-id') traceId: string,
  ): Promise<{ id: string; status: string }> {
    return this.closeDispute.execute({
      disputeId: id,
      actorUserId: userId,
      actorRoles: roles,
      traceId,
    });
  }
}
