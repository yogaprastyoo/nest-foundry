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

  it('wraps data in a success envelope + message from the decorator', async () => {
    await expect(run({ id: 1 }, 'Login successful.')).resolves.toEqual({
      success: true,
      message: 'Login successful.',
      data: { id: 1 },
    });
  });

  it('uses the default message when no decorator is present', async () => {
    await expect(run([1, 2])).resolves.toEqual({
      success: true,
      message: 'Success.',
      data: [1, 2],
    });
  });

  it('turns undefined into data: null', async () => {
    await expect(run(undefined, 'Logout successful.')).resolves.toEqual({
      success: true,
      message: 'Logout successful.',
      data: null,
    });
  });
});
