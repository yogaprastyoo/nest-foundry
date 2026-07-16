import {
  BadRequestException,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Request } from 'express';
import { flatten } from '../../../common/pipes/validation.pipe-factory';
import { LoginDto } from '../dto/login.dto';

/**
 * Guards jalan SEBELUM ValidationPipe di lifecycle NestJS, jadi kalau body
 * kosong Passport langsung melempar 401 tanpa pesan validasi yang jelas.
 * Di sini kita validasi LoginDto manual dulu (400 dengan detail field,
 * format sama seperti ValidationPipe global) sebelum menyerahkan ke
 * strategi Passport untuk cek kredensial.
 */
@Injectable()
export class LocalAuthGuard extends AuthGuard('local') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const dto = plainToInstance(LoginDto, request.body ?? {});
    const errors = await validate(dto, { whitelist: true });
    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Data yang kamu masukkan tidak valid.',
        errors: flatten(errors),
      });
    }
    return (await super.canActivate(context)) as boolean;
  }
}
