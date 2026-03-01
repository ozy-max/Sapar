import { PrismaService } from '../../../src/adapters/db/prisma.service';

export async function cleanDatabase(prisma: PrismaService): Promise<void> {
  await prisma.outboxEvent.deleteMany();
  await prisma.consumedEvent.deleteMany();
  await prisma.notificationEvent.deleteMany();
  await prisma.notification.deleteMany();
}
