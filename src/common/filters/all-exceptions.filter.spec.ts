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

  it('formats a plain HttpException with errors: null', () => {
    const { host, status, json } = mockHost();
    filter.catch(new NotFoundException('User not found.'), host);
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'User not found.',
      errors: null,
    });
  });

  it('forwards per-field errors from a validation BadRequestException', () => {
    const { host, status, json } = mockHost();
    filter.catch(
      new BadRequestException({
        message: 'The given data was invalid.',
        errors: { email: 'Email must be a valid email address.' },
      }),
      host,
    );
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'The given data was invalid.',
      errors: { email: 'Email must be a valid email address.' },
    });
  });

  it('hides unknown error details behind a generic 500', () => {
    const { host, status, json } = mockHost();
    filter.catch(new Error('db connection leaked secret'), host);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'An unexpected server error occurred.',
      errors: null,
    });
  });

  it('maps P2002 to 409 without leaking the Prisma code', () => {
    const { host, status, json } = mockHost();
    filter.catch(prismaError('P2002'), host);
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'The record already exists.',
      errors: null,
    });
  });

  it('maps P2025 to 404', () => {
    const { host, status, json } = mockHost();
    filter.catch(prismaError('P2025'), host);
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'The record was not found.',
      errors: null,
    });
  });

  it('other Prisma codes fall through to a generic 500', () => {
    const { host, status, json } = mockHost();
    filter.catch(prismaError('P2003'), host);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'An unexpected server error occurred.',
      errors: null,
    });
  });
});
