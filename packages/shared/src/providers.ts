import { z } from 'zod';

export const connectNorthflankSchema = z.object({
  token: z
    .string()
    .trim()
    .min(20, 'That does not look like a Northflank API token')
    .max(4096, 'Token is too long')
    .regex(/^\S+$/, 'Token must not contain spaces'),
});
export type ConnectNorthflankInput = z.infer<typeof connectNorthflankSchema>;

export interface ProviderAccountInfo {
  tokenName: string | null;
  /** Team (or org) the token belongs to. */
  entityId: string;
  entityType: string;
  roleName: string | null;
  expiresAt: string | null;
}

export interface ProviderConnectionView {
  provider: 'NORTHFLANK';
  connected: boolean;
  status: 'CONNECTED' | 'ERROR' | null;
  /** Last 4 characters of the token. The token itself is never returned. */
  tokenHint: string | null;
  account: ProviderAccountInfo | null;
  lastTestedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  connectedAt: string | null;
}

/**
 * Northflank API role permissions StackDock needs, by feature. Shown in the
 * UI. Names follow Northflank's permission tree in the API docs.
 */
export const NORTHFLANK_REQUIRED_PERMISSIONS = [
  {
    permission: 'Project › Projects › Manage › Read',
    usedFor: 'List projects',
  },
  {
    permission: 'Project › Services › General › Read',
    usedFor: 'List services and builds',
  },
  {
    permission: 'Project › Services › General › Update',
    usedFor: 'Trigger builds and add a public port per project',
  },
] as const;
