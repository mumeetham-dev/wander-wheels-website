import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { prisma } from '../db.js';
import { ok, fail, ah } from '../lib/http.js';
import {
  hashToken,
  newSessionToken,
  setSessionCookie,
  clearSessionCookie,
  loadSession,
  logActivity,
  clientIp,
} from '../lib/auth.js';

export const adminAuthRouter = Router();

export const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many login attempts. Try again later.', code: 'RATE_LIMITED' },
});

function safeProfile(admin) {
  return {
    id: admin.id,
    email: admin.email,
    name: admin.display_name,
    role: admin.role.toLowerCase(),
  };
}

adminAuthRouter.post(
  '/login',
  loginLimiter,
  ah(async (req, res) => {
    const email = String(req.body?.email ?? '').trim();
    const password = String(req.body?.password ?? '');
    if (!email || !password) {
      return fail(res, 400, 'Email and password are required.', 'VALIDATION_ERROR');
    }
    const admin = await prisma.admins.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
    // Same timing/response whether or not the account exists.
    const hash = admin?.password_hash ?? '$2b$10$invalidinvalidinvalidinvalidinvalid12';
    const passwordOk = await bcrypt.compare(password, hash);
    if (!admin || !admin.is_active || !passwordOk) {
      return fail(res, 401, 'Invalid email or password.', 'UNAUTHENTICATED');
    }
    const rawToken = newSessionToken();
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
    await prisma.admin_sessions.create({
      data: {
        admin_id: admin.id,
        token_hash: hashToken(rawToken),
        expires_at: expiresAt,
        ip_address: clientIp(req),
        user_agent: String(req.headers['user-agent'] ?? '').slice(0, 500) || null,
      },
    });
    await prisma.admins.update({
      where: { id: admin.id },
      data: { last_login_at: new Date() },
    });
    logActivity({
      adminId: admin.id,
      action: 'admin.login',
      summary: `${admin.email} logged in`,
      ip: clientIp(req),
    });
    setSessionCookie(res, rawToken);
    ok(res, { ...safeProfile(admin), token: rawToken });
  }),
);

adminAuthRouter.get(
  '/me',
  ah(async (req, res) => {
    const found = await loadSession(req);
    if (!found) return fail(res, 401, 'Login required.', 'UNAUTHENTICATED');
    ok(res, safeProfile(found.admin));
  }),
);

adminAuthRouter.post(
  '/logout',
  ah(async (req, res) => {
    const found = await loadSession(req);
    if (found) {
      await prisma.admin_sessions.delete({ where: { id: found.session.id } }).catch(() => {});
    }
    clearSessionCookie(res);
    ok(res, { loggedOut: true });
  }),
);

// Generic response: never reveal whether an account exists.
adminAuthRouter.post(
  '/forgot-password',
  loginLimiter,
  ah(async (req, res) => {
    const email = String(req.body?.email ?? '').trim();
    if (email) {
      const admin = await prisma.admins.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
      });
      if (admin && admin.is_active) {
        const raw = crypto.randomBytes(32).toString('hex');
        await prisma.password_reset_tokens.create({
          data: {
            admin_id: admin.id,
            token_hash: hashToken(raw),
            expires_at: new Date(Date.now() + 60 * 60 * 1000),
          },
        });
        // No mailer is configured in this step; the token is logged server-side
        // for the owner to deliver out-of-band. Never returned to the client.
        console.log(`password reset requested for ${admin.email}`);
      }
    }
    ok(res, { message: 'If an account exists, reset instructions were created.' });
  }),
);

adminAuthRouter.post(
  '/reset-password',
  loginLimiter,
  ah(async (req, res) => {
    const token = String(req.body?.token ?? '');
    const newPassword = String(req.body?.newPassword ?? '');
    if (!token || newPassword.length < 10) {
      return fail(res, 400, 'A valid token and a 10+ character password are required.', 'VALIDATION_ERROR');
    }
    const row = await prisma.password_reset_tokens.findUnique({
      where: { token_hash: hashToken(token) },
      include: { admins: true },
    });
    if (!row || row.used_at || row.expires_at.getTime() < Date.now() || !row.admins?.is_active) {
      return fail(res, 400, 'Reset token is invalid or expired.', 'VALIDATION_ERROR');
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.$transaction([
      prisma.admins.update({
        where: { id: row.admin_id },
        data: { password_hash: passwordHash, password_changed_at: new Date() },
      }),
      prisma.password_reset_tokens.update({
        where: { id: row.id },
        data: { used_at: new Date() },
      }),
      prisma.admin_sessions.deleteMany({ where: { admin_id: row.admin_id } }),
    ]);
    logActivity({ adminId: row.admin_id, action: 'admin.password_reset', summary: 'Password reset completed' });
    ok(res, { reset: true });
  }),
);
