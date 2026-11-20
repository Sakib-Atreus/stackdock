import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { ChangePasswordInput, LoginInput } from '@stackdock/shared';
import { ActivityService } from '../activity/activity.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';

/** One generic message for every login failure (no user enumeration). */
export const INVALID_CREDENTIALS = 'Invalid email or password.';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly activity: ActivityService,
  ) {}

  async login(
    input: LoginInput,
    meta: { ip?: string; userAgent?: string; previousToken?: string },
  ) {
    const user = await this.prisma.client.adminUser.findUnique({
      where: { email: input.email },
    });
    const ok = user
      ? await this.passwords.verify(user.passwordHash, input.password)
      : await this.passwords.verifyDummy(input.password);

    if (!user || !ok) {
      await this.activity.record({
        action: 'auth.login',
        status: 'FAILURE',
        safeMetadata: { ip: meta.ip ?? null },
      });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    // New token on every login (prevents session fixation).
    if (meta.previousToken) await this.sessions.revokeToken(meta.previousToken);
    await this.sessions.deleteExpired();
    const session = await this.sessions.create(user.id, meta.userAgent);

    await this.activity.record({
      action: 'auth.login',
      status: 'SUCCESS',
      targetType: 'AdminUser',
      targetId: user.id,
      safeMetadata: { ip: meta.ip ?? null },
    });
    return { user: { id: user.id, email: user.email }, ...session };
  }

  async logout(token: string | undefined, userId?: string): Promise<void> {
    if (token) await this.sessions.revokeToken(token);
    if (userId) {
      await this.activity.record({
        action: 'auth.logout',
        status: 'SUCCESS',
        targetType: 'AdminUser',
        targetId: userId,
      });
    }
  }

  /** Changes the password and signs out every other session. */
  async changePassword(
    userId: string,
    sessionId: string,
    input: ChangePasswordInput,
  ): Promise<void> {
    const user = await this.prisma.client.adminUser.findUniqueOrThrow({
      where: { id: userId },
    });
    const ok = await this.passwords.verify(
      user.passwordHash,
      input.currentPassword,
    );
    if (!ok) {
      await this.activity.record({
        action: 'auth.password_changed',
        status: 'FAILURE',
        targetType: 'AdminUser',
        targetId: userId,
      });
      throw new UnauthorizedException('Current password is incorrect.');
    }

    await this.prisma.client.adminUser.update({
      where: { id: userId },
      data: { passwordHash: await this.passwords.hash(input.newPassword) },
    });
    const revoked = await this.sessions.revokeOthers(userId, sessionId);
    await this.activity.record({
      action: 'auth.password_changed',
      status: 'SUCCESS',
      targetType: 'AdminUser',
      targetId: userId,
      safeMetadata: { otherSessionsRevoked: revoked },
    });
  }

  async revokeOtherSessions(userId: string, sessionId: string) {
    const revoked = await this.sessions.revokeOthers(userId, sessionId);
    await this.activity.record({
      action: 'auth.sessions_revoked',
      status: 'SUCCESS',
      targetType: 'AdminUser',
      targetId: userId,
      safeMetadata: { count: revoked },
    });
    return revoked;
  }
}
