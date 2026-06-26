import { ValidationPipe, INestApplication } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { RequestLoggingInterceptor } from '../../src/common/interceptors/request-logging.interceptor';

/**
 * Builds a fully-bootstrapped Nest application for e2e tests, mirroring the
 * global pipes/filters/interceptors registered in `src/main.ts` (CORS,
 * helmet, and Swagger are intentionally omitted - they're not relevant to
 * API behaviour under test).
 *
 * Usage:
 *   const { app } = await createTestApp();
 *   await request(app.getHttpServer()).post('/auth/send-otp')...
 *   await app.close();
 *
 * Pass `configure` to tweak the TestingModuleBuilder before compilation
 * (e.g. to override providers with mocks).
 */
export async function createTestApp(
  configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
): Promise<{ app: INestApplication }> {
  let builder = Test.createTestingModule({
    imports: [AppModule],
  });

  if (configure) {
    builder = configure(builder);
  }

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new RequestLoggingInterceptor());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  await app.init();
  return { app };
}
