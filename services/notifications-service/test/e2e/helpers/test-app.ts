import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../../../src/app.module';
import { AllExceptionsFilter } from '../../../src/adapters/http/filters/all-exceptions.filter';
import { requestIdMiddleware } from '../../../src/adapters/http/middleware/request-id.middleware';
import { PrismaService } from '../../../src/adapters/db/prisma.service';
import { FakeSmsProvider } from '../../../src/adapters/providers/fake-sms.provider';
import { FakeEmailProvider } from '../../../src/adapters/providers/fake-email.provider';
import { FakePushProvider } from '../../../src/adapters/providers/fake-push.provider';
import { ProcessNotificationsUseCase } from '../../../src/application/process-notifications.usecase';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  fakeSms: FakeSmsProvider;
  fakeEmail: FakeEmailProvider;
  fakePush: FakePushProvider;
  processNotifications: ProcessNotificationsUseCase;
}

export async function createTestApp(): Promise<TestContext> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.use(requestIdMiddleware);
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();

  const prisma = app.get(PrismaService);
  const fakeSms = app.get(FakeSmsProvider);
  const fakeEmail = app.get(FakeEmailProvider);
  const fakePush = app.get(FakePushProvider);
  const processNotifications = app.get(ProcessNotificationsUseCase);

  return { app, prisma, fakeSms, fakeEmail, fakePush, processNotifications };
}
