#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');
const http = require('http');
const {
  DEFAULT_HOST,
  DEFAULT_PORT,
  getGatewayUrl,
  openUrl,
  startGateway
} = require('./egomorph-gateway');
const {
  runCodexLoginStatus
} = require('./codex-bridge');

function printUsage(logger = console) {
  logger.log([
    'Egomorph Core Gateway CLI',
    '',
    'Nutzung:',
    '  egomorph dashboard [--host 127.0.0.1] [--port 8787] [--no-open]',
    '  egomorph gateway   [--host 127.0.0.1] [--port 8787] [--open]',
    '  egomorph clean     [--host 127.0.0.1] [--port 8787]',
    '  egomorph codex login [--device-auth]',
    '  egomorph codex status',
    '',
    'Beispiele:',
    '  egomorph dashboard',
    '  egomorph gateway --port 8787',
    '  egomorph clean',
    '  egomorph codex login',
    '  egomorph codex login --device-auth',
    '',
    'Ohne npm link:',
    '  ./egomorph dashboard                 # aus dem Projektordner',
    '  ./<projektordner>/egomorph dashboard # aus dem Elternordner'
  ].join('\n'));
}

function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  function readOptionValue(index) {
    const value = argv[index + 1];
    if (typeof value !== 'string' || !value || value.charAt(0) === '-') {
      return { value: undefined, consumed: false };
    }
    return { value, consumed: true };
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      flags.help = true;
    } else if (arg === '--open') {
      flags.open = true;
    } else if (arg === '--no-open') {
      flags.noOpen = true;
    } else if (arg === '--device-auth') {
      flags.deviceAuth = true;
    } else if (arg === '--host') {
      const next = readOptionValue(i);
      if (next.consumed) {
        flags.host = next.value;
        i += 1;
      }
    } else if (arg && arg.startsWith('--host=')) {
      flags.host = arg.slice('--host='.length);
    } else if (arg === '--port') {
      const next = readOptionValue(i);
      if (next.consumed) {
        flags.port = next.value;
        i += 1;
      }
    } else if (arg && arg.startsWith('--port=')) {
      flags.port = arg.slice('--port='.length);
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
}

function runCodexLogin(options = {}) {
  return new Promise((resolve, reject) => {
    const spawnImpl = options.spawnImpl || spawn;
    const args = [
      'login',
      '-c',
      'cli_auth_credentials_store="auto"'
    ];
    if (options.deviceAuth) args.push('--device-auth');

    const child = spawnImpl(options.codexBin || process.env.CODEX_BIN || 'codex', args, {
      stdio: options.stdio || 'inherit',
      env: process.env
    });

    child.on('error', reject);
    child.on('exit', code => resolve(code == null ? 1 : code));
  });
}

async function runCodexStatus(options = {}) {
  const logger = options.logger || console;
  const status = await runCodexLoginStatus(options);
  if (logger && typeof logger.log === 'function') {
    logger.log(status.message);
    if (status.raw) logger.log(status.raw);
  }
  return status.loggedIn ? 0 : 1;
}

function isGatewayReachable(baseUrl, options = {}) {
  const requestImpl = options.requestImpl || http.get;
  const timeoutMs = options.timeoutMs || 800;
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let request;
    try {
      request = requestImpl(new URL('health', baseUrl), response => {
        if (response && typeof response.resume === 'function') response.resume();
        finish(!!response && response.statusCode === 200);
      });
    } catch (_) {
      finish(false);
      return;
    }
    if (request && typeof request.setTimeout === 'function') {
      request.setTimeout(timeoutMs, () => {
        if (typeof request.destroy === 'function') request.destroy();
        finish(false);
      });
    }
    if (request && typeof request.on === 'function') request.on('error', () => finish(false));
  });
}

