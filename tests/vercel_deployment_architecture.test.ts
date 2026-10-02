/**
* Regression tests for the Vercel deployment architecture.
 *
 * Production served the Vite SPA shell for every /api/* request, so the client
 * called response.json() on `text/html` and failed with `Unexpected token '<'`.
 *
 * A preview deployment then proved what was actually wrong. The remote build log
 * showed `build:server` writing api/index.cjs (693.8 kB) and build:verify
 * passing, the deployment going Ready, and /api/* still returning a Vercel
 * NOT_FOUND while /admin returned the SPA. The build never ran a function
 * builder at all: nothing created a route from api/. It also falsified the
 * earlier theory that the Vite framework preset was suppressing discovery -
 * nulling it changed nothing.
 *
 * The fix is to stop depending on automatic api/ discovery entirely and name
 * the builders in vercel.json. api/index.cjs is compiled by @vercel/node, so
 * the function exists by declaration rather than by convention. The frontend is
 * built by @vercel/static-build into dist, which is unchanged.
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
    framework?: string | null;
    buildCommand?: string;
    outputDirectory?: string;
    builds: { src: string; use: string; config?: Record<string, string> }[];
    rewrites: { source: string; destination: string }[];
  };

// ---------------------------------------------------------------------------
// Function discovery
// ---------------------------------------------------------------------------

test('api/index.cjs is explicitly built as a Vercel Node Function', () => {
  // Automatic api/ discovery produced a deployment with zero functions: the
  // build log showed the bundle being written and no function builder ever
  // running. Declaring the builder removes the discovery step entirely.
  const node = config().builds.find(b => b.use === '@vercel/node');
  assert.ok(node, 'expected an @vercel/node build entry');
  assert.equal(node.src, 'api/index.cjs');
});

test('no framework preset is relied on for function discovery', () => {
  // `builds` overrides framework detection. A leftover preset or an
  // outputDirectory would make the config internally inconsistent: static-build
  // publishes distDir, so outputDirectory is meaningless and must not be set.
  const v = config();
  assert.equal(v.builds.some(b => b.use === '@vercel/static-build'), true);
  assert.equal(v.outputDirectory, undefined);
  assert.ok(v.framework === undefined || v.framework === null);
});

test('the frontend still builds to dist', () => {
  const staticBuild = config().builds.find(b => b.use === '@vercel/static-build');
  assert.ok(staticBuild, 'expected a static-build entry');
  assert.equal(staticBuild.src, 'package.json');
  assert.equal(staticBuild.config?.distDir, 'dist');
  assert.equal(staticBuild.config?.buildCommand, 'npm run build');
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