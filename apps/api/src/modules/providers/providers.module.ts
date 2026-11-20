import { Module } from '@nestjs/common';
import { ProviderConnectionsService } from './provider-connections.service.js';
import { ProvidersController } from './providers.controller.js';

@Module({
  controllers: [ProvidersController],
  providers: [ProviderConnectionsService],
  exports: [ProviderConnectionsService],
})
export class ProvidersModule {}
