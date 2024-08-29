import { Redis } from 'ioredis';
import { performance } from 'node:perf_hooks';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { INestApplication, Logger } from '@nestjs/common';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-streams-adapter';
import { EnvService } from '../../env/env.service';

export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor: ReturnType<typeof createAdapter>;

  private readonly redis: Redis;
  private readonly envService: EnvService;

  constructor(app: INestApplication, redis: Redis, envService: EnvService) {
    super(app);
    this.redis = redis;
    this.envService = envService;
  }

  async connectToRedis(): Promise<void> {
    const time = performance.now();
    await this.redis.connect();
    this.logger.verbose(`redis connection successfull (${(performance.now() - time).toFixed(3)}ms)`);

    //! supports connection state recovery feature
    this.adapterConstructor = createAdapter(this.redis, {
      streamName: 'Document:stream',
      sessionKeyPrefix: 'Document:session:',
    });
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const time = performance.now();
    if (options) {
      options = {
        ...options,
        allowEIO3: false,
        transports: ['websocket'],
        cors: {
          origin: [this.envService.get('FRONTEND_DOCUMENT_URL')],
          credentials: true,
        },
        connectionStateRecovery: {
          maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
          skipMiddlewares: true,
        },
      };
    }

    const server: Server = super.createIOServer(port, options);
    server.adapter(this.adapterConstructor);
    this.logger.verbose(`socket redis adapter created (${(performance.now() - time).toFixed(3)}ms)`);

    return server;
  }
}
