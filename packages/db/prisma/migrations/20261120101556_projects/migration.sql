-- CreateEnum
CREATE TYPE "ProjectRuntime" AS ENUM ('AUTO', 'NODE', 'PYTHON', 'GO', 'PHP');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('NOT_DEPLOYED', 'QUEUED', 'BUILDING', 'STARTING', 'RUNNING', 'CRASHED', 'STOPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "DesiredState" AS ENUM ('RUNNING', 'STOPPED');

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "repoUrl" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "runtime" "ProjectRuntime" NOT NULL DEFAULT 'AUTO',
    "rootDir" TEXT NOT NULL DEFAULT '.',
    "installCommand" TEXT,
    "buildCommand" TEXT,
    "startCommand" TEXT,
    "healthCheckPath" TEXT,
    "publicPort" INTEGER NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'NOT_DEPLOYED',
    "desiredState" "DesiredState" NOT NULL DEFAULT 'STOPPED',
    "lastCommitSha" TEXT,
    "lastDeployedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectEnvVar" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "encryptedValue" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectEnvVar_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_slug_key" ON "Project"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Project_publicPort_key" ON "Project"("publicPort");

-- CreateIndex
CREATE INDEX "Project_archivedAt_idx" ON "Project"("archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectEnvVar_projectId_key_key" ON "ProjectEnvVar"("projectId", "key");

-- AddForeignKey
ALTER TABLE "ProjectEnvVar" ADD CONSTRAINT "ProjectEnvVar_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
