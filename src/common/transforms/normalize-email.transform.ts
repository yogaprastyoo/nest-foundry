import { Transform, TransformFnParams } from 'class-transformer';

/**
 * Decorator untuk menormalkan email di boundary DTO: trim + lowercase.
 * Membuat validasi & penyimpanan konsisten (case-insensitive) sehingga
 * "  Budi@X.com " dan "budi@x.com" diperlakukan sebagai email yang sama.
 */
export const NormalizeEmail = (): PropertyDecorator =>
  Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );
