#!/usr/bin/env node
/**
 * Trellis Frontend Contributor Diagnostics
 *
 * Runs non-mutating local health checks for contributors:
 * - Environment & Developer Tooling
 * - Configuration & Environment Variables
 * - Service & Network Connectivity
 * - Database & Mock Fixture Integrity
 * - Project Config & Build Readiness
 */

import { existsSync, readFileSync, statfsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import net from 'node:net';

const ROOT_DIR = resolve(process.cwd());

/**
 * Format status badge with ANSI colors (or plain text when CI/no-color)
 */
const useColor = !process.env.NO_COLOR && process.stdout.isTTY;
const colors = {
  reset: useColor ? '\x1b[0m' : '',
  bold: useColor ? '\x1b[1m' : '',
  green: useColor ? '\x1b[32m' : '',
  yellow: useColor ? '\x1b[33m' : '',
  red: useColor ? '\x1b[31m' : '',
  cyan: useColor ? '\x1b[36m' : '',
  dim: useColor ? '\x1b[2m' : '',
};

function badge(status) {
  if (status === 'pass') return `${colors.green}[PASS]${colors.reset}`;
  if (status === 'warn') return `${colors.yellow}[WARN]${colors.reset}`;
  return `${colors.red}[FAIL]${colors.reset}`;
}

/**
 * Helper to fetch HTTP/HTTPS endpoint with timeout
 */
function checkHttpEndpoint(urlStr, timeoutMs = 4000) {
  return new Promise((resolveResult) => {
    try {
      const url = new URL(urlStr);
      const client = url.protocol === 'https:' ? https : http;
      const req = client.get(
        url,
        {
          timeout: timeoutMs,
          headers: { 'User-Agent': 'Trellis-Contributor-Diagnostics/1.0' },
        },
        (res) => {
          res.resume(); // consume response data to free memory
          if (res.statusCode && res.statusCode < 500) {
            resolveResult({ ok: true, status: res.statusCode });
          } else {
            resolveResult({ ok: false, error: `HTTP status ${res.statusCode}` });
          }
        }
      );

      req.on('timeout', () => {
        req.destroy();
        resolveResult({ ok: false, error: 'Connection timed out' });
      });

      req.on('error', (err) => {
        resolveResult({ ok: false, error: err.message });
      });
    } catch (err) {
      resolveResult({ ok: false, error: err.message });
    }
  });
}

/**
 * 1. Check Tooling & Environment
 */
export function checkTooling() {
  const results = [];

  // Node.js version
  const currentVersion = process.version;
  const major = parseInt(currentVersion.replace(/^v/, '').split('.')[0], 10);
  if (major >= 20) {
    results.push({
      name: 'Node.js Runtime',
      status: 'pass',
      message: `Node.js ${currentVersion} installed (meets requirement >= 20.0.0)`,
    });
  } else {
    results.push({
      name: 'Node.js Runtime',
      status: 'fail',
      message: `Current Node.js version is ${currentVersion}. Trellis requires Node.js >= 20.0.0.`,
      remediation: 'Upgrade Node.js to version 20 or higher (e.g. run "nvm install 20 && nvm use 20" or download from https://nodejs.org).',
    });
  }

  // Git repository check
  const gitDir = join(ROOT_DIR, '.git');
  if (existsSync(gitDir)) {
    let branch = 'unknown';
    try {
      branch = execSync('git rev-parse --abbrev-ref HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim();
    } catch {
      // ignore
    }
    results.push({
      name: 'Git Repository',
      status: 'pass',
      message: `Git repository initialized on branch '${branch}'`,
    });
  } else {
    results.push({
      name: 'Git Repository',
      status: 'warn',
      message: '.git directory not found in project root',
      remediation: 'Clone the repository using "git clone https://github.com/TRELLIS-STELLAR/Trellis-frontend.git" to contribute.',
    });
  }

  return results;
}

/**
 * 2. Check Configuration & Environment Variables
 */
export function checkConfiguration() {
  const results = [];
  const envExamplePath = join(ROOT_DIR, '.env.example');
  const envLocalPath = join(ROOT_DIR, '.env.local');
  const envPath = join(ROOT_DIR, '.env');

  // .env.example template check
  let requiredKeys = [];
  if (existsSync(envExamplePath)) {
    results.push({
      name: '.env.example Template',
      status: 'pass',
      message: 'Template .env.example exists and readable',
    });
    const exContent = readFileSync(envExamplePath, 'utf-8');
    for (const line of exContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        requiredKeys.push(trimmed.slice(0, eqIdx).trim());
      }
    }
  } else {
    results.push({
      name: '.env.example Template',
      status: 'fail',
      message: 'Missing .env.example template in repository root',
      remediation: 'Restore .env.example from repository origin.',
    });
  }

  // Local environment file check
  const activeEnvFile = existsSync(envLocalPath) ? '.env.local' : existsSync(envPath) ? '.env' : null;
  if (activeEnvFile) {
    results.push({
      name: 'Local Environment File',
      status: 'pass',
      message: `Found active environment file: ${activeEnvFile}`,
    });

    // Parse variables
    const content = readFileSync(join(ROOT_DIR, activeEnvFile), 'utf-8');
    const parsedVars = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        parsedVars[key] = val;
      }
    }

    if (requiredKeys.length > 0) {
      const missingKeys = requiredKeys.filter(k => !(k in parsedVars));
      if (missingKeys.length > 0) {
        results.push({
          name: 'Environment Variables Sync',
          status: 'fail',
          message: `Missing required environment variables in ${activeEnvFile}: ${missingKeys.join(', ')}`,
          remediation: `Add the missing variables to ${activeEnvFile} as defined in .env.example.`
        });
      } else {
        results.push({
          name: 'Environment Variables Sync',
          status: 'pass',
          message: `All keys from .env.example are present in ${activeEnvFile}`,
        });
      }
    }

    // NEXT_PUBLIC_API_URL
    if (parsedVars.NEXT_PUBLIC_API_URL) {
      try {
        new URL(parsedVars.NEXT_PUBLIC_API_URL);
        results.push({
          name: 'API Endpoint (NEXT_PUBLIC_API_URL)',
          status: 'pass',
          message: `Configured valid URL: ${parsedVars.NEXT_PUBLIC_API_URL}`,
        });
      } catch {
        results.push({
          name: 'API Endpoint (NEXT_PUBLIC_API_URL)',
          status: 'fail',
          message: `Invalid URL format in ${activeEnvFile}: ${parsedVars.NEXT_PUBLIC_API_URL}`,
          remediation: 'Set NEXT_PUBLIC_API_URL to a valid URL format (e.g. http://localhost:3001).',
        });
      }
    } else {
      results.push({
        name: 'API Endpoint (NEXT_PUBLIC_API_URL)',
        status: 'warn',
        message: 'NEXT_PUBLIC_API_URL is unset; app will fall back to default localhost or mock mode',
        remediation: 'Add NEXT_PUBLIC_API_URL=http://localhost:3001 to your .env.local.',
      });
    }

    // NEXT_PUBLIC_ENVIRONMENT
    const envVal = parsedVars.NEXT_PUBLIC_ENVIRONMENT;
    if (envVal) {
      const validEnvs = ['development', 'staging', 'production', 'test'];
      if (validEnvs.includes(envVal)) {
        results.push({
          name: 'Environment Mode (NEXT_PUBLIC_ENVIRONMENT)',
          status: 'pass',
          message: `Environment mode set to '${envVal}'`,
        });
      } else {
        results.push({
          name: 'Environment Mode (NEXT_PUBLIC_ENVIRONMENT)',
          status: 'warn',
          message: `Unexpected environment value '${envVal}' (expected one of: ${validEnvs.join(', ')})`,
          remediation: 'Set NEXT_PUBLIC_ENVIRONMENT=development in .env.local.',
        });
      }
    }
  } else {
    results.push({
      name: 'Local Environment File',
      status: 'warn',
      message: 'No .env.local or .env file detected',
      remediation: 'Copy .env.example to .env.local: "cp .env.example .env.local" and customize local variables.',
    });
  }

  return results;
}

/**
 * 3. Check Dependencies & Project Files
 */
export function checkDependencies() {
  const results = [];
  const pkgPath = join(ROOT_DIR, 'package.json');
  const nodeModulesPath = join(ROOT_DIR, 'node_modules');

  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      results.push({
        name: 'package.json Configuration',
        status: 'pass',
        message: `Valid package.json (${pkg.name || 'trellis-frontend'}@${pkg.version || '0.1.0'})`,
      });
    } catch (err) {
      results.push({
        name: 'package.json Configuration',
        status: 'fail',
        message: `Corrupt package.json: ${err.message}`,
        remediation: 'Verify package.json syntax or restore from git: "git checkout package.json".',
      });
    }
  } else {
    results.push({
      name: 'package.json Configuration',
      status: 'fail',
      message: 'package.json not found in working directory',
      remediation: 'Ensure you are running the diagnostics command from the project root.',
    });
  }

  if (existsSync(nodeModulesPath)) {
    results.push({
      name: 'Dependencies Installation',
      status: 'pass',
      message: 'node_modules folder present',
    });
  } else {
    results.push({
      name: 'Dependencies Installation',
      status: 'fail',
      message: 'node_modules not found; packages have not been installed',
      remediation: 'Run "npm install" or "pnpm install" to install required dependencies.',
    });
  }

  // TypeScript configuration
  const tsconfigPath = join(ROOT_DIR, 'tsconfig.json');
  if (existsSync(tsconfigPath)) {
    results.push({
      name: 'TypeScript Configuration',
      status: 'pass',
      message: 'tsconfig.json present',
    });
  } else {
    results.push({
      name: 'TypeScript Configuration',
      status: 'warn',
      message: 'tsconfig.json missing in repository root',
      remediation: 'Restore tsconfig.json from git origin.',
    });
  }

  return results;
}

