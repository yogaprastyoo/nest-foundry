import {
  BadRequestException,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';

function flatten(
  errors: ValidationError[],
  parent = '',
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const err of errors) {
    const field = parent ? `${parent}.${err.property}` : err.property;
    if (err.constraints) out[field] = Object.values(err.constraints)[0];
    if (err.children?.length) Object.assign(out, flatten(err.children, field));
  }
  return out;
}

export function buildValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    exceptionFactory: (errors) =>
      new BadRequestException({
        message: 'Data yang kamu masukkan tidak valid.',
        errors: flatten(errors),
      }),
  });
}
