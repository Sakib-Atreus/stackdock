import { Controller, Get, Query } from '@nestjs/common';
import type { ActivityPage, ApiSuccess } from '@stackdock/shared';
import { z } from 'zod';
import { ActivityService } from './activity.service.js';

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(64).optional(),
});

@Controller('activity')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  async list(
    @Query({ schema: listQuerySchema }) query: z.infer<typeof listQuerySchema>,
  ): Promise<ApiSuccess<ActivityPage>> {
    return { data: await this.activity.list(query.limit, query.cursor) };
  }
}
