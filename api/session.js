// Sign in, sign out, and "am I signed in".
//
// GET    → session state, plus whether the deployment is even capable of
//          signing anyone in and whether the Ask console has a model key.
// POST   → exchange the shared password for a cookie.
// DELETE → drop the cookie.

import { json, readJson } from '../lib/http.js';
import { clearSession, isAuthConfigured, isSignedIn, passwordMatches, setSession } from '../lib/auth.js';

// Deliberately coarse — enough to blunt a script, not enough to lock Josh out
// after a couple of typos. Per-instance, which is all a serverless runtime can
// honestly offer without a store.
const attempts = new Map();
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 10;

function rateLimited(req) {
  const ip = String(req.headers['x-forwarded-for'] || 'local').split(',')[0].trim();
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.since > WINDOW_MS) {
    attempts.set(ip, { since: now, count: 1 });
    return false;
  }
  rec.count += 1;
  return rec.count > MAX_ATTEMPTS;
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return json(res, 200, {
      signedIn: isSignedIn(req),
      passwordConfigured: isAuthConfigured(),
      askAvailable: Boolean(process.env.GEMINI_API_KEY),
    });
  }

  if (req.method === 'DELETE') {
    clearSession(res);
    return json(res, 200, { signedIn: false });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return json(res, 405, { error: 'method_not_allowed' });
  }

  if (!isAuthConfigured()) {
    return json(res, 503, {
      error: 'no_password_set',
      message:
        'APP_PASSWORD is not set on this deployment. Set it in the Vercel project settings and redeploy.',
    });
  }

  if (rateLimited(req)) {
    return json(res, 429, { error: 'too_many_attempts', message: 'Too many tries. Wait a minute.' });
  }

  const { password } = await readJson(req);
  if (!passwordMatches(password)) {
    return json(res, 401, { error: 'bad_password', message: 'That password is not right.' });
  }

  setSession(res);
  return json(res, 200, { signedIn: true, askAvailable: Boolean(process.env.GEMINI_API_KEY) });
}