/**
 * 4. Check Service & Network Connectivity
 */
export async function checkConnectivity(skipNetwork = false) {
  const results = [];

  if (skipNetwork) {
    results.push({
      name: 'Network Services',
      status: 'pass',
      message: 'Skipped external network checks (--skip-network requested)',
    });
    return results;
  }

  // Stellar Testnet Horizon
  const horizonEndpoint = 'https://horizon-testnet.stellar.org';
  const horizonResult = await checkHttpEndpoint(horizonEndpoint);
  if (horizonResult.ok) {
    results.push({
      name: 'Stellar Horizon RPC (Testnet)',
      status: 'pass',
      message: `Successfully connected to ${horizonEndpoint} (HTTP ${horizonResult.status})`,
    });
  } else {
    results.push({
      name: 'Stellar Horizon RPC (Testnet)',
      status: 'warn',
      message: `Unable to reach ${horizonEndpoint}: ${horizonResult.error}`,
      remediation: 'Check your internet connection or verify firewall/DNS allows outbound traffic to horizon-testnet.stellar.org.',
    });
  }

  // IPFS Gateway
  const ipfsEndpoint = 'https://ipfs.io';
  const ipfsResult = await checkHttpEndpoint(ipfsEndpoint);
  if (ipfsResult.ok) {
    results.push({
      name: 'Public IPFS Gateway',
      status: 'pass',
      message: `Successfully reached ${ipfsEndpoint} (HTTP ${ipfsResult.status})`,
    });
  } else {
    results.push({
      name: 'Public IPFS Gateway',
      status: 'warn',
      message: `Unable to reach ${ipfsEndpoint}: ${ipfsResult.error}`,
      remediation: 'IPFS gateway is optional for local dev; built-in mock IPFS resolution will be used.',
    });
  }

  return results;
}

/**
 * 5. Check Database & Test Fixtures Integrity (Non-Mutating)
 */
