import { Injectable, Logger } from '@nestjs/common';
import { UserRepository } from '../adapters/db/user.repository';
import { AppError } from '../shared/errors';

class UserNotFoundError extends AppError {
  constructor() {
    super('USER_NOT_FOUND', 404, 'User not found');
  }
}

interface AssignRolesInput {
  userId: string;
  roles: string[];
}

interface AssignRolesOutput {
  userId: string;
  roles: string[];
}

@Injectable()
export class AssignRolesUseCase {
  private readonly logger = new Logger(AssignRolesUseCase.name);

  constructor(private readonly userRepo: UserRepository) {}

  async execute(input: AssignRolesInput): Promise<AssignRolesOutput> {
    const user = await this.userRepo.findById(input.userId);
    if (!user) {
      throw new UserNotFoundError();
    }

    const updated = await this.userRepo.updateRoles(input.userId, input.roles);

    this.logger.log(`Roles assigned: userId=${input.userId} roles=${input.roles.join(',')}`);

    return { userId: updated.id, roles: updated.roles };
  }
}
