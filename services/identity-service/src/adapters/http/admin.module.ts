import { Module } from '@nestjs/common';
import { AdminController } from './controllers/admin.controller';
import { AssignRolesUseCase } from '../../application/assign-roles.usecase';

@Module({
  controllers: [AdminController],
  providers: [AssignRolesUseCase],
})
export class AdminModule {}
