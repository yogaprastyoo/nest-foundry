import {
  BadRequestException,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';

// When a field fails several rules at once, show the highest-priority rule's
// message (required > type > format > size). class-validator does not guarantee
// this order, so we enforce it explicitly. Example: an empty email fails both
// required and email — we surface "Email is required.".
const CONSTRAINT_PRIORITY = [
  'isDefined',
  'isNotEmpty',
  'isString',
  'isBoolean',
  'isInt',
  'isNumber',
  'isArray',
  'isEmail',
  'isEnum',
  'matches',
  'minLength',
  'maxLength',
  'min',
  'max',
  'length',
];

function pickByPriority(constraints: Record<string, string>): string {
  for (const key of CONSTRAINT_PRIORITY) {
    if (constraints[key]) return constraints[key];
  }
  return Object.values(constraints)[0];
}

export function flatten(
  errors: ValidationError[],
  parent = '',
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const err of errors) {
    const field = parent ? `${parent}.${err.property}` : err.property;
    if (err.constraints) out[field] = pickByPriority(err.constraints);
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
        message: 'The given data was invalid.',
        errors: flatten(errors),
      }),
  });
}
