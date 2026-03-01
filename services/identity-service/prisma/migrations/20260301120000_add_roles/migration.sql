-- Add roles column to users
ALTER TABLE "users" ADD COLUMN "roles" TEXT[] NOT NULL DEFAULT '{}';
