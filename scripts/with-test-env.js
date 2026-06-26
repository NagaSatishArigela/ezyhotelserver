#!/usr/bin/env node
/**
 * Loads .env.test into process.env (overriding any inherited values) and
 * then runs the given command, e.g.:
 *
 *   node scripts/with-test-env.js prisma migrate deploy
 *
 * Used by the `*:test` npm scripts so Prisma/Jest operate against the
 * dedicated test database regardless of the shell's ambient environment.
 */
const path = require('path');
const { spawnSync } = require('child_process');
const { config } = require('dotenv');

config({ path: path.resolve(__dirname, '..', '.env.test'), override: true });

const [, , command, ...args] = process.argv;

if (!command) {
  console.error('Usage: node scripts/with-test-env.js <command> [args...]');
  process.exit(1);
}

const result = spawnSync(command, args, {
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);
