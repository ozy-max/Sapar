import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiResponse } from '@nestjs/swagger';
import { RegisterUserUseCase } from '../../../application/register-user.usecase';
import { LoginUserUseCase } from '../../../application/login-user.usecase';
import { RefreshSessionUseCase } from '../../../application/refresh-session.usecase';
import { LogoutUseCase } from '../../../application/logout.usecase';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';
import { registerSchema, RegisterInput, RegisterBodyDto, RegisterResponseDto } from '../dto/register.dto';
import { loginSchema, LoginInput, LoginBodyDto, LoginResponseDto } from '../dto/login.dto';
import { refreshSchema, RefreshInput, RefreshBodyDto, RefreshResponseDto } from '../dto/refresh.dto';
import { logoutSchema, LogoutInput, LogoutBodyDto } from '../dto/logout.dto';
import { ErrorResponseDto } from '../dto/error.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly registerUser: RegisterUserUseCase,
    private readonly loginUser: LoginUserUseCase,
    private readonly refreshSession: RefreshSessionUseCase,
    private readonly logoutUseCase: LogoutUseCase,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user' })
  @ApiBody({ type: RegisterBodyDto })
  @ApiResponse({ status: 201, type: RegisterResponseDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'Validation error' })
  @ApiResponse({ status: 409, type: ErrorResponseDto, description: 'Email already taken' })
  async register(
    @Body(new ZodValidationPipe(registerSchema)) input: RegisterInput,
  ): Promise<RegisterResponseDto> {
    return this.registerUser.execute(input);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiBody({ type: LoginBodyDto })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'Validation error' })
  @ApiResponse({ status: 401, type: ErrorResponseDto, description: 'Invalid credentials' })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) input: LoginInput,
  ): Promise<LoginResponseDto> {
    return this.loginUser.execute(input);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiBody({ type: RefreshBodyDto })
  @ApiResponse({ status: 200, type: RefreshResponseDto })
  @ApiResponse({ status: 401, type: ErrorResponseDto, description: 'Invalid refresh token' })
  async refresh(
    @Body(new ZodValidationPipe(refreshSchema)) input: RefreshInput,
  ): Promise<RefreshResponseDto> {
    return this.refreshSession.execute(input);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Logout (invalidate refresh token)' })
  @ApiBody({ type: LogoutBodyDto })
  @ApiResponse({ status: 204, description: 'Logged out successfully' })
  async logout(
    @Body(new ZodValidationPipe(logoutSchema)) input: LogoutInput,
  ): Promise<void> {
    await this.logoutUseCase.execute(input);
  }
}
