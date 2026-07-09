import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { TokenService } from './token.service';

@Module({
  imports: [JwtModule.register({}), UsersModule],
  providers: [TokenService],
  exports: [TokenService],
})
export class AuthModule {}
