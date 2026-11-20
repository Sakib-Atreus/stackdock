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
  branchSchema,
  type ExposeResult,
  type NfBuildView,
  type NfProjectView,
  type NfSelfView,
  type NfServiceDetailView,
  type NfServiceView,
} from '@stackdock/shared';
import { z } from 'zod';
import { NorthflankService } from './northflank.service.js';

const nfId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'Invalid Northflank ID');
const slugParam = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,7}$/, 'Invalid project name');
const refreshQuery = z.object({
  refresh: z.enum(['true', 'false']).default('false'),
});
const buildBody = z.object({ branch: branchSchema.optional() });

/** Fixed routes only: the browser can never pass a Northflank URL or method (no SSRF). */
@Controller()
export class NorthflankController {
  constructor(private readonly northflank: NorthflankService) {}

  @Get('northflank/projects')
  async projects(
    @Query({ schema: refreshQuery }) q: z.infer<typeof refreshQuery>,
  ): Promise<ApiSuccess<NfProjectView[]>> {
    return { data: await this.northflank.projects(q.refresh === 'true') };
  }

  @Get('northflank/projects/:projectId/services')
  async services(
    @Param('projectId', { schema: nfId }) projectId: string,
    @Query({ schema: refreshQuery }) q: z.infer<typeof refreshQuery>,
  ): Promise<ApiSuccess<NfServiceView[]>> {
    return {
      data: await this.northflank.services(projectId, q.refresh === 'true'),
    };
  }

  @Get('northflank/projects/:projectId/services/:serviceId')
  async service(
    @Param('projectId', { schema: nfId }) projectId: string,
    @Param('serviceId', { schema: nfId }) serviceId: string,
    @Query({ schema: refreshQuery }) q: z.infer<typeof refreshQuery>,
  ): Promise<ApiSuccess<NfServiceDetailView>> {
    return {
      data: await this.northflank.service(
        projectId,
        serviceId,
        q.refresh === 'true',
      ),
    };
  }

  @Post('northflank/projects/:projectId/services/:serviceId/build')
  @HttpCode(202)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async build(
    @Param('projectId', { schema: nfId }) projectId: string,
    @Param('serviceId', { schema: nfId }) serviceId: string,
    @Body({ schema: buildBody }) body: z.infer<typeof buildBody>,
  ): Promise<ApiSuccess<NfBuildView>> {
    return {
      data: await this.northflank.startBuild(projectId, serviceId, body.branch),
    };
  }

  @Get('northflank/self')
  async self(): Promise<ApiSuccess<NfSelfView>> {
    return { data: await this.northflank.self() };
  }

  @Post('projects/:slug/expose')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async expose(
    @Param('slug', { schema: slugParam }) slug: string,
  ): Promise<ApiSuccess<ExposeResult>> {
    return { data: await this.northflank.expose(slug) };
  }

  @Delete('projects/:slug/expose')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async unexpose(
    @Param('slug', { schema: slugParam }) slug: string,
  ): Promise<ApiSuccess<ExposeResult>> {
    return { data: await this.northflank.unexpose(slug) };
  }
}
