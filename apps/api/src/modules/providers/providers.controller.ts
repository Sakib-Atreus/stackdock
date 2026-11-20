import { Body, Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  type ApiSuccess,
  type ConnectNorthflankInput,
  connectNorthflankSchema,
  type ProviderConnectionView,
} from '@stackdock/shared';
import { ProviderConnectionsService } from './provider-connections.service.js';

@Controller('providers')
export class ProvidersController {
  constructor(private readonly connections: ProviderConnectionsService) {}

  @Get()
  async list(): Promise<ApiSuccess<ProviderConnectionView[]>> {
    return { data: [await this.connections.getNorthflank()] };
  }

  @Post('northflank/connect')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async connect(
    @Body({ schema: connectNorthflankSchema }) body: ConnectNorthflankInput,
  ): Promise<ApiSuccess<ProviderConnectionView>> {
    return { data: await this.connections.connectNorthflank(body.token) };
  }

  @Post('northflank/test')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async test(): Promise<ApiSuccess<ProviderConnectionView>> {
    return { data: await this.connections.testNorthflank() };
  }

  @Delete('northflank')
  async disconnect(): Promise<ApiSuccess<ProviderConnectionView>> {
    return { data: await this.connections.disconnectNorthflank() };
  }
}
