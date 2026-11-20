import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  type ApiSuccess,
  type CreateProjectInput,
  createProjectSchema,
  envKeySchema,
  type EnvVarView,
  type ProjectView,
  type SetEnvVarInput,
  setEnvVarSchema,
  type UpdateProjectInput,
  updateProjectSchema,
} from '@stackdock/shared';
import { z } from 'zod';
import { ProjectsService } from './projects.service.js';

/** Lookup-only validation: anything else can't exist, so it's a 404 path. */
const slugParam = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,7}$/, 'Invalid project name');
const listQuery = z.object({
  archived: z.enum(['true', 'false']).default('false'),
});
const deleteBody = z.object({ confirmSlug: z.string().max(64) });

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  async list(
    @Query({ schema: listQuery }) query: z.infer<typeof listQuery>,
  ): Promise<ApiSuccess<ProjectView[]>> {
    return { data: await this.projects.list(query.archived === 'true') };
  }

  @Post()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async create(
    @Body({ schema: createProjectSchema }) body: CreateProjectInput,
  ): Promise<ApiSuccess<ProjectView>> {
    return { data: await this.projects.create(body) };
  }

  @Get(':slug')
  async get(
    @Param('slug', { schema: slugParam }) slug: string,
  ): Promise<ApiSuccess<ProjectView>> {
    return { data: await this.projects.get(slug) };
  }

  @Patch(':slug')
  async update(
    @Param('slug', { schema: slugParam }) slug: string,
    @Body({ schema: updateProjectSchema }) body: UpdateProjectInput,
  ): Promise<ApiSuccess<ProjectView>> {
    return { data: await this.projects.update(slug, body) };
  }

  @Post(':slug/archive')
  @HttpCode(200)
  async archive(
    @Param('slug', { schema: slugParam }) slug: string,
  ): Promise<ApiSuccess<ProjectView>> {
    return { data: await this.projects.archive(slug) };
  }

  @Post(':slug/restore')
  @HttpCode(200)
  async restore(
    @Param('slug', { schema: slugParam }) slug: string,
  ): Promise<ApiSuccess<ProjectView>> {
    return { data: await this.projects.restore(slug) };
  }

  @Delete(':slug')
  async remove(
    @Param('slug', { schema: slugParam }) slug: string,
    @Body({ schema: deleteBody }) body: z.infer<typeof deleteBody>,
  ): Promise<ApiSuccess<{ deleted: true }>> {
    await this.projects.delete(slug, body.confirmSlug);
    return { data: { deleted: true } };
  }

  @Get(':slug/env')
  async listEnv(
    @Param('slug', { schema: slugParam }) slug: string,
  ): Promise<ApiSuccess<EnvVarView[]>> {
    return { data: await this.projects.listEnv(slug) };
  }

  @Put(':slug/env/:key')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async setEnv(
    @Param('slug', { schema: slugParam }) slug: string,
    @Param('key', { schema: envKeySchema }) key: string,
    @Body({ schema: setEnvVarSchema }) body: SetEnvVarInput,
  ): Promise<ApiSuccess<{ key: string; replaced: boolean }>> {
    return { data: await this.projects.setEnv(slug, key, body.value) };
  }

  @Delete(':slug/env/:key')
  async deleteEnv(
    @Param('slug', { schema: slugParam }) slug: string,
    @Param('key', { schema: envKeySchema }) key: string,
  ): Promise<ApiSuccess<{ deleted: true }>> {
    await this.projects.deleteEnv(slug, key);
    return { data: { deleted: true } };
  }
}
