import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@stackdock/db';
import type { ActivityItem, ActivityPage } from '@stackdock/shared';
import { PrismaService } from '../prisma/prisma.service.js';

export type ActivityAction =
  | 'auth.login'
  | 'auth.logout'
  | 'auth.password_changed'
  | 'auth.sessions_revoked'
  | 'admin.created'
  | 'admin.password_reset'
  | 'provider.connected'
  | 'provider.tested'
  | 'provider.disconnected'
  | 'secrets.reencrypted'
  | 'project.created'
  | 'project.updated'
  | 'project.archived'
  | 'project.restored'
  | 'project.deleted'
  | 'project.env_set'
  | 'project.env_deleted';

export interface ActivityEntry {
  action: ActivityAction;
  status: 'SUCCESS' | 'FAILURE';
  targetType?: string;
  targetId?: string;
  /** Must never contain secrets, tokens, passwords or env values. */
  safeMetadata?: Record<string, string | number | boolean | null | string[]>;
}

@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Best effort: an audit-log failure never breaks the user's action. */
  async record(entry: ActivityEntry): Promise<void> {
    try {
      await this.prisma.client.activityLog.create({
        data: {
          action: entry.action,
          status: entry.status,
          targetType: entry.targetType ?? null,
          targetId: entry.targetId ?? null,
          safeMetadata: entry.safeMetadata ?? Prisma.JsonNull,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to record activity ${entry.action}: ${(error as Error).name}`,
      );
    }
  }

  /** Newest first, cursor-paginated. */
  async list(limit: number, cursor?: string): Promise<ActivityPage> {
    const rows = await this.prisma.client.activityLog.findMany({
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: page.map((r): ActivityItem => ({
        id: r.id,
        action: r.action,
        status: r.status,
        targetType: r.targetType,
        targetId: r.targetId,
        metadata: (r.safeMetadata as ActivityItem['metadata']) ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    };
  }
}
