import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

interface ErrorBody {
  success: false;
  message: string;
  errors: Record<string, string> | null;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload: ErrorBody = {
        success: false,
        message: this.extractMessage(body, exception.message),
        errors: this.extractErrors(body),
      };
      res.status(status).json(payload);
      return;
    }

    if (
      exception instanceof Error &&
      exception.name === 'PrismaClientKnownRequestError' &&
      'code' in exception
    ) {
      const mapped = this.mapPrismaError((exception as { code: string }).code);
      if (mapped) {
        res.status(mapped.status).json({
          success: false,
          message: mapped.message,
          errors: null,
        } satisfies ErrorBody);
        return;
      }
    }

    this.logger.error(
      exception instanceof Error ? exception.stack : String(exception),
    );
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Terjadi kesalahan pada server.',
      errors: null,
    } satisfies ErrorBody);
  }

  private extractMessage(body: string | object, fallback: string): string {
    if (typeof body === 'string') return body;
    const message = (body as Record<string, unknown>).message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message[0] as string;
    return fallback;
  }

  private extractErrors(body: string | object): Record<string, string> | null {
    if (typeof body !== 'object') return null;
    const errors = (body as Record<string, unknown>).errors;
    return errors && typeof errors === 'object' && !Array.isArray(errors)
      ? (errors as Record<string, string>)
      : null;
  }

  private mapPrismaError(
    code: string,
  ): { status: number; message: string } | null {
    switch (code) {
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          message: 'Data sudah terdaftar.',
        };
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          message: 'Data tidak ditemukan.',
        };
      default:
        return null;
    }
  }
}
