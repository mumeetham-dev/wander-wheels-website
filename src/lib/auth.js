import crypto from 'node:crypto';
import { prisma } from '../db.js';
import { fail } from './http.js';

export const SESSION_COOKIE = 'ww_admin';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export function newSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function setSessionCookie(res, rawToken) {
  res.cookie(SESSION_COOKIE, rawToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_MS,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

function tokenFromRequest(req) {
  if (req.cookies?.[SESSION_COOKIE]) return req.cookies[SESSION_COOKIE];
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length);
  return null;
}

export async function loadSession(req) {
  const raw = tokenFromRequest(req);
  if (!raw || raw.length > 256) return null;
  const session = await prisma.admin_sessions.findUnique({
    where: { token_hash: hashToken(raw) },
    include: { admins: true },
  });
  if (!session) return null;
  if (session.expires_at.getTime() < Date.now()) {
    await prisma.admin_sessions.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (!session.admins || !session.admins.is_active) return null;
  // Fire-and-forget activity stamp; never block the request on it.
  prisma.admin_sessions
    .update({ where: { id: session.id }, data: { last_seen_at: new Date() } })
    .catch(() => {});
  return { session, admin: session.admins };
}

// Any authenticated, active admin.
export function requireAdmin(req, res, next) {
  loadSession(req)
    .then((found) => {
      if (!found) return fail(res, 401, 'Login required.', 'UNAUTHENTICATED');
      req.adminSession = found.session;
      req.admin = {
        id: found.admin.id,
        email: found.admin.email,
        name: found.admin.display_name,
        role: found.admin.role,
      };
      next();
    })
    .catch(next);
}

// Role hierarchy: OWNER > ADMIN > EDITOR.
export function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.admin) return fail(res, 401, 'Login required.', 'UNAUTHENTICATED');
    if (!allowed.includes(req.admin.role)) {
      return fail(res, 403, 'Insufficient role for this action.', 'FORBIDDEN');
    }
    next();
  };
}

// Best-effort audit trail; failures must not break the API response.
export function logActivity({ adminId, action, entityType, entityId, summary, metadata, ip }) {
  return prisma.activity_logs
    .create({
      data: {
        admin_id: adminId ?? null,
        action,
        entity_type: entityType ?? null,
        entity_id: entityId ?? null,
        summary: summary ?? null,
        metadata: metadata ?? {},
        ip_address: ip ?? null,
      },
    })
    .catch((err) => console.error('activity log failed:', err.message));
}

export function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim().slice(0, 45);
  }
  return req.ip?.slice(0, 45) ?? null;
}
