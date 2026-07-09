import {
  ArgumentsHost,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

function mockHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ url: '/api/v1/test', method: 'GET' }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

// Mock Prisma error for testing
class MockPrismaError extends Error {
  code: string;
  clientVersion: string;

  constructor(
    message: string,
    options: { code: string; clientVersion: string },
  ) {
    super(message);
    this.name = 'PrismaClientKnownRequestError';
    this.code = options.code;
    this.clientVersion = options.clientVersion;
  }
}

function prismaError(code: string): MockPrismaError {
  return new MockPrismaError('boom', {
    code,
    clientVersion: 'test',
  });
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  it('memformat HttpException biasa dengan errors: null', () => {
    const { host, status, json } = mockHost();
    filter.catch(new NotFoundException('User tidak ditemukan.'), host);
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'User tidak ditemukan.',
      errors: null,
    });
  });

  it('meneruskan errors per-field dari BadRequestException validasi', () => {
    const { host, status, json } = mockHost();
    filter.catch(
      new BadRequestException({
        message: 'Data yang kamu masukkan tidak valid.',
        errors: { email: 'Format email tidak valid.' },
      }),
      host,
    );
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'Data yang kamu masukkan tidak valid.',
      errors: { email: 'Format email tidak valid.' },
    });
  });

  it('menyembunyikan detail error tak dikenal menjadi 500 generik', () => {
    const { host, status, json } = mockHost();
    filter.catch(new Error('db connection leaked secret'), host);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'Terjadi kesalahan pada server.',
      errors: null,
    });
  });

  it('memetakan P2002 ke 409 tanpa membocorkan kode prisma', () => {
    const { host, status, json } = mockHost();
    filter.catch(prismaError('P2002'), host);
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'Data sudah terdaftar.',
      errors: null,
    });
  });

  it('memetakan P2025 ke 404', () => {
    const { host, status, json } = mockHost();
    filter.catch(prismaError('P2025'), host);
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'Data tidak ditemukan.',
      errors: null,
    });
  });

  it('kode prisma lain jatuh ke 500 generik', () => {
    const { host, status, json } = mockHost();
    filter.catch(prismaError('P2003'), host);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'Terjadi kesalahan pada server.',
      errors: null,
    });
  });
});
