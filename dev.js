// Local dev server.
//
// Vercel gives you `public/` as static files and `api/*.js` as functions. This
// reproduces exactly that, using only Node, so the app runs with `npm run dev`
// and no Vercel CLI. Handlers are imported fresh on every request, so editing a
// route doesn't need a restart.
//
//   npm run dev   →   http://localhost:4321

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4321);

/* Load .env, which on Vercel is the project's environment variables instead. */
function loadEnv() {
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return 0;
  let loaded = 0;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let [, key, value] = match;
    value = value.trim().replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[key] === undefined) {
      process.env[key] = value;
      loaded += 1;
    }
  }
  return loaded;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = path.join(root, 'public', rel);

  // Never serve outside public/.
  if (!target.startsWith(path.join(root, 'public'))) {
    res.statusCode = 403;
    return res.end('Forbidden');
  }

  try {
    const body = await fsp.readFile(target);
    res.statusCode = 200;
    res.setHeader('Content-Type', TYPES[path.extname(target)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(body);
  } catch {
    // Unknown path falls back to the app shell, matching Vercel's behaviour.
    try {
      const shell = await fsp.readFile(path.join(root, 'public', 'index.html'));
      res.statusCode = 200;
      res.setHeader('Content-Type', TYPES['.html']);
      return res.end(shell);
    } catch {
      res.statusCode = 404;
      return res.end('Not found');
    }
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (!url.pathname.startsWith('/api/')) {
    return serveStatic(req, res, url.pathname);
  }

  const name = url.pathname.slice('/api/'.length).replace(/\/+$/, '');
  const file = path.join(root, 'api', `${name}.js`);

  if (!/^[a-z0-9-]+$/.test(name) || !fs.existsSync(file)) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'not_found' }));
  }

  req.query = Object.fromEntries(url.searchParams.entries());

  try {
    // Cache-busted import so route edits are picked up without a restart.
    const mod = await import(`${pathToFileURL(file).href}?v=${Date.now()}`);
    await mod.default(req, res);
  } catch (err) {
    console.error(`[api/${name}]`, err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
    }
    if (!res.writableEnded) res.end(JSON.stringify({ error: 'handler_failed', message: String(err?.message || err) }));
  }
});

const count = loadEnv();

// A port clash is the most common way this fails to start. Say what to do about
// it rather than printing a stack trace.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use — the Control Room may already be running.`);
    console.error(`  Open http://localhost:${PORT}, or start on another port:\n`);
    console.error(`      PORT=4322 npm run dev\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  The Coordinators — Control Room`);
  console.log(`  http://localhost:${PORT}\n`);
  console.log(`  .env            ${count ? `${count} variables loaded` : 'not found — systems will read as unconfigured'}`);
  console.log(`  APP_PASSWORD    ${process.env.APP_PASSWORD ? 'set' : 'NOT SET — nobody can sign in'}`);
  console.log(`  GEMINI_API_KEY  ${process.env.GEMINI_API_KEY ? 'set' : 'not set — the Ask console is off'}\n`);
});