export async function checkDatabaseAndFixtures() {
  const results = [];

  try {
    // Non-mutating read of mock database
    const mockDbPath = join(ROOT_DIR, 'lib', 'db', 'mock-db.ts');
    if (existsSync(mockDbPath)) {
      results.push({
        name: 'Mock Database Source',
        status: 'pass',
        message: 'lib/db/mock-db.ts exists and available for in-memory operations',
      });
    } else {
      results.push({
        name: 'Mock Database Source',
        status: 'warn',
        message: 'lib/db/mock-db.ts not found',
        remediation: 'Verify lib/db fixtures are checked out.',
      });
    }

    // Verify operational health builder
    const opHealthPath = join(ROOT_DIR, 'lib', 'operational-health.ts');
    if (existsSync(opHealthPath)) {
      results.push({
        name: 'Operational Health Module',
        status: 'pass',
        message: 'lib/operational-health.ts present for domain telemetry',
      });
    }

    // Verify core test fixtures
    const testsDir = join(ROOT_DIR, 'tests');
    if (existsSync(testsDir)) {
      results.push({
        name: 'Test Suites Directory',
        status: 'pass',
        message: 'tests/ directory present with unit and integration specs',
      });
    } else {
      results.push({
        name: 'Test Suites Directory',
        status: 'warn',
        message: 'tests/ directory not found',
        remediation: 'Ensure test suites are checked out from git.',
      });
    }
  } catch (err) {
    results.push({
      name: 'Database & Fixture Access',
      status: 'fail',
      message: `Encountered unexpected error checking fixtures: ${err.message}`,
      remediation: 'Check file permissions and ensure working directory files are readable.',
    });
  }

  return results;
}

/**
 * 6. Check System Requirements
 */
export function checkSystemRequirements() {
  const results = [];
  
  // memory
  const totalRamGb = os.totalmem() / (1024 ** 3);
  if (totalRamGb >= 4) {
    results.push({ name: 'System Memory', status: 'pass', message: `Total RAM is ${totalRamGb.toFixed(1)}GB (>= 4GB)`});
  } else {
    results.push({ name: 'System Memory', status: 'warn', message: `Total RAM is ${totalRamGb.toFixed(1)}GB, Next.js build may struggle with < 4GB`, remediation: 'Close other applications or upgrade RAM.'});
  }

  // disk
  try {
     const stat = statfsSync(ROOT_DIR);
     const freeGb = (stat.bfree * stat.bsize) / (1024 ** 3);
     if (freeGb >= 1) {
       results.push({ name: 'Disk Space', status: 'pass', message: `Free disk space is ${freeGb.toFixed(1)}GB (>= 1GB)`});
     } else {
       results.push({ name: 'Disk Space', status: 'warn', message: `Free disk space is ${freeGb.toFixed(1)}GB, < 1GB recommended for build`, remediation: 'Free up some disk space.'});
     }
  } catch (e) {
     results.push({ name: 'Disk Space', status: 'warn', message: 'Could not determine free disk space', remediation: 'Ensure you have enough disk space for build.' });
  }
  return results;
}

/**
 * 7. Check Local Ports
 */
export async function checkLocalPorts() {
  const results = [];
  const ports = [3000, 8080];
  for (const port of ports) {
    try {
      const isOccupied = await new Promise((resolve) => {
        const srv = net.createServer();
        srv.once('error', (err) => {
          if (err.code === 'EADDRINUSE') resolve(true);
          else resolve(false);
        });
        srv.once('listening', () => {
          srv.close();
          resolve(false);
        });
        srv.listen(port, '127.0.0.1');
      });

      if (isOccupied) {
        let processDetails = 'unknown process';
        try {
          if (process.platform === 'win32') {
             const netstat = execSync(`netstat -ano | findstr :${port}`).toString();
             const lines = netstat.trim().split('\n').filter(l => l.includes(`:${port}`));
             if (lines.length > 0) {
                 const pid = lines[0].trim().split(/\s+/).pop();
                 const tasklist = execSync(`tasklist | findstr ${pid}`).toString();
                 processDetails = `PID ${pid} (${tasklist.trim().split(/\s+/)[0]})`;
             }
          } else {
             const lsof = execSync(`lsof -i :${port} -t`).toString().trim();
             if (lsof) {
                 const ps = execSync(`ps -p ${lsof.split('\n')[0]} -o comm=`).toString().trim();
                 processDetails = `PID ${lsof.split('\n')[0]} (${ps})`;
             }
          }
        } catch(e) {}
        results.push({
          name: `Local Port ${port}`,
          status: 'fail',
          message: `Port ${port} is currently in use by ${processDetails}`,
          remediation: `Stop the process using port ${port} or change the port configuration.`
        });
      } else {
        results.push({
          name: `Local Port ${port}`,
          status: 'pass',
          message: `Port ${port} is available`
        });
      }
    } catch (err) {
      results.push({
        name: `Local Port ${port}`,
        status: 'fail',
        message: `Failed to check port ${port}: ${err.message}`
      });
    }
  }
  return results;
}

