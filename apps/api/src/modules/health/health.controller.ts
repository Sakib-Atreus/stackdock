import { Controller, Get, HttpCode, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { ApiSuccess, HealthResponse } from '@stackdock/shared';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator.js';
import { ENV, type Env } from '../../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Public liveness/readiness endpoint. Exposes no secrets or config values. */
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  @HttpCode(200)
  async check(
    @Res({ passthrough: true }) res: Response,
  ): Promise<ApiSuccess<HealthResponse>> {
    const databaseUp = await this.prisma.isHealthy();
    if (!databaseUp) res.status(503);
    return {
      data: {
        status: databaseUp ? 'ok' : 'degraded',
        version: this.env.APP_VERSION,
        uptimeSeconds: Math.round(process.uptime()),
        checks: { database: databaseUp ? 'up' : 'down' },
      },
    };
  }
}
