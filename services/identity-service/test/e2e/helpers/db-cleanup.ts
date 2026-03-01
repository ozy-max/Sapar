import { PrismaService } from '../../../src/adapters/db/prisma.service';

export async function cleanDatabase(prisma: PrismaService): Promise<void> {
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
}
