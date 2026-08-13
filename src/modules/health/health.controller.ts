import { Controller, Get, Inject } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
} from '@nestjs/terminus';
import Redis from 'ioredis';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { Public } from '../../common/decorators/public.decorator';

@Public()
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicator: HealthIndicatorService,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get()
  @HealthCheck()
  @ResponseMessage('Service is healthy.')
  check() {
    return this.health.check([
      async () => {
        const check = this.indicator.check('database');
        try {
          await this.prisma.$queryRaw`SELECT 1`;
          return check.up();
        } catch {
          return check.down();
        }
      },
      async () => {
        const check = this.indicator.check('redis');
        try {
          await this.redis.ping();
          return check.up();
        } catch {
          return check.down();
        }
      },
    ]);
  }
}
