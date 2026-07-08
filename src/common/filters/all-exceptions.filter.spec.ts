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
});
