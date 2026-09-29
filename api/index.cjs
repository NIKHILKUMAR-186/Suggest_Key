/**
 * Suggest Key - Vercel serverless entrypoint.
 *
 * Vercel maps the `api/` directory to the `/api` route. All `/api/*` traffic is
 * rewritten here (see vercel.json) and the Express application performs its own
 * routing, so a single function serves the whole API surface.
 *
 * The application bundle is emitted to `.build/server.cjs` by the build script.
 * It lives OUTSIDE `dist` on purpose: `dist` is the published static
 * `outputDirectory`, so anything placed in it is downloadable by anyone. The
 * previous layout emitted `server.cjs` and `server.cjs.map` directly into
 * `dist`, which published the full backend source and its source map.
 *
 * `server.cjs` assigns `module.exports` synchronously at module scope, so this
 * require returns the Express app without waiting on any async startup.
 */
module.exports = require('../.build/server.cjs');
