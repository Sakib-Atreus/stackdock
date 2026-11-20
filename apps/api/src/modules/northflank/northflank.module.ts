import { Module } from '@nestjs/common';
import { ProvidersModule } from '../providers/providers.module.js';
import { NorthflankController } from './northflank.controller.js';
import { NorthflankService } from './northflank.service.js';

@Module({
  imports: [ProvidersModule],
  controllers: [NorthflankController],
  providers: [NorthflankService],
})
export class NorthflankModule {}
