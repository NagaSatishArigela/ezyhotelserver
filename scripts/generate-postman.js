#!/usr/bin/env node
/**
 * Converts docs/openapi.json (see generate-openapi.ts) into a Postman
 * collection at docs/postman/quicknestserver.postman_collection.json.
 *
 * Run via `npm run postman:generate` (after `npm run openapi:generate`).
 */
const fs = require('fs');
const path = require('path');
const converter = require('openapi-to-postmanv2');

const openapiPath = path.join(__dirname, '..', 'docs', 'openapi.json');
const outDir = path.join(__dirname, '..', 'docs', 'postman');
const outPath = path.join(outDir, 'quicknestserver.postman_collection.json');

if (!fs.existsSync(openapiPath)) {
  console.error(`Missing ${openapiPath} - run "npm run openapi:generate" first.`);
  process.exit(1);
}

const openapiData = fs.readFileSync(openapiPath, 'utf-8');

converter.convert(
  { type: 'string', data: openapiData },
  { folderStrategy: 'Tags', requestParametersResolution: 'Example' },
  (err, result) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    if (!result.result) {
      console.error(result.reason);
      process.exit(1);
    }

    const [collection] = result.output;
    const data = collection.data;

    // Default baseUrl to the local dev server instead of "/" so requests
    // are runnable out of the box; override per-environment in Postman.
    const baseUrlVar = (data.variable ?? []).find((v) => v.key === 'baseUrl');
    if (baseUrlVar) {
      baseUrlVar.value = 'http://localhost:4000';
    }

    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
    console.log(`Wrote ${outPath}`);
  },
);
