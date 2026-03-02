import { PrismaClient } from '@prisma/client';

const CITIES = [
  { name: 'Бишкек', countryCode: 'KG', lat: 42.8746, lon: 74.5698 },
  { name: 'Ош', countryCode: 'KG', lat: 40.5283, lon: 72.7985 },
  { name: 'Джалал-Абад', countryCode: 'KG', lat: 40.9333, lon: 73.0017 },
  { name: 'Каракол', countryCode: 'KG', lat: 42.4907, lon: 78.3936 },
  { name: 'Токмок', countryCode: 'KG', lat: 42.7643, lon: 75.3007 },
  { name: 'Кара-Балта', countryCode: 'KG', lat: 42.8141, lon: 73.8484 },
  { name: 'Нарын', countryCode: 'KG', lat: 41.4287, lon: 76.0000 },
  { name: 'Талас', countryCode: 'KG', lat: 42.5230, lon: 72.2430 },
  { name: 'Баткен', countryCode: 'KG', lat: 40.0628, lon: 70.8194 },
  { name: 'Балыкчы', countryCode: 'KG', lat: 42.4600, lon: 76.1870 },
  { name: 'Кызыл-Кия', countryCode: 'KG', lat: 40.2567, lon: 72.1278 },
  { name: 'Узген', countryCode: 'KG', lat: 40.7709, lon: 73.3005 },
  // Latin aliases for common cities
  { name: 'Bishkek', countryCode: 'KG', lat: 42.8746, lon: 74.5698 },
  { name: 'Osh', countryCode: 'KG', lat: 40.5283, lon: 72.7985 },
  { name: 'Karakol', countryCode: 'KG', lat: 42.4907, lon: 78.3936 },
  // Kazakhstan popular destinations
  { name: 'Алматы', countryCode: 'KZ', lat: 43.2220, lon: 76.8512 },
  { name: 'Астана', countryCode: 'KZ', lat: 51.1694, lon: 71.4491 },
  { name: 'Шымкент', countryCode: 'KZ', lat: 42.3154, lon: 69.5967 },
  { name: 'Almaty', countryCode: 'KZ', lat: 43.2220, lon: 76.8512 },
  { name: 'Astana', countryCode: 'KZ', lat: 51.1694, lon: 71.4491 },
];

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    let created = 0;
    let skipped = 0;

    for (const city of CITIES) {
      const existing = await prisma.city.findFirst({
        where: { countryCode: city.countryCode, name: city.name },
      });
      if (existing) {
        skipped++;
        continue;
      }
      await prisma.city.create({ data: city });
      created++;
    }

    console.log(`Cities seed: ${created} created, ${skipped} already existed`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('Cities seed failed:', e);
  process.exit(1);
});
