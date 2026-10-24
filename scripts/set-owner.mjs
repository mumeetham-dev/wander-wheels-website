// Set/replace the single owner login. Env: OWNER_EMAIL, OWNER_PASSWORD.
// Deactivates every other admin and revokes all sessions.
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const email = process.env.OWNER_EMAIL;
const password = process.env.OWNER_PASSWORD;
if (!email || !password || password.length < 10) {
  console.error('OWNER_EMAIL and OWNER_PASSWORD (10+ chars) are required.');
  process.exit(1);
}

const existing = await prisma.admins.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
const hash = await bcrypt.hash(password, 10);
if (existing) {
  await prisma.admins.update({
    where: { id: existing.id },
    data: { email, password_hash: hash, password_changed_at: new Date(), is_active: true, role: 'OWNER' },
  });
  console.log(`updated owner ${email}`);
} else {
  await prisma.admins.create({
    data: { email, display_name: 'Wander Wheels Owner', password_hash: hash, role: 'OWNER' },
  });
  console.log(`created owner ${email}`);
}
await prisma.admins.updateMany({ where: { email: { not: email } }, data: { is_active: false } });
await prisma.admin_sessions.deleteMany({});
console.log('other admins deactivated, all sessions revoked');
await prisma.$disconnect();
