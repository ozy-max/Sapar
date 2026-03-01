import { PrismaService } from '../../../src/adapters/db/prisma.service';

export async function cleanDatabase(prisma: PrismaService): Promise<void> {
  await prisma.outboxEvent.deleteMany();
  await prisma.idempotencyRecord.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.trip.deleteMany();
}
