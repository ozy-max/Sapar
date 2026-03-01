import { PrismaService } from '../../../src/adapters/db/prisma.service';

export async function cleanDatabase(prisma: PrismaService): Promise<void> {
  await prisma.outboxEvent.deleteMany();
  await prisma.consumedEvent.deleteMany();
  await prisma.receipt.deleteMany();
  await prisma.paymentEvent.deleteMany();
  await prisma.paymentIntent.deleteMany();
}
