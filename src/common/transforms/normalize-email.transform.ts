import { Transform, TransformFnParams } from 'class-transformer';
import { normalizeEmail } from './normalize-email.util';

// Trim + lowercase an email at the DTO boundary so lookups and storage are
// case-insensitive ("  User@X.com " and "user@x.com" are the same email).
export const NormalizeEmail = (): PropertyDecorator =>
  Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? normalizeEmail(value) : value,
  );
