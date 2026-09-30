/**
 * Build gate: refuse to publish a `dist/` that contains backend source.
 *
 * `dist` is Vercel's `outputDirectory` and therefore fully public. An earlier
 * build emitted `server.cjs` and `server.cjs.map` into it, which made the whole
 * Express backend and its full source map downloadable at
 * `https://<host>/server.cjs` and `/server.cjs.map`.
 *
 * This check runs on every `npm run build` so that regression fails the build
 * rather than shipping.
 */
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = 'dist';

if (!existsSync(DIST)) {
  console.error('[build:verify] FAIL - dist/ does not exist. Did vite build run?');
  process.exit(1);
}

/** Recursively collect every file path under dist/. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = walk(DIST);
const problems = [];

// 1. No backend bundles or source maps may exist in the published directory.
const FORBIDDEN = [/\.cjs$/i, /\.map$/i, /\.ts$/i, /^\.env/i, /\.sql$/i, /\.bak$/i];
for (const file of files) {
  const rel = relative(DIST, file);
  if (FORBIDDEN.some((re) => re.test(rel))) {
    problems.push(`backend/secret-shaped file published: ${rel}`);
  }
}

// 2. No .env of any kind.
for (const file of files) {
  if (/(^|\/)\.env/i.test(relative(DIST, file))) {
    problems.push(`environment file published: ${relative(DIST, file)}`);
  }
}

// 3. No server-only secret identifiers in any shipped asset.
const SECRET_MARKERS = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  'ADMIN_PASSWORD',
  'DEMO_TOKEN_SECRET',
  'DEMO_AUTH_SECRET',
  'JWT_SECRET',
  'LOGIN_ALERT_SALT',
];
for (const file of files) {
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue; // binary asset (png/ico/svg) - nothing to scan
  }
  for (const marker of SECRET_MARKERS) {
    if (text.includes(marker)) {
      problems.push(`secret identifier "${marker}" present in ${relative(DIST, file)}`);
    }
  }
}

// 4. Google Search Console HTML-file ownership verification must survive the
// build. Google fetches
// https://<host>/google21eac387d38ffddc.html and compares the response body to
// the token byte for byte, so a wrong or missing copy reports
// "Ownership verification failed - Your verification file has the wrong
// content." The file lives in public/ and Vite copies it to the dist/ root;
// Vercel serves static output-directory files before applying the SPA rewrite,
// so it is never routed to index.html.
const VERIFICATION_FILE = 'google21eac387d38ffddc.html';
const VERIFICATION_BODY = 'google-site-verification: google21eac387d38ffddc.html';

const verificationPath = join(DIST, VERIFICATION_FILE);
if (!existsSync(verificationPath)) {
  problems.push(`Search Console verification file missing from dist/: ${VERIFICATION_FILE}`);
} else if (readFileSync(verificationPath, 'utf8') !== VERIFICATION_BODY) {
  problems.push(`Search Console verification file has wrong content: ${VERIFICATION_FILE}`);
}

if (problems.length > 0) {
  console.error('[build:verify] FAIL - dist/ is not safe to publish:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`[build:verify] OK - ${files.length} files in dist/, no server source or secrets.`);
