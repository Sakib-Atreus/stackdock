-- CreateEnum
CREATE TYPE "DeploymentStatus" AS ENUM ('QUEUED', 'CLONING', 'INSTALLING', 'BUILDING', 'STARTING', 'LIVE', 'SUPERSEDED', 'STOPPED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeploymentTrigger" AS ENUM ('MANUAL', 'BOOT');

-- CreateTable
CREATE TABLE "Deployment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" "DeploymentStatus" NOT NULL DEFAULT 'QUEUED',
    "trigger" "DeploymentTrigger" NOT NULL DEFAULT 'MANUAL',
    "branch" TEXT NOT NULL,
    "commitSha" TEXT,
    "commitMessage" TEXT,
    "runtime" "ProjectRuntime",
    "errorSummary" TEXT,
    "log" TEXT NOT NULL DEFAULT '',
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Deployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectDatabase" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "dbName" TEXT NOT NULL,
    "roleName" TEXT NOT NULL,
    "encryptedPassword" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectDatabase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Deployment_projectId_queuedAt_idx" ON "Deployment"("projectId", "queuedAt");

-- CreateIndex
CREATE INDEX "Deployment_status_idx" ON "Deployment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectDatabase_projectId_key" ON "ProjectDatabase"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectDatabase_dbName_key" ON "ProjectDatabase"("dbName");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectDatabase_roleName_key" ON "ProjectDatabase"("roleName");

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDatabase" ADD CONSTRAINT "ProjectDatabase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
