import { createHmac, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ActiveSession, SessionUser } from '@stackdock/shared';
import { ENV, type Env } from '../../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';

const HOUR_MS = 3_600_000;
/** Don't write lastSeenAt on every request. */
const TOUCH_INTERVAL_MS = 5 * 60_000;

export interface ValidSession {
  sessionId: string;
  user: SessionUser;
  expiresAt: Date;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Opaque 256-bit token; only its HMAC is stored. */
  static generateToken(): string {
    return randomBytes(32).toString('base64url');
  }

  hashToken(token: string): string {
    return createHmac('sha256', this.env.SESSION_SECRET)
      .update(token)
      .digest('hex');
  }

  async create(
    userId: string,
    userAgent?: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = SessionService.generateToken();
    const expiresAt = new Date(
      Date.now() + this.env.SESSION_TTL_HOURS * HOUR_MS,
    );
    await this.prisma.client.session.create({
      data: {
        userId,
        tokenHash: this.hashToken(token),
        expiresAt,
        userAgent: userAgent?.slice(0, 200) ?? null,
      },
    });
    return { token, expiresAt };
  }

  async validate(token: string): Promise<ValidSession | null> {
    const session = await this.prisma.client.session.findUnique({
      where: { tokenHash: this.hashToken(token) },
      include: { user: { select: { id: true, email: true } } },
    });
    if (!session) return null;

    const now = Date.now();
    const idleLimit =
      session.lastSeenAt.getTime() + this.env.SESSION_IDLE_HOURS * HOUR_MS;
    if (session.expiresAt.getTime() <= now || idleLimit <= now) {
      await this.prisma.client.session
        .delete({ where: { id: session.id } })
        .catch(() => undefined);
      return null;
    }

    if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.client.session.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date(now) },
      });
    }

    return {
      sessionId: session.id,
      user: session.user,
      expiresAt: session.expiresAt,
    };
  }

  async revokeToken(token: string): Promise<void> {
    await this.prisma.client.session.deleteMany({
      where: { tokenHash: this.hashToken(token) },
    });
  }

  async revokeOthers(userId: string, keepSessionId: string): Promise<number> {
    const { count } = await this.prisma.client.session.deleteMany({
      where: { userId, id: { not: keepSessionId } },
    });
    return count;
  }

  async list(userId: string, currentId: string): Promise<ActiveSession[]> {
    const rows = await this.prisma.client.session.findMany({
      where: { userId, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
    });
    return rows.map((s) => ({
      id: s.id,
      current: s.id === currentId,
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      userAgent: s.userAgent,
    }));
  }

  async deleteExpired(): Promise<void> {
    const idleCutoff = new Date(
      Date.now() - this.env.SESSION_IDLE_HOURS * HOUR_MS,
    );
    await this.prisma.client.session.deleteMany({
      where: {
        OR: [
          { expiresAt: { lte: new Date() } },
          { lastSeenAt: { lte: idleCutoff } },
        ],
      },
    });
  }
}
