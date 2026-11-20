import { z } from 'zod';

/**
 * Response schemas for the Northflank endpoints we use, verified against the
 * official API reference (docs/implementation-plan.md §2.3). Unknown fields are
 * ignored; only what we need is validated.
 */

/** GET /v1/auth: "Get current authentication info". No permissions required. */
export const nfAuthInfoSchema = z.object({
  data: z.object({
    tokenKind: z.string(),
    id: z.string(),
    name: z.string().optional(),
    entityId: z.string(),
    entityType: z.string(),
    orgId: z.string().optional(),
    role: z
      .object({
        name: z.string().optional(),
        roleId: z.string().optional(),
      })
      .optional(),
    createdAt: z.string(),
    expiresAt: z.string().nullable().optional(),
  }),
});
export type NfAuthInfo = z.infer<typeof nfAuthInfoSchema>['data'];
