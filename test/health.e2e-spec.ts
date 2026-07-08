import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health mengembalikan envelope sukses dengan status up', async () => {
    const res = await request(app.getHttpServer() as App)
      .get('/api/v1/health')
      .expect(200);
    const body = res.body as {
      success: boolean;
      message: string;
      data: { status: string; info: Record<string, { status: string }> };
    };
    expect(body.success).toBe(true);
    expect(body.message).toBe('Service sehat.');
    expect(body.data.status).toBe('ok');
    expect(body.data.info.database.status).toBe('up');
    expect(body.data.info.redis.status).toBe('up');
  });

  it('route tak dikenal mengembalikan envelope error', async () => {
    const res = await request(app.getHttpServer() as App)
      .get('/api/v1/nope')
      .expect(404);
    expect(res.body).toMatchObject({ success: false, errors: null });
  });
});
