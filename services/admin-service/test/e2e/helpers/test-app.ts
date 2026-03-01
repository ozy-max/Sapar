import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../../../src/app.module';
import { AllExceptionsFilter } from '../../../src/adapters/http/filters/all-exceptions.filter';
import { requestIdMiddleware } from '../../../src/adapters/http/middleware/request-id.middleware';
import { PrismaService } from '../../../src/adapters/db/prisma.service';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
}

export async function createTestApp(): Promise<TestContext> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication({ rawBody: true });
  app.use(requestIdMiddleware);
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();

  const prisma = app.get(PrismaService);

  return { app, prisma };
}
