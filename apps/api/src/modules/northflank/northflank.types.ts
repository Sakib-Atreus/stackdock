import { z } from 'zod';

/**
 * Response schemas for the Northflank endpoints we use, verified against the
 * official API reference. Unknown fields are ignored (objects are not strict);
 * only what StackDock needs is validated.
 */

const pagination = z
  .object({
    hasNextPage: z.boolean(),
    cursor: z.string().optional(),
    count: z.number().optional(),
  })
  .optional();

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

/** GET /v1/projects */
export const nfProjectsSchema = z.object({
  data: z.object({
    projects: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().optional(),
      }),
    ),
  }),
  pagination,
});

const statusSchema = z
  .object({
    build: z
      .object({ status: z.string(), lastTransitionTime: z.string().optional() })
      .optional(),
    deployment: z
      .object({
        status: z.string(),
        reason: z.string().optional(),
        lastTransitionTime: z.string().optional(),
      })
      .optional(),
  })
  .optional();

/** GET /v1/projects/{projectId}/services */
export const nfServicesSchema = z.object({
  data: z.object({
    services: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().optional(),
        serviceType: z.string(),
        disabledCI: z.boolean().optional(),
        disabledCD: z.boolean().optional(),
        status: statusSchema,
      }),
    ),
  }),
  pagination,
});

/** A port as returned by GET service and accepted by PATCH (other fields passed through). */
export const nfPortSchema = z
  .object({
    name: z.string(),
    internalPort: z.number(),
    public: z.boolean().optional(),
    protocol: z.string(),
  })
  .loose();
export type NfPort = z.infer<typeof nfPortSchema>;

/** GET /v1/projects/{projectId}/services/{serviceId} */
export const nfServiceSchema = z.object({
  data: z
    .object({
      id: z.string(),
      name: z.string(),
      serviceType: z.string(),
      ports: z.array(nfPortSchema).optional(),
      vcsData: z
        .object({
          projectUrl: z.string().optional(),
          projectBranch: z.string().optional(),
        })
        .loose()
        .optional(),
      status: statusSchema,
    })
    .loose(),
});
export type NfService = z.infer<typeof nfServiceSchema>['data'];

/** GET /v1/projects/{projectId}/services/{serviceId}/build */
export const nfBuildsSchema = z.object({
  data: z.object({
    builds: z.array(
      z.object({
        id: z.string(),
        branch: z.string().optional(),
        sha: z.string().optional(),
        status: z.string().optional(),
        concluded: z.boolean().optional(),
        success: z.boolean().optional(),
        message: z.string().nullable().optional(),
        createdAt: z.union([z.string(), z.number()]).optional(),
        buildConcludedAt: z.union([z.string(), z.number()]).optional(),
      }),
    ),
  }),
  pagination,
});

/** POST /v1/projects/{projectId}/services/{serviceId}/build */
export const nfStartBuildSchema = z.object({
  data: z.object({
    id: z.string(),
    branch: z.string().optional(),
    sha: z.string().optional(),
    status: z.string().optional(),
  }),
});

/** PATCH …/services/{combined|deployment}/{serviceId}: we only need confirmation. */
export const nfPatchServiceSchema = z.object({
  data: z.object({ id: z.string() }).loose(),
});
