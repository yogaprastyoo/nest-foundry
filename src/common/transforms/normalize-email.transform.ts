import { Transform, TransformFnParams } from 'class-transformer';

// Trim + lowercase an email at the DTO boundary so lookups and storage are
// case-insensitive ("  Budi@X.com " and "budi@x.com" are the same email).
export const NormalizeEmail = (): PropertyDecorator =>
  Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );
