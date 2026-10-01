/**
 * Regression tests for the Vercel deployment architecture.
 *
 * Production served the Vite SPA shell for every /api/* request, so the client
 * called response.json() on `text/html` and failed with
 * `Unexpected token '<'`. Two independent defects combined to produce that:
 *
 *   1. vercel.json set "framework": "vite". Under a framework preset Vercel
 *      uses the preset's static builder, and the preset never emits functions
 *      for the project's api/ directory. Vercel only scans api/ for functions
 *      when no framework preset applies. Removing the key is not enough -
 *      Vercel auto-detects Vite from package.json - so it is explicitly nulled.
 *
 *   2. api/index.cjs was a two-line wrapper requiring ./_build/server.cjs. The
 *      function then depended on a second file being traced and packaged into
 *      the function directory. When that file is not packaged, no function is
 *      emitted at all and the deployment looks healthy while serving nothing.
 *      esbuild now writes the bundle straight to api/index.cjs, so the function
 *      is one file with no require graph to resolve.
 *
 * The second half of this file boots the built entrypoint exactly as Vercel's
 * Node runtime does (require the module, hand it to a Node http server) and
 * asserts the acceptance behaviour, so the routes cannot be broken by a
 * refactor that leaves the config valid.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createServer, request, type RequestListener } from 'node:http';
import { createRequire } from 'node:module';

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const config = () =>
  JSON.parse(read('vercel.json').replace(/^\s*\/\/[^\n]*\n/gm, '')) as {
    framework: string | null;
    buildCommand: string;
    outputDirectory: string;
    rewrites: { source: string; destination: string }[];
  };

// ---------------------------------------------------------------------------
// Function discovery
// ---------------------------------------------------------------------------

test('no framework preset, so Vercel scans api/ for functions', () => {
  // Must be null, not absent: omitting the key lets Vercel auto-detect Vite
  // from the vite dependency and reinstate the preset that drops api/.
  assert.equal(config().framework, null);
});

test('the frontend still builds to dist', () => {
  const v = config();
  assert.match(v.buildCommand, /npm run build/);
  assert.equal(v.outputDirectory, 'dist');
});

test('api/index.cjs exists and is the whole function', () => {
  // Exactly one file in api/. A second file is a file Vercel must trace into
  // the function package, which is the failure mode this layout removes.
  const files = readdirSync(join(root, 'api'), { recursive: true } as never) as unknown as string[];
  assert.deepEqual(files.filter(f => !String(f).includes('node_modules')).sort(), ['index.cjs']);
});

test('the function entrypoint is generated into api/, never into dist/', () => {
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
  assert.match(pkg.scripts['build:server'], /--outfile=api\/index\.cjs/);
  assert.doesNotMatch(pkg.scripts['build:server'], /--outfile=dist\//);
  assert.doesNotMatch(pkg.scripts['build:server'], /\.build\//);
});

test('the function bundle ships no source map', () => {
  // api/ is packaged into the deployed function. A .map next to the entrypoint
  // is backend source in the artifact; dist must stay free of it too.
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
  assert.doesNotMatch(pkg.scripts['build:server'], /--sourcemap/);
  assert.equal(existsSync(join(root, 'api/index.cjs.map')), false);
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

test('every /api/* path is rewritten to the single /api function', () => {
  const api = config().rewrites.find(r => r.source.startsWith('/api'));
  assert.ok(api, 'expected an /api rewrite');
  // The destination only selects the function. req.url keeps the original path,
  // which is what Express routes on, so one function serves the whole API
  // surface without enumerating endpoints.
  assert.equal(api.destination, '/api');
});

test('the SPA fallback cannot serve /api/*', () => {
  const spa = config().rewrites.find(r => r.destination === '/index.html');
  assert.ok(spa, 'SPA fallback rewrite is missing');
  // Must exclude /api, or an unreachable function turns back into 200 HTML.
  assert.match(spa.source, /\(\?!api\)/);
});

// ---------------------------------------------------------------------------
// Runtime behaviour of the deployed entrypoint
// ---------------------------------------------------------------------------

// Vercel's Node runtime requires the entrypoint and calls it as a Node
// (req, res) handler. Reproduce that path rather than npm run dev, which runs
// tsx server.ts and mounts the Vite dev middleware instead.
const entrypoint = join(root, 'api/index.cjs');
const built = existsSync(entrypoint);

async function call(app: RequestListener, path: string, method = 'GET') {
  const server = createServer(app);
  await new Promise<void>(r => server.listen(0, r));
  const { port } = server.address() as { port: number };
  try {
    return await new Promise<{ status: number; type: string; body: string }>(resolve => {
      const req = request({ port, path, method }, res => {
        let body = '';
        res.on('data', (c: Buffer) => (body += c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type']), body })
        );
      });
      req.on('error', () => resolve({ status: 0, type: '', body: '' }));
      req.end();
    });
  } finally {
    server.close();
  }
}

test('the built function serves the API surface', { skip: built ? false : 'run npm run build first' }, async () => {
  // server.ts guards its export and its app.listen() on these, exactly as they
  // are set inside the Vercel function runtime.
  process.env.VERCEL = '1';
  process.env.NODE_ENV = 'production';
  const app = createRequire(import.meta.url)(entrypoint) as RequestListener;
  assert.equal(typeof app, 'function', 'entrypoint must export a request handler');

  const health = await call(app, '/api/health');
  assert.equal(health.status, 200);
  assert.match(health.type, /application\/json/);
  assert.equal(JSON.parse(health.body).status, 'ok');

  // Auth must still gate the protected routes. No Authorization header here,
  // so both must refuse - a 200 would mean the guard was dropped.
  for (const path of ['/api/admin/dashboard/overview', '/api/notifications']) {
    const res = await call(app, path);
    assert.equal(res.status, 401, `${path} must require authentication`);
    assert.match(res.type, /application\/json/, `${path} must fail as JSON`);
  }

  // An unknown API path is JSON, never the SPA shell.
  const missing = await call(app, '/api/does-not-exist');
  assert.equal(missing.status, 404);
  assert.match(missing.type, /application\/json/);
});