/**
 * Main Diagnostics Runner
 */
export async function runDiagnostics(options = {}) {
  const { skipNetwork = false, strict = false } = options;

  const groups = [
    { name: 'Developer Tooling & Runtime', results: checkTooling() },
    { name: 'Configuration & Environment', results: checkConfiguration() },
    { name: 'Project Dependencies & Setup', results: checkDependencies() },
    { name: 'Service Connectivity & Network', results: await checkConnectivity(skipNetwork) },
    { name: 'Database & Fixture Integrity', results: await checkDatabaseAndFixtures() },
    { name: 'System Requirements', results: checkSystemRequirements() },
    { name: 'Local Ports', results: await checkLocalPorts() },
  ];

  let total = 0;
  let passed = 0;
  let warnings = 0;
  let failures = 0;

  for (const group of groups) {
    for (const r of group.results) {
      total++;
      if (r.status === 'pass') passed++;
      else if (r.status === 'warn') warnings++;
      else if (r.status === 'fail') failures++;
    }
  }

  const isSuccess = strict ? failures === 0 && warnings === 0 : failures === 0;

  return {
    timestamp: new Date().toISOString(),
    isSuccess,
    summary: { total, passed, warnings, failures },
    groups,
  };
}

/**
 * CLI Execution Handler
 */
async function main() {
  const args = process.argv.slice(2);
  const isJson = args.includes('--json');
  const skipNetwork = args.includes('--skip-network');
  const strict = args.includes('--strict');
  const help = args.includes('--help') || args.includes('-h');

  if (help) {
    console.log(`
Trellis Frontend Contributor Diagnostics

Usage:
  npm run diagnostics [options]
  node scripts/diagnostics.mjs [options]

Options:
  --json          Output results in machine-readable JSON format
  --skip-network  Skip external network/RPC reachability checks
  --strict        Treat warnings as failures (exit code 1)
  -h, --help      Show this help message
`);
    process.exit(0);
  }

  if (!isJson) {
    console.log(`${colors.bold}${colors.cyan}======================================================${colors.reset}`);
    console.log(`${colors.bold}${colors.cyan}  Trellis Frontend — Contributor Environment Diagnostics${colors.reset}`);
    console.log(`${colors.bold}${colors.cyan}======================================================${colors.reset}\n`);
  }

  const results = await runDiagnostics({ skipNetwork, strict });

  if (isJson) {
    console.log(JSON.stringify(results, null, 2));
    process.exit(results.isSuccess ? 0 : 1);
  }

  for (const group of results.groups) {
    console.log(`${colors.bold}▶ ${group.name}${colors.reset}`);
    for (const item of group.results) {
      console.log(`  ${badge(item.status)} ${colors.bold}${item.name}${colors.reset}: ${item.message}`);
      if (item.remediation && item.status !== 'pass') {
        console.log(`         ${colors.dim}↳ Remediation: ${item.remediation}${colors.reset}`);
      }
    }
    console.log();
  }

  console.log(`${colors.bold}------------------------------------------------------${colors.reset}`);
  console.log(
    `Summary: ${colors.bold}${results.summary.passed}${colors.reset} passed, ` +
    `${results.summary.warnings > 0 ? colors.yellow : ''}${results.summary.warnings} warning(s)${colors.reset}, ` +
    `${results.summary.failures > 0 ? colors.red : ''}${results.summary.failures} failure(s)${colors.reset}`
  );

  if (results.isSuccess) {
    console.log(`\n${colors.green}${colors.bold}✔ All required checks passed! Local environment is healthy and ready for development.${colors.reset}\n`);
    process.exit(0);
  } else {
    console.log(`\n${colors.red}${colors.bold}✖ Diagnostics detected ${results.summary.failures} failure(s). Please review remediation steps above.${colors.reset}\n`);
    process.exit(1);
  }
}

// Run CLI when executed directly
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error('Fatal diagnostics error:', err);
    process.exit(1);
  });
}
