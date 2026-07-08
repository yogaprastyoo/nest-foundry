import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { TransformInterceptor } from './transform.interceptor';
import { RESPONSE_MESSAGE_KEY } from '../decorators/response-message.decorator';

function mockContext(): ExecutionContext {
  return { getHandler: () => ({}) } as unknown as ExecutionContext;
}

describe('TransformInterceptor', () => {
  function run(data: unknown, message?: string) {
    const reflector = new Reflector();
    jest
      .spyOn(reflector, 'get')
      .mockImplementation((key) =>
        key === RESPONSE_MESSAGE_KEY ? message : undefined,
      );
    const interceptor = new TransformInterceptor(reflector);
    const next: CallHandler = { handle: () => of(data) };
    return lastValueFrom(interceptor.intercept(mockContext(), next));
  }

  it('membungkus data dengan envelope sukses + message dari decorator', async () => {
    await expect(run({ id: 1 }, 'Login berhasil.')).resolves.toEqual({
      success: true,
      message: 'Login berhasil.',
      data: { id: 1 },
    });
  });

  it('memakai message default saat tidak ada decorator', async () => {
    await expect(run([1, 2])).resolves.toEqual({
      success: true,
      message: 'Berhasil.',
      data: [1, 2],
    });
  });

  it('mengubah undefined menjadi data: null', async () => {
    await expect(run(undefined, 'Logout berhasil.')).resolves.toEqual({
      success: true,
      message: 'Logout berhasil.',
      data: null,
    });
  });
});
