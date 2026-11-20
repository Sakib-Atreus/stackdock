import { z } from 'zod';
import type { ProjectRuntime } from './projects.js';

export const DEPLOYMENT_STATUSES = [
  'QUEUED',
  'CLONING',
  'INSTALLING',
  'BUILDING',
  'STARTING',
  'LIVE',
  'SUPERSEDED',
  'STOPPED',
  'FAILED',
  'CANCELLED',
] as const;
export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

export const ACTIVE_DEPLOYMENT_STATUSES: readonly DeploymentStatus[] = [
  'QUEUED',
  'CLONING',
  'INSTALLING',
  'BUILDING',
  'STARTING',
];

export interface DeploymentView {
  id: string;
  projectId: string;
  status: DeploymentStatus;
  trigger: 'MANUAL' | 'BOOT';
  branch: string;
  commitSha: string | null;
  commitMessage: string | null;
  runtime: Exclude<ProjectRuntime, 'AUTO'> | null;
  errorSummary: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Only on the single-deployment endpoint. Secrets are redacted. */
  log?: string;
}

export interface RuntimeLogLine {
  seq: number;
  ts: string;
  stream: 'stdout' | 'stderr' | 'system';
  text: string;
}

export interface RuntimeLogPage {
  lines: RuntimeLogLine[];
  lastSeq: number;
}

export interface ProjectDatabaseView {
  exists: boolean;
  dbName: string | null;
  roleName: string | null;
  host: string | null;
  createdAt: string | null;
  /** True when the project sets its own DATABASE_URL (it wins over this one). */
  overriddenByEnv: boolean;
}

export const confirmSlugSchema = z.object({ confirmSlug: z.string().max(64) });
