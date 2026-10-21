/**
 * Secure, one-time super admin provisioning and break-glass recovery.
 *
 *   npm run setup:superadmin -- --email admin@org.mw --username admin --name "Jane Banda"
 *
 * The password is read interactively (never from argv, so it is not stored in shell history),
 * or from SETUP_PASSWORD for non-interactive environments. Re-running for an existing account
 * resets its password, clears MFA and lockouts, revokes sessions and forces a password change.
 */
import readline from 'node:readline';
import { config } from '../server/config';
import { createDb, runMigrations } from '../server/db/client';
import { seedBase } from '../server/db/seed';
import { provisionSuperAdmin } from '../server/services/auth';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function promptHidden(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
  let muted = false;
  out._writeToOutput = (s: string) => {
    if (!muted) out.output.write(s);
  };
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

const email = arg('email') ?? process.env.SETUP_EMAIL;
const username = arg('username') ?? process.env.SETUP_USERNAME;
const name = arg('name') ?? process.env.SETUP_NAME ?? 'Super Admin';
if (!email || !username) {
  console.error('Usage: npm run setup:superadmin -- --email <email> --username <username> [--name "Full Name"]');
  process.exit(1);
}

let password = process.env.SETUP_PASSWORD;
if (!password) {
  password = await promptHidden('Password (min 12 chars, upper/lower case and a number): ');
  const confirm = await promptHidden('Confirm password: ');
  if (password !== confirm) {
    console.error('Passwords do not match.');
    process.exit(1);
  }
}

const handle = await createDb({ url: config.databaseUrl, pgliteDir: config.pgliteDir });
try {
  await runMigrations(handle);
  await seedBase(handle.db);
  const result = await provisionSuperAdmin(handle.db, { email, username, password, name }, { requestId: 'cli-setup' });
  console.log(result.created ? `Super admin "${username}" created.` : `Access restored for "${username}" (super admin role ensured).`);
  console.log('A password change will be required at first sign-in.');
} catch (err) {
  const e = err as { message?: string; details?: unknown };
  console.error('Failed:', e.message, e.details ? JSON.stringify(e.details) : '');
  process.exitCode = 1;
} finally {
  await handle.close();
}
