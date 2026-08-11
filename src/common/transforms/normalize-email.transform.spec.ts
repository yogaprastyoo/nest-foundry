import { plainToInstance } from 'class-transformer';
import { LoginDto } from '../../modules/auth/dto/login.dto';
import { normalizeEmail } from './normalize-email.util';

describe('NormalizeEmail', () => {
  it('canonicalizes whitespace and casing consistently', () => {
    expect(normalizeEmail('  USER@Example.test  ')).toBe('user@example.test');
  });

  it('uses the same canonical value through NormalizeEmail', () => {
    const dto = plainToInstance(LoginDto, {
      email: '  USER@Example.test  ',
      password: 'password123',
    });

    expect(dto.email).toBe('user@example.test');
  });
});
