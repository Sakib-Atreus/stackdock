import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  type ActiveSession,
  type ApiSuccess,
  type ChangePasswordInput,
  changePasswordSchema,
  type LoginInput,
  loginSchema,
  type SessionInfo,
} from '@stackdock/shared';
import type { Request, Response } from 'express';
import {
  type AuthContext,
  CurrentAuth,
} from '../../common/decorators/current-auth.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { ENV, type Env } from '../../config/env.js';
import { AuthService } from './auth.service.js';
import {
  clearSessionCookie,
  readSessionToken,
  setSessionCookie,
} from './session-cookie.js';
import { SessionService } from './session.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  // 5 attempts per minute and 20 per hour per client IP.
  @Throttle({
    default: { limit: 5, ttl: 60_000 },
    long: { limit: 20, ttl: 3_600_000 },
  })
  async login(
    @Body({ schema: loginSchema }) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ApiSuccess<SessionInfo>> {
    const result = await this.auth.login(body, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      previousToken: readSessionToken(req, this.env),
    });
    setSessionCookie(res, this.env, result.token, result.expiresAt);
    return {
      data: { user: result.user, expiresAt: result.expiresAt.toISOString() },
    };
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ApiSuccess<{ ok: true }>> {
    const token = readSessionToken(req, this.env);
    const session = token ? await this.sessions.validate(token) : null;
    await this.auth.logout(token, session?.user.id);
    clearSessionCookie(res, this.env);
    return { data: { ok: true } };
  }

  /** Public so the UI can ask "am I signed in?" without a 401. */
  @Public()
  @Get('session')
  async session(@Req() req: Request): Promise<ApiSuccess<SessionInfo>> {
    const token = readSessionToken(req, this.env);
    const session = token ? await this.sessions.validate(token) : null;
    return {
      data: session
        ? { user: session.user, expiresAt: session.expiresAt.toISOString() }
        : { user: null, expiresAt: null },
    };
  }

  @Post('password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async changePassword(
    @CurrentAuth() auth: AuthContext,
    @Body({ schema: changePasswordSchema }) body: ChangePasswordInput,
  ): Promise<ApiSuccess<{ ok: true }>> {
    await this.auth.changePassword(auth.user.id, auth.sessionId, body);
    return { data: { ok: true } };
  }

  @Get('sessions')
  async listSessions(
    @CurrentAuth() auth: AuthContext,
  ): Promise<ApiSuccess<ActiveSession[]>> {
    return { data: await this.sessions.list(auth.user.id, auth.sessionId) };
  }

  @Delete('sessions/others')
  async revokeOthers(
    @CurrentAuth() auth: AuthContext,
  ): Promise<ApiSuccess<{ revoked: number }>> {
    const revoked = await this.auth.revokeOtherSessions(
      auth.user.id,
      auth.sessionId,
    );
    return { data: { revoked } };
  }
}
