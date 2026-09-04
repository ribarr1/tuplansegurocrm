-- CreateEnum
CREATE TYPE "PersonSex" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'UNKNOWN');

-- AlterTable
ALTER TABLE "people" ADD COLUMN     "sex" "PersonSex" NOT NULL DEFAULT 'UNKNOWN';
