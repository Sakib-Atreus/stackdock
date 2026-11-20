// oxlint-disable no-console -- CLI output is the user interface here.
/**
 * Admin bootstrap CLI (docs/decisions.md D-11). There is deliberately no web
 * sign-up or setup page; you need shell access to the server to run this.
 *
 *   node dist/cli/admin.js create           # first admin; refuses if one exists
 *   node dist/cli/admin.js reset-password   # forgotten password; signs out everywhere
 *
 * Non-interactive use (e.g. a one-off Northflank job): set ADMIN_EMAIL and
 * ADMIN_INITIAL_PASSWORD (create) or ADMIN_NEW_PASSWORD (reset-password).
 * Remove those variables again afterwards.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createPrismaClient, Prisma } from '@stackdock/db';
import { emailSchema, newPasswordSchema } from '@stackdock/shared';
import { parseEnv } from '../config/env.js';
import { PasswordService } from '../modules/auth/password.service.js';
import { prompt } from './prompt.js';

const rootEnv = path.resolve(import.meta.dirname, '../../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const command = process.argv[2];
if (command !== 'create' && command !== 'reset-password') {
  console.error('Usage: admin.js <create | reset-password>');
  process.exit(2);
}

const env = parseEnv(process.env);
const prisma = createPrismaClient(env.DATABASE_URL);
const passwords = new PasswordService();

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

async function readEmail(): Promise<string> {
  const raw = process.env.ADMIN_EMAIL ?? (await prompt('Admin email: '));
  const parsed = emailSchema.safeParse(raw);
  if (!parsed.success) fail('Invalid email address.');
  return parsed.data;
}

async function readNewPassword(envName: string): Promise<string> {
  const fromEnv = process.env[envName];
  const password = fromEnv ?? (await prompt('New password: ', true));
  const parsed = newPasswordSchema.safeParse(password);
  if (!parsed.success) {
    fail(parsed.error.issues[0]?.message ?? 'Invalid password.');
  }
  if (!fromEnv) {
    const again = await prompt('Repeat password: ', true);
    if (again !== password) fail('Passwords do not match.');
  }
  return parsed.data;
}

async function create(): Promise<void> {
  if ((await prisma.adminUser.count()) > 0) {
    fail(
      'An admin already exists. Setup is closed. Use `reset-password` if you lost access.',
    );
  }
  const email = await readEmail();
  const passwordHash = await passwords.hash(
    await readNewPassword('ADMIN_INITIAL_PASSWORD'),
  );
  const user = await prisma.adminUser.create({
    data: { email, passwordHash },
  });
  await prisma.activityLog.create({
    data: {
      action: 'admin.created',
      status: 'SUCCESS',
      targetType: 'AdminUser',
      targetId: user.id,
      safeMetadata: Prisma.JsonNull,
    },
  });
  console.log(`✔ Admin ${email} created. You can now sign in.`);
}

async function resetPassword(): Promise<void> {
  const email = await readEmail();
  const user = await prisma.adminUser.findUnique({ where: { email } });
  if (!user) fail('No admin with that email.');
  const passwordHash = await passwords.hash(
    await readNewPassword('ADMIN_NEW_PASSWORD'),
  );
  await prisma.$transaction([
    prisma.adminUser.update({ where: { id: user.id }, data: { passwordHash } }),
    prisma.session.deleteMany({ where: { userId: user.id } }),
    prisma.activityLog.create({
      data: {
        action: 'admin.password_reset',
        status: 'SUCCESS',
        targetType: 'AdminUser',
        targetId: user.id,
        safeMetadata: Prisma.JsonNull,
      },
    }),
  ]);
  console.log(`✔ Password for ${email} reset. All sessions were signed out.`);
}

try {
  await (command === 'create' ? create() : resetPassword());
} finally {
  await prisma.$disconnect();
}
