#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');

const args = [
  'login',
  '-c',
  'cli_auth_credentials_store="auto"'
];

if (process.argv.includes('--device-auth')) {
  args.push('--device-auth');
}

const child = spawn(process.env.CODEX_BIN || 'codex', args, {
  stdio: 'inherit',
  env: process.env
});

child.on('exit', code => {
  process.exit(code == null ? 1 : code);
});

child.on('error', err => {
  console.error(err && err.message ? err.message : String(err));
  process.exit(1);
});
