/**
 * Suggest Key - Vercel serverless entrypoint.
 *
 * Vercel maps the `api/` directory to the `/api` route. All `/api/*` traffic is
 * rewritten here (see vercel.json) and the Express application performs its own
 * routing, so a single function serves the whole API surface.
 *
 * The application bundle is emitted to `api/_build/server.cjs` by the build
 * script. It must live INSIDE `api/`, not in `.build/` at the repository root.
 * Vercel packages a function from the `require()` graph reachable from its
 * entrypoint, filtered by .gitignore/.vercelignore. The previous layout pointed
 * at `../.build/server.cjs`, which is both outside the function directory and
 * matched by the `.build/` rule in .gitignore, so the tracer dropped it and no
 * `api` function was emitted at all. Every /api/* request then failed to match
 * a function, the `/api/:path*` -> `/api` rewrite had no resolvable destination,
 * and routing fell through to the SPA fallback `/:path*` -> /index.html. The
 * dashboard then received HTML where it expected JSON and failed to parse it.
 *
 * Consequences of this layout, which must be preserved:
 *
 *   - `api/_build/` MUST NOT be added to .gitignore, or the bundle is dropped
 *     from the function package again and the failure returns silently.
 *   - The `_` prefix is what stops Vercel turning the bundle into a second
 *     route. Vercel ignores files beginning with `_`, `.`, or ending in `.d.ts`
 *     when creating functions, so exactly one route (`/api`) is produced.
 *
 * The bundle deliberately stays out of `dist`, which is Vercel's published
 * static `outputDirectory`: anything placed in it is downloadable by anyone.
 * The earlier layout emitted `server.cjs` and `server.cjs.map` directly into
 * `dist`, which published the full backend source and its source map. The
 * `scripts/verify-dist.mjs` build gate enforces that.
 *
 * `server.cjs` assigns `module.exports` synchronously at module scope, and
 * `startServer()` contains no top-level `await`, so every route is registered
 * during module evaluation. This require therefore returns a fully routed
 * Express app without waiting on any async startup.
 */
module.exports = require('./_build/server.cjs');
