import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UserRepository } from '../adapters/db/user.repository';
import { CryptoService } from '../shared/crypto.service';
import { EmailTakenError } from '../shared/errors';

interface RegisterInput {
  email: string;
  password: string;
}

interface RegisterOutput {
  userId: string;
  email: string;
}

@Injectable()
export class RegisterUserUseCase {
  private readonly logger = new Logger(RegisterUserUseCase.name);

  constructor(
    private readonly userRepo: UserRepository,
    private readonly crypto: CryptoService,
  ) {}

  async execute(input: RegisterInput): Promise<RegisterOutput> {
    const email = input.email.toLowerCase().trim();

    const existing = await this.userRepo.findByEmail(email);
    if (existing) {
      throw new EmailTakenError();
    }

    const passwordHash = await this.crypto.hashPassword(input.password);

    let user;
    try {
      user = await this.userRepo.create({ email, passwordHash });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new EmailTakenError();
      }
      throw error;
    }

    this.logger.log(`User registered: userId=${user.id}`);

    return { userId: user.id, email: user.email };
  }
}
