-- Task 17: Geo Search + Caching MVP
-- Enable PostGIS-lite extensions for geo distance calculations
CREATE EXTENSION IF NOT EXISTS "cube";
CREATE EXTENSION IF NOT EXISTS "earthdistance";

-- 1. Create cities table
CREATE TABLE "cities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "country_code" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cities_country_code_name_key" ON "cities"("country_code", "name");
CREATE INDEX "cities_name_idx" ON "cities"("name");
CREATE INDEX "cities_coords_idx" ON "cities" USING gist (ll_to_earth("lat", "lon"));

-- 2. Seed Kyrgyzstan cities (MVP)
INSERT INTO "cities" ("id", "name", "country_code", "lat", "lon") VALUES
  (gen_random_uuid(), 'Бишкек',       'KG', 42.8746, 74.5698),
  (gen_random_uuid(), 'Ош',           'KG', 40.5283, 72.7985),
  (gen_random_uuid(), 'Жалал-Абад',   'KG', 40.9333, 73.0000),
  (gen_random_uuid(), 'Каракол',      'KG', 42.4907, 78.3936),
  (gen_random_uuid(), 'Токмок',       'KG', 42.7631, 75.3017),
  (gen_random_uuid(), 'Балыкчы',      'KG', 42.4608, 76.1867),
  (gen_random_uuid(), 'Кара-Балта',   'KG', 42.8142, 73.8483),
  (gen_random_uuid(), 'Талас',        'KG', 42.5228, 72.2428),
  (gen_random_uuid(), 'Нарын',        'KG', 41.4287, 75.9911),
  (gen_random_uuid(), 'Узген',        'KG', 40.7708, 73.3005),
  (gen_random_uuid(), 'Кызыл-Кия',   'KG', 40.2569, 72.1275),
  (gen_random_uuid(), 'Сулюкта',      'KG', 39.9347, 69.5653),
  (gen_random_uuid(), 'Майлуу-Суу',   'KG', 41.2720, 72.4500),
  (gen_random_uuid(), 'Кербен',       'KG', 41.4937, 71.7528),
  (gen_random_uuid(), 'Ноокат',       'KG', 40.2637, 72.6209),
  (gen_random_uuid(), 'Базар-Коргон', 'KG', 41.0375, 72.7458),
  (gen_random_uuid(), 'Кара-Суу',     'KG', 40.7167, 72.8667);

-- 3. Add completed_at if missing (schema drift fix)
ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMP(3);

-- 4. Add geo columns to trips
ALTER TABLE "trips" ADD COLUMN "from_city_id" UUID;
ALTER TABLE "trips" ADD COLUMN "to_city_id" UUID;
ALTER TABLE "trips" ADD COLUMN "from_lat" DOUBLE PRECISION;
ALTER TABLE "trips" ADD COLUMN "from_lon" DOUBLE PRECISION;
ALTER TABLE "trips" ADD COLUMN "to_lat" DOUBLE PRECISION;
ALTER TABLE "trips" ADD COLUMN "to_lon" DOUBLE PRECISION;

-- 4. Foreign keys
ALTER TABLE "trips" ADD CONSTRAINT "trips_from_city_id_fkey"
    FOREIGN KEY ("from_city_id") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "trips" ADD CONSTRAINT "trips_to_city_id_fkey"
    FOREIGN KEY ("to_city_id") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. Indexes for geo queries on trips
CREATE INDEX "trips_from_city_id_to_city_id_depart_at_idx"
    ON "trips"("from_city_id", "to_city_id", "depart_at");
CREATE INDEX "trips_from_coords_idx"
    ON "trips" USING gist (ll_to_earth("from_lat", "from_lon"))
    WHERE "from_lat" IS NOT NULL AND "from_lon" IS NOT NULL;
CREATE INDEX "trips_to_coords_idx"
    ON "trips" USING gist (ll_to_earth("to_lat", "to_lon"))
    WHERE "to_lat" IS NOT NULL AND "to_lon" IS NOT NULL;

-- 6. Best-effort migration: map existing fromCity/toCity strings to city IDs + coords
UPDATE "trips" t SET
    "from_city_id" = c."id",
    "from_lat" = c."lat",
    "from_lon" = c."lon"
FROM "cities" c
WHERE lower(trim(t."from_city")) = lower(trim(c."name"));

UPDATE "trips" t SET
    "to_city_id" = c."id",
    "to_lat" = c."lat",
    "to_lon" = c."lon"
FROM "cities" c
WHERE lower(trim(t."to_city")) = lower(trim(c."name"));
