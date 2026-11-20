-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('NORTHFLANK');

-- CreateEnum
CREATE TYPE "ProviderConnectionStatus" AS ENUM ('CONNECTED', 'ERROR');

-- CreateTable
CREATE TABLE "ProviderConnection" (
    "id" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "encryptedCredential" TEXT NOT NULL,
    "credentialKeyVersion" INTEGER NOT NULL,
    "credentialHint" TEXT NOT NULL,
    "status" "ProviderConnectionStatus" NOT NULL,
    "accountInfo" JSONB,
    "lastTestedAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderConnection_provider_key" ON "ProviderConnection"("provider");
