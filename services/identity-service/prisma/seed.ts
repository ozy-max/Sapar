import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const ADMIN_EMAIL = process.env['SEED_ADMIN_EMAIL'] || 'admin@sapar.kg';
const ADMIN_PASSWORD = process.env['SEED_ADMIN_PASSWORD'] || 'AdminPass123!';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const existing = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
    if (existing) {
      if (!existing.roles.includes('ADMIN')) {
        await prisma.user.update({
          where: { id: existing.id },
          data: { roles: [...new Set([...existing.roles, 'ADMIN'])] },
        });
        console.log(`Updated existing user ${ADMIN_EMAIL} with ADMIN role (id: ${existing.id})`);
      } else {
        console.log(`Admin user ${ADMIN_EMAIL} already exists with ADMIN role (id: ${existing.id})`);
      }
      return;
    }

    const passwordHash = await argon2.hash(ADMIN_PASSWORD, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    const user = await prisma.user.create({
      data: {
        email: ADMIN_EMAIL,
        passwordHash,
        roles: ['ADMIN'],
      },
    });
    console.log(`Created admin user: ${ADMIN_EMAIL} (id: ${user.id})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('Seed failed:', e);
  process.exit(1);
});
