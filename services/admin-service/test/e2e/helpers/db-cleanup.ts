import { PrismaService } from '../../../src/adapters/db/prisma.service';

export async function cleanDatabase(prisma: PrismaService): Promise<void> {
  await prisma.outboxEvent.deleteMany();
  await prisma.adminCommand.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.dispute.deleteMany();
  await prisma.config.deleteMany();
}
