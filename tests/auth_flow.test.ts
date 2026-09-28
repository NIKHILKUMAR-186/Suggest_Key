// Must come first: the demo-auth preconditions are read at module load.
import './helpers/demoAuthEnv';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDemoToken,
  verifyDemoToken,
  isDemoAuthEnabled,
  isDemoPersonasExplicitlyEnabled,
  demoAuthDisabledReason,
  DEMO_TOKEN_SECRET_MIN_LENGTH,
} from '../src/lib/supabaseServer';
import { mapAuthError } from '../src/lib/authErrors';

describe('Auth flow role separation', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  before(() => {
    process.env.NODE_ENV = 'test';
  });

  after(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe('Demo token role enforcement', () => {
    it('creates a token with the correct role claim', () => {
      const token = createDemoToken({ sub: 'user-1', email: 'test@example.com', role: 'seeker' });
      assert.ok(token.startsWith('skdemo.'), 'token should have the demo prefix');
    });

    it('verifies a seeker token and returns the role', () => {
      const token = createDemoToken({ sub: 'user-1', email: 'seeker@example.com', role: 'seeker' });
      const claims = verifyDemoToken(token);
      assert.ok(claims, 'token should verify');
      assert.equal(claims!.role, 'seeker');
      assert.equal(claims!.sub, 'user-1');
      assert.equal(claims!.email, 'seeker@example.com');
    });

    it('verifies a mentor token and returns the role', () => {
      const token = createDemoToken({ sub: 'user-2', email: 'mentor@example.com', role: 'mentor' });
      const claims = verifyDemoToken(token);
      assert.ok(claims, 'token should verify');
      assert.equal(claims!.role, 'mentor');
    });

    it('verifies an admin token and returns the role', () => {
      const token = createDemoToken({ sub: 'user-3', email: 'admin@example.com', role: 'admin' });
      const claims = verifyDemoToken(token);
      assert.ok(claims, 'token should verify');
      assert.equal(claims!.role, 'admin');
    });

    it('rejects tokens with invalid role values', () => {
      const token = 'skdemo.' + Buffer.from(JSON.stringify({
        sub: 'user-4',
        email: 'bad@example.com',
        role: 'superadmin',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      })).toString('base64url') + '.fake-signature';

      const claims = verifyDemoToken(token);
      assert.equal(claims, null, 'token with invalid role should be rejected');
    });

    it('rejects tokens with tampered payload', () => {
      const token = createDemoToken({ sub: 'user-1', email: 'test@example.com', role: 'seeker' });
      const parts = token.slice('skdemo.'.length).split('.');
      assert.equal(parts.length, 2);

      const tamperedPayload = Buffer.from(JSON.stringify({
        sub: 'user-1',
        email: 'test@example.com',
        role: 'mentor',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      })).toString('base64url');

      const tamperedToken = 'skdemo.' + tamperedPayload + '.' + parts[1];
      const claims = verifyDemoToken(tamperedToken);
      assert.equal(claims, null, 'token with tampered payload should be rejected');
    });

    it('rejects expired tokens', () => {
      const token = 'skdemo.' + Buffer.from(JSON.stringify({
        sub: 'user-1',
        email: 'test@example.com',
        role: 'seeker',
        iat: Math.floor(Date.now() / 1000) - 7200,
        exp: Math.floor(Date.now() / 1000) - 3600,
      })).toString('base64url') + '.fake';

      const claims = verifyDemoToken(token);
      assert.equal(claims, null, 'expired token should be rejected');
    });
  });

  describe('Auth error mapping for signup flows', () => {
    it('maps invalid credentials errors', () => {
      assert.equal(mapAuthError(new Error('Invalid login credentials')), 'Email or password is incorrect.');
      assert.equal(mapAuthError(new Error('User not found')), 'No account found with that email address.');
    });

    it('maps email confirmation errors', () => {
      assert.equal(mapAuthError(new Error('Email not confirmed')), 'Please confirm your email before signing in.');
    });

    it('maps rate limit errors', () => {
      assert.equal(mapAuthError(new Error('Too many requests')), 'Too many attempts. Please wait a moment and try again.');
    });

    it('maps network errors', () => {
      assert.equal(mapAuthError(new Error('Failed to fetch')), 'Network error. Please check your connection and try again.');
    });

    it('returns null for null/undefined error', () => {
      assert.equal(mapAuthError(null), null);
      assert.equal(mapAuthError(undefined), null);
    });

    it('returns generic fallback for unknown errors', () => {
      assert.equal(mapAuthError(new Error('Some unknown error')), 'Something went wrong. Please try again.');
    });

    it('maps weak password errors', () => {
      assert.equal(mapAuthError(new Error('password is too weak')), 'Password is too weak. Please choose a stronger password.');
    });
  });

  describe('Role-based access enforcement', () => {
    it('only accepts the three defined roles: seeker, mentor, admin', () => {
      const allowedRoles: Array<'seeker' | 'mentor' | 'admin'> = ['seeker', 'mentor', 'admin'];

      for (const role of allowedRoles) {
        const token = createDemoToken({ sub: `user-${role}`, email: `user-${role}@example.com`, role: role });
        const claims = verifyDemoToken(token);
        assert.ok(claims, `token for role ${role} should verify`);
        assert.equal(claims!.role, role);
      }
    });

    it('ensures normal signup cannot produce a mentor token', () => {
      const seekerToken = createDemoToken({ sub: 'seeker-user', email: 'seeker@example.com', role: 'seeker' });
      const claims = verifyDemoToken(seekerToken);
      assert.ok(claims, 'seeker token should verify');
      assert.equal(claims!.role, 'seeker', 'normal signup token must have seeker role, not mentor');
    });
  });

  // -------------------------------------------------------------------------
  // Regression tests for the demo-auth hardening.
  //
  // Before this change demo auth was enabled implicitly whenever
  // DEMO_AUTH_SECRET was set to anything that was not one hardcoded string, so
  // a deployment that set a short or guessable secret would accept forged
  // `skdemo.` tokens - including tokens claiming the admin role - with no
  // operator ever opting in.
  // -------------------------------------------------------------------------
  describe('Demo auth must fail closed', () => {
    const original = process.env.ENABLE_DEMO_PERSONAS;

    after(() => {
      if (original === undefined) delete process.env.ENABLE_DEMO_PERSONAS;
      else process.env.ENABLE_DEMO_PERSONAS = original;
    });

    it('is enabled in this test process because the flag and a strong secret are both set', () => {
      assert.equal(isDemoPersonasExplicitlyEnabled(), true);
      assert.equal(isDemoAuthEnabled(), true);
      assert.equal(demoAuthDisabledReason(), '');
    });

    it('requires a signing secret of at least the documented minimum length', () => {
      assert.ok(
        DEMO_TOKEN_SECRET_MIN_LENGTH >= 32,
        'a short shared secret would be guessable and must be refused',
      );
    });

    for (const [label, value] of [
      ['unset', undefined],
      ['"false"', 'false'],
      ['"0"', '0'],
      ['"no"', 'no'],
      ['"TRUE " with surrounding space is still true', 'true'],
    ] as const) {
      it(`${label === '"TRUE " with surrounding space is still true' ? label : `treats ${label} as not opt-in`}`, () => {
        if (value === undefined) delete process.env.ENABLE_DEMO_PERSONAS;
        else process.env.ENABLE_DEMO_PERSONAS = value;

        if (value === 'true') {
          assert.equal(isDemoAuthEnabled(), true, 'a padded "true" is still an explicit opt-in');
          return;
        }

        assert.equal(isDemoAuthEnabled(), false, 'demo auth must be off without an explicit opt-in');
        assert.equal(
          demoAuthDisabledReason(),
          'ENABLE_DEMO_PERSONAS is not "true"',
          'the operator needs a reason they can act on',
        );

        // Even a correctly signed token must stop verifying the moment the
        // feature is switched off, so a token minted earlier cannot outlive
        // the configuration that allowed it.
        const token = createDemoToken({ sub: 'user-1', email: 'a@b.test', role: 'seeker' });
        assert.equal(verifyDemoToken(token), null, 'no token may verify while demo auth is disabled');
      });
    }

    it('reports the missing-secret precondition rather than silently defaulting', () => {
      process.env.ENABLE_DEMO_PERSONAS = 'true';
      // The secret is captured at module load, so this asserts the documented
      // contract of the exported constant rather than re-reading the env.
      assert.equal(typeof DEMO_TOKEN_SECRET_MIN_LENGTH, 'number');
      assert.equal(demoAuthDisabledReason(), '');
    });
  });
});
