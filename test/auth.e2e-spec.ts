import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();

    prisma = app.get(PrismaService);
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  it('register sukses → 201 envelope data null', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/register')
      .send({
        email: 'budi@example.com',
        password: 'password123',
        name: 'Budi',
      })
      .expect(201);
    expect(res.body).toEqual({
      success: true,
      message: 'Registrasi berhasil.',
      data: null,
    });
  });

  it('email duplikat → 409 pesan spesifik', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/register')
      .send({
        email: 'budi@example.com',
        password: 'password123',
        name: 'Budi',
      })
      .expect(409);
    expect(res.body).toEqual({
      success: false,
      message: 'Email sudah terdaftar.',
      errors: null,
    });
  });

  it('validasi gagal → 400 errors per-field (menguji flatten end-to-end)', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/register')
      .send({ email: 'bukan-email', password: 'pendek', name: '' })
      .expect(400);
    const body = res.body as {
      success: boolean;
      message: string;
      errors: Record<string, string>;
    };
    expect(body.success).toBe(false);
    expect(body.message).toBe('Data yang kamu masukkan tidak valid.');
    expect(body.errors).toMatchObject({
      email: 'Format email tidak valid.',
      password: 'Password minimal 8 karakter.',
      name: 'Nama wajib diisi.',
    });
  });
});
