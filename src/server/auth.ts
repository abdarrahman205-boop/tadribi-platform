import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Request, Response, NextFunction } from 'express';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth as getFirebaseAdminAuth } from 'firebase-admin/auth';
import { db } from './db';

export const OFFICIAL_ADMIN_EMAIL = 'elalyatalebjidou@gmail.com';
export const PUBLIC_APP_ORIGIN = 'https://tadribi.chtbqi.com';

const REFERRAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateUniqueReferralCode(database: typeof db = db): string {
  const checkStmt = database.prepare('SELECT id FROM users WHERE upper(referral_code) = ? LIMIT 1');
  for (let attempt = 0; attempt < 16; attempt++) {
    const bytes = crypto.randomBytes(8);
    let suffix = '';
    for (let i = 0; i < 8; i++) {
      suffix += REFERRAL_ALPHABET[bytes[i] % REFERRAL_ALPHABET.length];
    }
    const code = `TD-${suffix}`;
    if (!checkStmt.get(code)) {
      return code;
    }
  }
  return `TD-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

// Initialize Firebase Admin SDK strictly with projectId for ID token verification (requires zero IAM)
function getFirebaseProjectId(): string | null {
  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (!fs.existsSync(cfgPath)) return null;
    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    if (raw?.projectId && raw.projectId !== 'remixed-project-id') {
      return String(raw.projectId);
    }
  } catch {
    // ignore
  }
  return null;
}

const fbProjectId = getFirebaseProjectId();
const firebaseAdminApp = fbProjectId
  ? getApps().length
    ? getApp()
    : initializeApp({ projectId: fbProjectId })
  : null;

// Ephemeral fallback secret if SESSION_SECRET is not set in environment variables
const RUNTIME_SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const RUNTIME_RESET_SECRET = process.env.RESET_SECRET || RUNTIME_SESSION_SECRET;

export interface TokenPayload {
  userId: number;
  email: string;
  role: 'admin' | 'editor' | 'teacher' | 'student';
  tv?: number;
  exp: number;
  firebaseUid?: string;
  emailVerified?: boolean;
}

export interface AuthenticatedRequest extends Request {
  authUser?: TokenPayload;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derivedBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, derivedBuf);
}

export function signSessionToken(payload: Omit<TokenPayload, 'exp'>): string {
  const fullPayload: TokenPayload = {
    ...payload,
    tv: payload.tv ?? 1,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7,
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', RUNTIME_SESSION_SECRET)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function hashResetSecret(value: string): string {
  return crypto.createHmac('sha256', RUNTIME_RESET_SECRET).update(value).digest('hex');
}

export function safeHexEquals(hexA: string, hexB: string): boolean {
  if (!hexA || !hexB || hexA.length !== hexB.length) return false;
  const a = Buffer.from(hexA, 'hex');
  const b = Buffer.from(hexB, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

let cachedReceiptSecret: string | null = null;

function getReceiptHmacSecret(): string {
  if (process.env.RECEIPT_HMAC_SECRET?.trim()) {
    return process.env.RECEIPT_HMAC_SECRET.trim();
  }
  if (cachedReceiptSecret) return cachedReceiptSecret;
  try {
    const existing = db
      .prepare("SELECT value FROM app_settings WHERE key = 'receipt_hmac_secret'")
      .get() as { value?: string } | undefined;
    if (existing?.value && existing.value.length >= 32) {
      cachedReceiptSecret = existing.value;
      return cachedReceiptSecret;
    }
    const generated = crypto.randomBytes(32).toString('hex');
    db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('receipt_hmac_secret', ?)").run(generated);
    const saved = db
      .prepare("SELECT value FROM app_settings WHERE key = 'receipt_hmac_secret'")
      .get() as { value?: string } | undefined;
    cachedReceiptSecret = saved?.value || generated;
    return cachedReceiptSecret;
  } catch {
    return RUNTIME_RESET_SECRET;
  }
}

export function signReceiptVerifyToken(rid: string): string {
  const cleanRid = String(rid || '').trim().toUpperCase();
  return crypto.createHmac('sha256', getReceiptHmacSecret()).update(`receipt:${cleanRid}`).digest('base64url');
}

export function verifyReceiptVerifyToken(rid: string, sig: string): boolean {
  const cleanRid = String(rid || '').trim().toUpperCase();
  const cleanSig = String(sig || '').trim();
  if (!cleanRid || !cleanSig) return false;
  const expected = signReceiptVerifyToken(cleanRid);
  const a = Buffer.from(cleanSig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function buildReceiptVerifyUrl(rid: string): { sig: string; url: string } {
  const cleanRid = String(rid || '').trim().toUpperCase();
  const sig = signReceiptVerifyToken(cleanRid);
  const url = `${PUBLIC_APP_ORIGIN}/verify-receipt?rid=${encodeURIComponent(cleanRid)}&sig=${encodeURIComponent(sig)}`;
  return { sig, url };
}

export async function updateFirebaseUserPasswordByEmail(
  email: string,
  newPassword: string
): Promise<{ ok: boolean; error?: string }> {
  if (!firebaseAdminApp) {
    return { ok: false, error: 'Firebase Admin not initialized' };
  }
  try {
    const fbAuth = getFirebaseAdminAuth(firebaseAdminApp);
    const userRecord = await fbAuth.getUserByEmail(email.trim().toLowerCase());
    await fbAuth.updateUser(userRecord.uid, { password: newPassword });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Unable to sync Firebase Auth password' };
  }
}

export function verifySessionToken(token: string): TokenPayload | null {
  try {
    const [encoded, sig] = token.split('.');
    if (!encoded || !sig) return null;
    const expectedSig = crypto
      .createHmac('sha256', RUNTIME_SESSION_SECRET)
      .update(encoded)
      .digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return null;
    }
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TokenPayload;
    if (!parsed.exp || Date.now() > parsed.exp) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function extractTokenFromRequest(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const cookies = cookieHeader.split(';');
    for (const part of cookies) {
      const idx = part.indexOf('=');
      if (idx > -1) {
        const key = part.slice(0, idx).trim();
        const val = part.slice(idx + 1).trim();
        if (key === 'fl_session') {
          return decodeURIComponent(val);
        }
      }
    }
  }
  return null;
}

export function setSessionCookie(req: Request, res: Response, token: string): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const attrs = [
    `fl_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${60 * 60 * 24 * 7}`,
  ];
  if (isHttps) {
    attrs.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    attrs.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', attrs.join('; '));
}

export function clearSessionCookie(req: Request, res: Response): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const attrs = ['fl_session=', 'Path=/', 'HttpOnly', 'Max-Age=0'];
  if (isHttps) {
    attrs.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    attrs.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function upsertShadowSqliteUser(email: string, displayName: string, isOfficialAdmin: boolean): TokenPayload | null {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return null;
  const role: 'admin' | 'student' = isOfficialAdmin ? 'admin' : 'student';

  let row = db.prepare('SELECT id, email, role, token_version FROM users WHERE email = ?').get(normalizedEmail) as
    | { id: number; email: string; role: string; token_version: number }
    | undefined;

  if (!row) {
    const placeholderHash = hashPassword(crypto.randomBytes(24).toString('hex'));
    const refCode = generateUniqueReferralCode(db);
    const res = db
      .prepare(
        "INSERT INTO users (name, email, password_hash, role, track, preferred_lang, level, referral_code, last_active_at) VALUES (?, ?, ?, ?, 'bilingual', 'ar', 'foundation', ?, datetime('now'))"
      )
      .run(displayName || normalizedEmail.split('@')[0], normalizedEmail, placeholderHash, role, refCode);
    row = {
      id: Number(res.lastInsertRowid),
      email: normalizedEmail,
      role,
      token_version: 1,
    };
  } else if (row.role !== role) {
    // Enforce Single Official Admin Email strictly on SQLite shadow record too
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, row.id);
    row.role = role;
  }

  return {
    userId: row.id,
    email: row.email,
    role,
    tv: row.token_version ?? 1,
    exp: Date.now() + 3600_000,
  };
}

export function isDeviceSessionRevoked(userId: number, req: Request): boolean {
  const sid = String(req.headers['x-device-session-id'] || '').trim();
  if (!sid) return false;
  const row = db
    .prepare('SELECT is_revoked FROM user_sessions WHERE user_id = ? AND session_id = ?')
    .get(userId, sid) as { is_revoked: number } | undefined;
  return Boolean(row && Number(row.is_revoked) === 1);
}

export async function attachAuthIfPresent(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const token = extractTokenFromRequest(req);
  if (!token) {
    next();
    return;
  }

  // 1) Try Firebase ID token verification (Bearer JWT from Firebase Auth)
  if (firebaseAdminApp && token.split('.').length === 3) {
    try {
      const decoded = await getFirebaseAdminAuth(firebaseAdminApp).verifyIdToken(token);
      const email = (decoded.email || '').trim().toLowerCase();
      const emailVerified = Boolean(decoded.email_verified);
      const isOfficialAdmin = email === OFFICIAL_ADMIN_EMAIL && emailVerified;
      const mapped = upsertShadowSqliteUser(email, String(decoded.name || ''), isOfficialAdmin);
      if (mapped) {
        mapped.firebaseUid = decoded.uid;
        mapped.emailVerified = emailVerified;
        req.authUser = mapped;
        next();
        return;
      }
    } catch {
      // Fall through to local HMAC token verification if not a Firebase JWT
    }
  }

  // 2) Fallback: legacy HMAC token verification
  const payload = verifySessionToken(token);
  if (payload) {
    const email = payload.email.trim().toLowerCase();
    // Enforce single official admin rule even on HMAC tokens
    payload.role = email === OFFICIAL_ADMIN_EMAIL && payload.role === 'admin' ? 'admin' : 'student';
    req.authUser = payload;
  }
  next();
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.authUser) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  if (isDeviceSessionRevoked(req.authUser.userId, req)) {
    res.status(401).json({
      code: 'SESSION_REVOKED',
      error: 'تم إنهاء جلسة هذا الجهاز من إعدادات الأمان. يرجى تسجيل الدخول مجدداً.',
    });
    return;
  }
  next();
}

export function requireRole(...roles: Array<'admin' | 'editor' | 'teacher' | 'student'>) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const isOfficialAdmin = req.authUser.email.trim().toLowerCase() === OFFICIAL_ADMIN_EMAIL;
    if (!isOfficialAdmin || !roles.includes(req.authUser.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}

export function verifyCsrfForMutations(req: Request, res: Response, next: NextFunction): void {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    next();
    return;
  }
  const hasBearer = Boolean(req.headers.authorization?.startsWith('Bearer '));
  const hasCookie = Boolean(req.headers.cookie?.includes('fl_session='));
  if (hasCookie && !hasBearer) {
    const xrw = req.headers['x-requested-with'];
    const origin = req.headers.origin;
    const host = (req.headers['x-forwarded-host'] || req.headers.host || '') as string;
    const originMatchesHost = origin ? origin.includes(host.split(',')[0].trim()) : false;
    if (xrw !== 'XMLHttpRequest' && !originMatchesHost) {
      res.status(403).json({ error: 'CSRF validation failed' });
      return;
    }
  }
  next();
}

export function normalizeQuestionFingerprint(stemAr: string, stemFr: string): string {
  const clean = (s: string) =>
    s
      .toLowerCase()
      .replace(/[\u064B-\u065F\u0670]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, '')
      .trim();
  const base = `${clean(stemAr)}|${clean(stemFr)}`;
  return crypto.createHash('sha256').update(base).digest('hex');
}
