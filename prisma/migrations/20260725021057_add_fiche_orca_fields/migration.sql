-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "bloodType" VARCHAR(10),
ADD COLUMN     "drivingLicenseNumber" VARCHAR(50),
ADD COLUMN     "educationLevel" VARCHAR(100),
ADD COLUMN     "emergencyContactName" VARCHAR(150),
ADD COLUMN     "emergencyContactPhone" VARCHAR(20),
ADD COLUMN     "emergencyContactRelation" VARCHAR(50),
ADD COLUMN     "fatherName" VARCHAR(150),
ADD COLUMN     "foreignLanguages" VARCHAR(255),
ADD COLUMN     "hasDrivingLicense" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "motherName" VARCHAR(150),
ADD COLUMN     "pathology" TEXT,
ADD COLUMN     "shoeSize" VARCHAR(10),
ADD COLUMN     "uniformSize" VARCHAR(10);
