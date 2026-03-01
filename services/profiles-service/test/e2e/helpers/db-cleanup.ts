import { PrismaService } from '../../../src/adapters/db/prisma.service';

export async function cleanDatabase(prisma: PrismaService): Promise<void> {
  await prisma.consumedEvent.deleteMany();
  await prisma.rating.deleteMany();
  await prisma.ratingAggregate.deleteMany();
  await prisma.ratingEligibility.deleteMany();
  await prisma.userProfile.deleteMany();
}
