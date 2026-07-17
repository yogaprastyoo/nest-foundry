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

// Guards run before the ValidationPipe, so an empty body would make Passport
// throw a bare 401. Validate the LoginDto here first (same format as the global
// pipe) so a missing/invalid body returns a proper 400 instead.
@Injectable()
export class LocalAuthGuard extends AuthGuard('local') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const dto = plainToInstance(LoginDto, request.body ?? {});
    const errors = await validate(dto, { whitelist: true });
    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'The given data was invalid.',
        errors: flatten(errors),
      });
    }
    return (await super.canActivate(context)) as boolean;
  }
}
