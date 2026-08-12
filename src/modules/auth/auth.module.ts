import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { MailModule } from '../../mail/mail.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { VerificationService } from './verification.service';
import { LocalStrategy } from './strategies/local.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { GoogleOAuthService } from './google-oauth.service';
import { GoogleOAuthGuard } from './guards/google-oauth.guard';

@Module({
  imports: [PassportModule, JwtModule.register({}), UsersModule, MailModule],
  controllers: [AuthController],
  providers: [
    TokenService,
    AuthService,
    VerificationService,
    GoogleOAuthService,
    LocalStrategy,
    JwtStrategy,
    GoogleStrategy,
    GoogleOAuthGuard,
  ],
  exports: [TokenService],
})
export class AuthModule {}
