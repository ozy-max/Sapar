import { Module } from '@nestjs/common';
import { AuthController } from './controllers/auth.controller';
import { RegisterUserUseCase } from '../../application/register-user.usecase';
import { LoginUserUseCase } from '../../application/login-user.usecase';
import { RefreshSessionUseCase } from '../../application/refresh-session.usecase';
import { LogoutUseCase } from '../../application/logout.usecase';

@Module({
  controllers: [AuthController],
  providers: [RegisterUserUseCase, LoginUserUseCase, RefreshSessionUseCase, LogoutUseCase],
})
export class AuthModule {}
