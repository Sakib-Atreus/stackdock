import { Module } from '@nestjs/common';
import { ProjectDatabaseService } from './project-database.service.js';
import { ProxyService } from './proxy.service.js';
import { RunnerController } from './runner.controller.js';
import { RunnerService } from './runner.service.js';

@Module({
  controllers: [RunnerController],
  providers: [RunnerService, ProxyService, ProjectDatabaseService],
  exports: [RunnerService, ProxyService, ProjectDatabaseService],
})
export class RunnerModule {}
