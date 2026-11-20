import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  type ApiSuccess,
  confirmSlugSchema,
  type DeploymentView,
  type ProjectDatabaseView,
  type RuntimeLogPage,
} from '@stackdock/shared';
import { z } from 'zod';
import { AppError } from '../../common/errors/app-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectDatabaseService } from './project-database.service.js';
import { RunnerService } from './runner.service.js';

const slugParam = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,7}$/, 'Invalid project name');
const idParam = z.string().regex(/^[a-z0-9]{10,40}$/, 'Invalid id');
const logsQuery = z.object({
  after: z.coerce.number().int().min(0).default(0),
});

@Controller()
export class RunnerController {
  constructor(
    private readonly runner: RunnerService,
    private readonly databases: ProjectDatabaseService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('projects/:slug/deploy')
  @HttpCode(202)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async deploy(
    @Param('slug', { schema: slugParam }) slug: string,
  ): Promise<ApiSuccess<DeploymentView>> {
    return { data: await this.runner.deploy(slug) };
  }

  @Post('projects/:slug/stop')
  @HttpCode(200)
  async stop(
    @Param('slug', { schema: slugParam }) slug: string,
  ): Promise<ApiSuccess<{ ok: true }>> {
    await this.runner.stop(slug);
    await this.audit(slug, 'project.stopped');
    return { data: { ok: true } };
  }

  @Post('projects/:slug/restart')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async restart(
    @Param('slug', { schema: slugParam }) slug: string,
  ): Promise<ApiSuccess<{ ok: true }>> {
    await this.runner.restart(slug);
    await this.audit(slug, 'project.restarted');
    return { data: { ok: true } };
  }

  @Get('projects/:slug/deployments')
  async deployments(
    @Param('slug', { schema: slugParam }) slug: string,
  ): Promise<ApiSuccess<DeploymentView[]>> {
    return { data: await this.runner.listDeployments(slug) };
  }

  @Get('deployments/:id')
  async deployment(
    @Param('id', { schema: idParam }) id: string,
  ): Promise<ApiSuccess<DeploymentView>> {
    return { data: await this.runner.getDeployment(id) };
  }

  @Post('deployments/:id/cancel')
  @HttpCode(200)
  async cancel(
    @Param('id', { schema: idParam }) id: string,
  ): Promise<ApiSuccess<DeploymentView>> {
    const view = await this.runner.cancel(id);
    await this.prisma.client.activityLog.create({
      data: {
        action: 'project.deploy_cancelled',
        status: 'SUCCESS',
        targetType: 'Deployment',
        targetId: id,
      },
    });
    return { data: view };
  }

  @Get('projects/:slug/logs')
  async logs(
    @Param('slug', { schema: slugParam }) slug: string,
    @Query({ schema: logsQuery }) query: z.infer<typeof logsQuery>,
  ): Promise<ApiSuccess<RuntimeLogPage>> {
    await this.projectId(slug);
    return { data: this.runner.runtimeLogs(slug, query.after) };
  }

  @Get('projects/:slug/database')
  async database(
    @Param('slug', { schema: slugParam }) slug: string,
  ): Promise<ApiSuccess<ProjectDatabaseView>> {
    return { data: await this.databases.view(await this.projectId(slug)) };
  }

  @Post('projects/:slug/database')
  @HttpCode(201)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async createDatabase(
    @Param('slug', { schema: slugParam }) slug: string,
  ): Promise<ApiSuccess<ProjectDatabaseView>> {
    const projectId = await this.projectId(slug, true);
    return { data: await this.databases.create(projectId, slug) };
  }

  @Delete('projects/:slug/database')
  async dropDatabase(
    @Param('slug', { schema: slugParam }) slug: string,
    @Body({ schema: confirmSlugSchema })
    body: z.infer<typeof confirmSlugSchema>,
  ): Promise<ApiSuccess<ProjectDatabaseView>> {
    if (body.confirmSlug !== slug) {
      throw new AppError(
        400,
        'CONFIRMATION_MISMATCH',
        'Type the project name exactly to confirm.',
        {
          field: 'confirmSlug',
        },
      );
    }
    return {
      data: await this.databases.drop(await this.projectId(slug), slug),
    };
  }

  private async projectId(slug: string, mustBeActive = false): Promise<string> {
    const project = await this.prisma.client.project.findUnique({
      where: { slug },
      select: { id: true, archivedAt: true },
    });
    if (!project)
      throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');
    if (mustBeActive && project.archivedAt) {
      throw new AppError(
        409,
        'PROJECT_ARCHIVED',
        'This project is archived. Restore it first.',
      );
    }
    return project.id;
  }

  private async audit(
    slug: string,
    action: 'project.stopped' | 'project.restarted',
  ) {
    const id = await this.projectId(slug);
    await this.prisma.client.activityLog.create({
      data: {
        action,
        status: 'SUCCESS',
        targetType: 'Project',
        targetId: id,
        safeMetadata: { slug },
      },
    });
  }
}
