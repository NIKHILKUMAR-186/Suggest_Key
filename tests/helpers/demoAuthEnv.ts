/**
 * Test-only demo auth configuration.
 *
 * `src/lib/supabaseServer.ts` reads `ENABLE_DEMO_PERSONAS` and
 * `DEMO_TOKEN_SECRET` once at module load, so they must be in place before
 * anything imports that module. ESM evaluates imports in source order, which is
 * why every demo-token test imports this file first.
 *
 * The values here are throwaway constants for the test process. They are never
 * a real deployment secret and they deliberately satisfy the production-grade
 * preconditions: explicit opt-in plus a 64-character externally supplied
 * signing secret.
 */
process.env.ENABLE_DEMO_PERSONAS = 'true';
process.env.DEMO_TOKEN_SECRET =
  'test-only-demo-signing-secret-4f8c1d2b9e7a6035f2c8b4a19d7e3f60c';

export {};
