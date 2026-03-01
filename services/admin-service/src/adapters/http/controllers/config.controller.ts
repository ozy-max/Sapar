import {
  Controller,
  Get,
  Put,
  Delete,
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
import { GetConfigsUseCase } from '../../../application/get-configs.usecase';
import { GetConfigByKeyUseCase } from '../../../application/get-config-by-key.usecase';
import { UpsertConfigUseCase } from '../../../application/upsert-config.usecase';
import { DeleteConfigUseCase } from '../../../application/delete-config.usecase';
import { upsertConfigSchema, UpsertConfigInput, UpsertConfigBodyDto, ConfigResponseDto } from '../dto/config.dto';
import { ErrorResponseDto } from '../dto/error.dto';
import { ValidationError } from '../../../shared/errors';

@ApiTags('configs')
@Controller('configs')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class ConfigController {
  constructor(
    private readonly getConfigs: GetConfigsUseCase,
    private readonly getConfigByKey: GetConfigByKeyUseCase,
    private readonly upsertConfig: UpsertConfigUseCase,
    private readonly deleteConfig: DeleteConfigUseCase,
  ) {}

  @Get()
  @Roles('ADMIN', 'OPS', 'SUPPORT')
  @ApiOperation({ summary: 'List all configs' })
  @ApiResponse({ status: 200, type: [ConfigResponseDto] })
  @ApiResponse({ status: 401, type: ErrorResponseDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto })
  async list(): Promise<{ items: ConfigResponseDto[] }> {
    return this.getConfigs.execute();
  }

  @Get(':key')
  @Roles('ADMIN', 'OPS', 'SUPPORT')
  @ApiOperation({ summary: 'Get config by key' })
  @ApiParam({ name: 'key', type: 'string' })
  @ApiResponse({ status: 200, type: ConfigResponseDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  async getByKey(@Param('key') key: string): Promise<ConfigResponseDto> {
    this.validateKeyLength(key);
    return this.getConfigByKey.execute(key);
  }

  @Put(':key')
  @Roles('ADMIN', 'OPS')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Upsert config by key' })
  @ApiParam({ name: 'key', type: 'string' })
  @ApiBody({ type: UpsertConfigBodyDto })
  @ApiResponse({ status: 200, type: ConfigResponseDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto })
  async upsert(
    @Param('key') key: string,
    @Body(new ZodValidationPipe(upsertConfigSchema)) input: UpsertConfigInput,
    @CurrentUser() userId: string,
    @CurrentUserRoles() roles: string[],
    @Headers('x-request-id') traceId: string,
  ): Promise<ConfigResponseDto> {
    this.validateKeyLength(key);
    return this.upsertConfig.execute({
      key,
      type: input.type,
      value: input.value,
      description: input.description,
      scope: input.scope,
      actorUserId: userId,
      actorRoles: roles,
      traceId,
    });
  }

  @Delete(':key')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete config by key' })
  @ApiParam({ name: 'key', type: 'string' })
  @ApiResponse({ status: 204, description: 'Config deleted' })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  async remove(
    @Param('key') key: string,
    @CurrentUser() userId: string,
    @CurrentUserRoles() roles: string[],
    @Headers('x-request-id') traceId: string,
  ): Promise<void> {
    this.validateKeyLength(key);
    await this.deleteConfig.execute({
      key,
      actorUserId: userId,
      actorRoles: roles,
      traceId,
    });
  }

  private validateKeyLength(key: string): void {
    if (key.length > 256) {
      throw new ValidationError({ key: 'Config key must be at most 256 characters' });
    }
  }
}
