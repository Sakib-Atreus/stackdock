import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CsrfGuard } from './common/guards/csrf.guard.js';
import { ConfigModule } from './config/config.module.js';
import { ActivityModule } from './modules/activity/activity.module.js';
import { AuthGuard } from './modules/auth/auth.guard.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CryptoModule } from './modules/crypto/crypto.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { PrismaModule } from './modules/prisma/prisma.module.js';
import { ProjectsModule } from './modules/projects/projects.module.js';
import { ProvidersModule } from './modules/providers/providers.module.js';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    ActivityModule,
    CryptoModule,
    ThrottlerModule.forRoot({
      throttlers: [
        { name: 'default', ttl: 60_000, limit: 300 },
        { name: 'long', ttl: 3_600_000, limit: 5_000 },
      ],
      errorMessage: 'Too many requests. Please wait a moment and try again.',
    }),
    AuthModule,
    HealthModule,
    ProvidersModule,
    ProjectsModule,
  ],
  providers: [
    // Order matters: rate limit → CSRF → authentication.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useExisting: AuthGuard },
  ],
})
export class AppModule {}