async function runClean(flags = {}, options = {}) {
  const logger = options.logger || console;
  const host = flags.host || DEFAULT_HOST;
  const port = flags.port || DEFAULT_PORT;
  const baseUrl = getGatewayUrl(host, port);
  const cleanUrl = new URL('?egomorph-clean=1', baseUrl).toString();
  const probe = options.probeGateway || isGatewayReachable;
  const launch = () => {
    const opened = (options.openUrl || openUrl)(cleanUrl, options);
    if (logger && typeof logger.log === 'function') {
      logger.log('[egomorph] Browser-App-Cache und Service Worker werden bereinigt; Unterhaltungen und Einstellungen bleiben erhalten.');
      logger.log(`[egomorph] Clean-URL: ${cleanUrl}`);
      if (!opened) logger.log('[egomorph] Oeffne die Clean-URL manuell im Browser.');
    }
  };

  if (await probe(baseUrl, options)) {
    launch();
    if (logger && typeof logger.log === 'function') {
      logger.log('[egomorph] Falls das Gateway bereits vor einem Update lief, danach beenden und neu starten.');
    }
    return 0;
  }

  startGateway({
    host,
    port,
    openDashboard: false,
    logger,
    spawnImpl: options.spawnImpl,
    onListening: launch,
    onError: options.onError || (() => process.exit(1))
  });
  return 0;
}

function startCliGateway(flags, openDashboard) {
  return startGateway({
    host: flags.host || DEFAULT_HOST,
    port: flags.port || DEFAULT_PORT,
    openDashboard,
    onError: () => process.exit(1)
  });
}

async function main(argv = process.argv.slice(2), options = {}) {
  const logger = options.logger || console;
  const parsed = parseArgs(argv);
  const command = String(parsed.positionals[0] || '').toLowerCase();
  const subcommand = String(parsed.positionals[1] || '').toLowerCase();

  if (!command || parsed.flags.help) {
    printUsage(logger);
    return 0;
  }

  if (command === 'dashboard' || command === 'dash') {
    startGateway({
      host: parsed.flags.host || DEFAULT_HOST,
      port: parsed.flags.port || DEFAULT_PORT,
      openDashboard: !parsed.flags.noOpen,
      logger,
      spawnImpl: options.spawnImpl,
      onError: () => process.exit(1)
    });
    return 0;
  }

  if (command === 'gateway' || command === 'bridge' || command === 'start') {
    startGateway({
      host: parsed.flags.host || DEFAULT_HOST,
      port: parsed.flags.port || DEFAULT_PORT,
      openDashboard: !!parsed.flags.open,
      logger,
      spawnImpl: options.spawnImpl,
      onError: () => process.exit(1)
    });
    return 0;
  }

  if (command === 'clean') {
    return runClean(parsed.flags, options);
  }

  if (command === 'codex') {
    if (subcommand === 'login' || subcommand === 'signin' || subcommand === 'sign-in') {
      return runCodexLogin({
        deviceAuth: parsed.flags.deviceAuth,
        spawnImpl: options.spawnImpl,
        stdio: options.stdio,
        codexBin: options.codexBin
      });
    }
    if (subcommand === 'login-device' || subcommand === 'device-login') {
      return runCodexLogin({
        deviceAuth: true,
        spawnImpl: options.spawnImpl,
        stdio: options.stdio,
        codexBin: options.codexBin
      });
    }
    if (subcommand === 'status') {
      return runCodexStatus({
        logger,
        codexBin: options.codexBin,
        spawnImpl: options.spawnImpl,
        timeoutMs: options.timeoutMs
      });
    }
    if (subcommand === 'gateway' || subcommand === 'bridge') {
      startCliGateway(parsed.flags, !!parsed.flags.open);
      return 0;
    }
  }

  printUsage(logger);
  return 1;
}

if (require.main === module) {
  main().then(code => {
    if (code) process.exit(code);
  }).catch(err => {
    console.error(err && err.message ? err.message : String(err));
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  printUsage,
  isGatewayReachable,
  runClean,
  runCodexLogin,
  runCodexStatus
};
