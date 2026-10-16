/**
 * Generates docs/openapi.json from the live Nest route/DTO metadata, without
 * starting the HTTP listener or connecting to the database (PrismaService
 * only connects in onModuleInit, which NestFactory.create() does not run).
 *
 * Run via `npm run openapi:generate`. Re-run (and re-run
 * `npm run postman:generate`) at the end of every module's Gate so the
 * Postman collection in docs/postman/ stays in sync with the API surface.
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../src/app.module';

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('EzyHotels API')
    .setDescription('Backend APIs for EzyHotels hotel booking platform')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  const outPath = join(__dirname, '..', 'docs', 'openapi.json');
  writeFileSync(outPath, JSON.stringify(document, null, 2));
  console.log(`Wrote ${outPath}`);

  await app.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
