import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../../../src/app.module';
import { AllExceptionsFilter } from '../../../src/adapters/http/filters/all-exceptions.filter';
import { requestIdMiddleware } from '../../../src/adapters/http/middleware/request-id.middleware';
import { PrismaService } from '../../../src/adapters/db/prisma.service';
import { FakePspAdapter } from '../../../src/adapters/psp/fake-psp.adapter';
import { FakeReceiptIssuer } from '../../../src/adapters/psp/fake-psp.adapter';
import { ProcessReceiptsUseCase } from '../../../src/application/process-receipts.usecase';
import { HoldPlacementWorker } from '../../../src/workers/hold-placement.worker';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  fakePsp: FakePspAdapter;
  fakeReceiptIssuer: FakeReceiptIssuer;
  processReceipts: ProcessReceiptsUseCase;
  holdWorker: HoldPlacementWorker;
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
  const fakePsp = app.get(FakePspAdapter);
  const fakeReceiptIssuer = app.get(FakeReceiptIssuer);
  const processReceipts = app.get(ProcessReceiptsUseCase);
  const holdWorker = app.get(HoldPlacementWorker);

  return { app, prisma, fakePsp, fakeReceiptIssuer, processReceipts, holdWorker };
}
