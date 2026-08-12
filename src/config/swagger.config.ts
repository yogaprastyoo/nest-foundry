import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Env } from './env.validation';

export function setupSwagger(app: INestApplication): void {
  const configService = app.get<ConfigService<Env, true>>(ConfigService);
  const appName = configService.get('APP_NAME', { infer: true });
  const config = new DocumentBuilder()
    .setTitle(`${appName} API`)
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
}
