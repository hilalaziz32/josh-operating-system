// The gate.
//
// This app renders live spend, pipeline and hiring numbers, so the deployed URL
// cannot be open. One shared password (APP_PASSWORD) buys a signed, HTTPOnly
// cookie; every API route refuses without it.
//
// The cookie carries no secret — just an expiry and an HMAC over it. Nothing an
// attacker can forge without SESSION_SECRET, and nothing worth stealing if they
// read it.

import crypto from 'node:crypto';

const COOKIE = 'tc_session';
const TTL_MS = 1000 * 60 * 60 * 12; // A working day. Josh signs in once.

const secret = () =>
  process.env.SESSION_SECRET ||
  // Derived fallback so a deploy that only sets APP_PASSWORD still works.
  // Changing the password invalidates every existing session, which is correct.
  crypto.createHash('sha256').update(`tc:${process.env.APP_PASSWORD || ''}`).digest('hex');

export const isAuthConfigured = () => Boolean(process.env.APP_PASSWORD);

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function mint(expiresAt) {
  const body = b64url(JSON.stringify({ exp: expiresAt }));
  const mac = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(token) {
  if (typeof token !== 'string' || !token.includes('.')) return false;
  const [body, mac] = token.split('.');
  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  // Compare as fixed-length buffers so a length mismatch can't throw.
  const a = Buffer.from(mac || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return typeof exp === 'number' && Date.now() < exp;
  } catch {
    return false;
  }
}

/** Constant-time password check that doesn't leak length through early return. */
export function passwordMatches(candidate) {
  const expected = process.env.APP_PASSWORD || '';
  if (!expected) return false;
  const a = crypto.createHash('sha256').update(String(candidate ?? '')).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export function readCookies(req) {
  const raw = req.headers?.cookie || '';
  const out = {};
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function setSession(res) {
  const token = mint(Date.now() + TTL_MS);
  const flags = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(TTL_MS / 1000)}`];
  // Vercel is always HTTPS; localhost is not, and Secure would break dev sign-in.
  if (process.env.VERCEL) flags.push('Secure');
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; ${flags.join('; ')}`);
}

export function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function isSignedIn(req) {
  // An unconfigured password means the deploy hasn't been secured yet. Fail
  // closed: no password set, nobody gets in, and the UI says why.
  if (!isAuthConfigured()) return false;
  return verify(readCookies(req)[COOKIE]);
}

/**
 * Guard for an API route. Returns true when the request may proceed; otherwise
 * it has already written a 401 and the caller should return immediately.
 */
export function guard(req, res) {
  if (isSignedIn(req)) return true;
  res.statusCode = 401;
  res.setHeader('Content-Type', 'application/json');
  res.end(
    JSON.stringify({
      error: isAuthConfigured() ? 'unauthorized' : 'no_password_set',
      message: isAuthConfigured()
        ? 'Sign in to continue.'
        : 'APP_PASSWORD is not set on this deployment, so nobody can sign in.',
    })
  );
  return false;
}
