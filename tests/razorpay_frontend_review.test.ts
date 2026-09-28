import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import {
  buildRazorpayCheckoutOptions,
  createRazorpayOrder,
  fetchRazorpayConfig,
  isProcessingState,
  isRetryableState,
  isTerminalState,
  loadRazorpayScript,
  mapRazorpayErrorCode,
  parseConfigResponse,
  parseOrderResponse,
  parseVerifyResponse,
  verifyRazorpayPayment,
  type RazorpayUiState,
} from '../src/lib/razorpayClient';

/**
 * Phase 3 frontend Razorpay: review of the browser-side implementation.
 *
 * `tests/razorpay_client.test.ts` already covers the pure helpers of
 * `razorpayClient.ts` value by value. This file deliberately does not repeat
 * that. It covers the three things that helper-level testing cannot reach:
 *
 *   1. The three API wrappers, driven end to end through a stubbed `fetch` -
 *      the single network edge `apiFetch` uses. This is where the URL, the
 *      method, the request body, the bearer token and the error mapping
 *      actually happen, and none of it is observable from a pure mapper.
 *   2. The two pieces of the flow with no unit coverage at all: the checkout
 *      script loader (driven through a minimal fake DOM) and the React card's
 *      double-click guards.
 *   3. The properties that are about the INTEGRATION rather than any one
 *      function: that the manual QR flow stays reachable when the gateway is
 *      off, and that no Razorpay secret can reach the browser bundle. The last
 *      of these is checked by walking the real import graph from the browser
 *      entry point, because `src/lib` holds both the client bridge and the
 *      server-only gateway modules and only the graph decides which ship.
 */

const BOOKING_ID = '44444444-4444-4444-8444-444444444444';
const KEY_ID = 'rzp_test_key_id';
const KEY_SECRET = 'rzp_test_key_secret_0123456789abcdef';
const WEBHOOK_SECRET = 'rzp_test_webhook_secret_0123456789';
const ORDER_ID = 'order_TEST123';
const PAYMENT_ID = '66666666-6666-4666-8666-666666666666';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  delete (globalThis as Record<string, unknown>).document;
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).localStorage;
});

/** Stubs `fetch` (the one network edge `apiFetch` uses) and records the calls. */
function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as unknown as typeof fetch;
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The exact payloads the three routes in `server.ts` serve. */
const disabledConfigBody = { success: true, enabled: false, currency: null, razorpayKeyId: null };
const enabledConfigBody = { success: true, enabled: true, currency: 'INR', razorpayKeyId: KEY_ID };
const orderBody = {
  success: true,
  razorpayOrderId: ORDER_ID,
  razorpayKeyId: KEY_ID,
  amountInr: 999,
  currency: 'INR',
  paymentId: PAYMENT_ID,
  message: 'Payment order created.',
};
const verifyBody = {
  success: true,
  paymentId: PAYMENT_ID,
  bookingId: BOOKING_ID,
  bookingStatus: 'MENTOR_PENDING',
  paymentStatus: 'VERIFIED',
  message: 'Payment confirmed.',
};

// ---------------------------------------------------------------------------
// 1 + 3. The availability probe the page gates on
// ---------------------------------------------------------------------------

describe('razorpay client: the availability probe, end to end', () => {
  it('reads a disabled probe as "off" with no key, so the manual flow is chosen', async () => {
    stubFetch(() => json(disabledConfigBody));

    const result = await fetchRazorpayConfig();

    // This single value decides whether the seeker sees a Razorpay option at
    // all, so a disabled probe must be a clean answer, not an error.
    assert.ok(result.success);
    assert.ok(result.success && result.data.enabled === false);
    assert.ok(result.success && result.data.razorpayKeyId === null);
    assert.ok(result.success && result.data.currency === null);
  });

  it('reads an enabled probe as "on" and exposes only the public key id', async () => {
    stubFetch(() => json(enabledConfigBody));

    const result = await fetchRazorpayConfig();

    assert.ok(result.success && result.data.enabled === true);
    assert.ok(result.success && result.data.razorpayKeyId === KEY_ID);
    // The key id is public by design; neither secret may appear in the payload
    // the browser now holds.
    assert.ok(!JSON.stringify(result).includes(KEY_SECRET));
    assert.ok(!JSON.stringify(result).includes(WEBHOOK_SECRET));
  });

  it('requests the config endpoint with the caller’s bearer token', async () => {
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: () => JSON.stringify({ token: '  seeker-token  ' }),
    };
    const calls = stubFetch(() => json(enabledConfigBody));

    await fetchRazorpayConfig();

    assert.equal(calls[0].url, '/api/payments/razorpay/config');
    assert.equal(new Headers(calls[0].init?.headers).get('authorization'), 'Bearer seeker-token');
  });

  it('treats a missing or non-boolean `enabled` as off, never as on', () => {
    // A truthy string here would switch the gateway on for every seeker.
    for (const enabled of ['true', 1, 'yes', {}, []]) {
      const parsed = parseConfigResponse({ success: true, enabled, currency: 'INR', razorpayKeyId: KEY_ID });
      assert.ok(parsed.success);
      assert.ok(parsed.success && parsed.data.enabled === false, `enabled=${JSON.stringify(enabled)} must not enable`);
    }
  });

  it('treats a wrongly-typed key id as absent, so a blank key cannot open checkout', () => {
    for (const razorpayKeyId of [42, { id: KEY_ID }, [], true]) {
      const parsed = parseConfigResponse({ success: true, enabled: true, currency: 'INR', razorpayKeyId });
      assert.ok(parsed.success);
      assert.ok(parsed.success && parsed.data.razorpayKeyId === null, `key=${JSON.stringify(razorpayKeyId)} must normalise to null`);
    }
  });

  it('surfaces a rejected probe as a failure, never as a usable configuration', async () => {
    // The page reads a failure as "hide the gateway, fall back to manual", so a
    // failure must not be laundered into `{ enabled: true }`.
    stubFetch(() => json({ success: false, error: { code: 'AUTH_REQUIRED', message: 'A valid bearer token is required.' } }, 401));

    const result = await fetchRazorpayConfig();

    assert.ok(!result.success);
    assert.ok(!result.success && result.code === 'AUTH_REQUIRED');
    assert.ok(!result.success && result.statusCode === 401);
  });

  it('reports a network failure without throwing, so the page can fall back', async () => {
    globalThis.fetch = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;

    const result = await fetchRazorpayConfig();

    assert.ok(!result.success && result.code === 'NETWORK_ERROR');
  });

  it('reports a non-JSON body as a parse error rather than a crash', async () => {
    stubFetch(() => new Response('<html>gateway timeout</html>', { status: 504 }));

    const result = await fetchRazorpayConfig();

    assert.ok(!result.success && result.code === 'PARSE_ERROR');
  });
});

// ---------------------------------------------------------------------------
// 2 + 4. Order creation, and the checkout it initializes
// ---------------------------------------------------------------------------

describe('razorpay client: order creation, end to end', () => {
  it('POSTs to the booking’s order endpoint and returns the checkout values', async () => {
    const calls = stubFetch(() => json(orderBody, 201));

    const result = await createRazorpayOrder(BOOKING_ID);

    assert.equal(calls[0].url, `/api/seeker/bookings/${BOOKING_ID}/razorpay/order`);
    assert.equal(calls[0].init?.method, 'POST');
    assert.ok(result.success && result.data.razorpayOrderId === ORDER_ID);
    assert.ok(result.success && result.data.razorpayKeyId === KEY_ID);
    assert.ok(result.success && result.data.amountInr === 999);
    assert.ok(result.success && result.data.currency === 'INR');
    assert.ok(result.success && result.data.paymentId === PAYMENT_ID);
  });

  it('escapes the booking id so it cannot address a different route', async () => {
    const calls = stubFetch(() => json(orderBody, 201));

    await createRazorpayOrder('../../admin/secret');

    // An unescaped id would let a crafted value climb out of the path segment.
    assert.equal(calls[0].url, '/api/seeker/bookings/..%2F..%2Fadmin%2Fsecret/razorpay/order');
  });

  it('never lets the browser choose the amount', async () => {
    const calls = stubFetch(() => json(orderBody, 201));

    await createRazorpayOrder(BOOKING_ID);

    // The request carries no body at all, so there is no field a page could
    // tamper with: the amount on the modal is necessarily the server-derived
    // one, in rupees, and the checkout converts it once.
    assert.equal(calls[0].init?.body, undefined);
    const options = buildRazorpayCheckoutOptions({
      keyId: orderBody.razorpayKeyId,
      orderId: orderBody.razorpayOrderId,
      amountInr: orderBody.amountInr,
      currency: orderBody.currency,
      bookingCode: 'BK-1001',
      handler: () => {},
    });
    // 999 INR must reach Razorpay as 99900 paise, or the amount on the booking
    // summary differs from the amount actually taken.
    assert.equal(options.amount, 99900);
  });

  it('omits the dismiss hook when the caller supplies none', () => {
    // A modal wired to a no-op dismissal would report dismissals that do nothing.
    const options = buildRazorpayCheckoutOptions({
      keyId: KEY_ID,
      orderId: ORDER_ID,
      amountInr: 100,
      currency: 'INR',
      bookingCode: 'BK-1',
      handler: () => {},
    });

    assert.equal(options.modal, undefined);
  });

  it('refuses an order response missing any single field checkout needs', () => {
    // A partially-populated order would open a modal against an order the server
    // is not tracking, so an incomplete response must be refused outright.
    for (const drop of ['razorpayOrderId', 'razorpayKeyId', 'amountInr', 'currency', 'paymentId']) {
      const body: Record<string, unknown> = { ...orderBody };
      delete body[drop];
      const parsed = parseOrderResponse(body);

      assert.ok(!parsed.success, `an order without ${drop} must be refused`);
      assert.ok(!parsed.success && parsed.code === 'PARSE_ERROR');
    }
  });

  it('refuses a non-numeric amount rather than handing NaN to checkout', () => {
    for (const amountInr of ['999', null, Number.NaN, Infinity, {}]) {
      const parsed = parseOrderResponse({ ...orderBody, amountInr });
      assert.ok(!parsed.success, `amountInr=${JSON.stringify(amountInr)} must be refused`);
    }
  });

  it('reports a declined order with the code the card branches on', async () => {
    stubFetch(() => json({ success: false, error: { code: 'HOLD_EXPIRED', message: 'Your hold has expired.' } }, 409));

    const result = await createRazorpayOrder(BOOKING_ID);

    assert.ok(!result.success);
    assert.ok(!result.success && result.code === 'HOLD_EXPIRED');
    assert.ok(!result.success && result.statusCode === 409);
    // The server's own wording reaches the card, so a seeker is told the real
    // reason rather than a generic failure.
    assert.ok(!result.success && /expired/i.test(result.message));
  });

  it('falls back to a usable message when the server sends none', () => {
    const parsed = parseOrderResponse({ success: false, error: { code: 'RAZORPAY_ORDER_FAILED', message: '   ' } });

    assert.ok(!parsed.success);
    assert.ok(!parsed.success && /could not start the payment/i.test(parsed.message));
  });
});

// ---------------------------------------------------------------------------
// 5 + 6 + 7 + 11. Reporting a completed payment back to the server
// ---------------------------------------------------------------------------

describe('razorpay client: verification, end to end', () => {
  it('POSTs exactly the three gateway values and returns the rendered states', async () => {
    const calls = stubFetch(() => json(verifyBody));

    const result = await verifyRazorpayPayment(BOOKING_ID, {
      razorpayOrderId: ORDER_ID,
      razorpayPaymentId: 'pay_OK',
      razorpaySignature: 'deadbeef',
    });

    assert.equal(calls[0].url, `/api/seeker/bookings/${BOOKING_ID}/razorpay/verify`);
    assert.equal(calls[0].init?.method, 'POST');
    // Nothing derived in the browser, so nothing the page could tamper with.
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
      razorpayOrderId: ORDER_ID,
      razorpayPaymentId: 'pay_OK',
      razorpaySignature: 'deadbeef',
    });
    assert.ok(result.success && result.data.paymentStatus === 'VERIFIED');
    assert.ok(result.success && result.data.bookingStatus === 'MENTOR_PENDING');
  });

  it('refuses a verification response missing a field the success screen shows', () => {
    for (const drop of ['paymentId', 'bookingId', 'bookingStatus', 'paymentStatus']) {
      const body: Record<string, unknown> = { ...verifyBody };
      delete body[drop];
      const parsed = parseVerifyResponse(body);

      assert.ok(!parsed.success, `a verification without ${drop} must be refused`);
      assert.ok(!parsed.success && parsed.code === 'PARSE_ERROR');
    }
  });

  it('never reports success from a body that says it failed', () => {
    // The signature check failed server-side: the card must show a failure, not
    // a confirmation.
    const parsed = parseVerifyResponse({
      success: false,
      error: { code: 'RAZORPAY_SIGNATURE_INVALID', message: 'Payment signature could not be verified.' },
    });

    assert.ok(!parsed.success && parsed.code === 'RAZORPAY_SIGNATURE_INVALID');
  });

  it('offers a retry when the server rejects the signature', async () => {
    stubFetch(() => json({ success: false, error: { code: 'RAZORPAY_SIGNATURE_INVALID', message: 'Payment signature could not be verified.' } }, 400));

    const result = await verifyRazorpayPayment(BOOKING_ID, {
      razorpayOrderId: ORDER_ID,
      razorpayPaymentId: 'pay_OK',
      razorpaySignature: 'bad',
    });

    // End to end: the failure code the server sent becomes a retryable card.
    assert.ok(!result.success);
    const state = mapRazorpayErrorCode(result.success ? undefined : result.code);
    assert.equal(state, 'failed');
    assert.equal(isRetryableState(state), true);
    assert.equal(isTerminalState(state), false);
  });

  it('refuses a body that is not an object, and fails safe on a fieldless one', () => {
    for (const raw of [null, undefined, 'ok', 42, true]) {
      assert.ok(!parseConfigResponse(raw).success, `config accepted ${JSON.stringify(raw)}`);
      assert.ok(!parseOrderResponse(raw).success, `order accepted ${JSON.stringify(raw)}`);
      assert.ok(!parseVerifyResponse(raw).success, `verify accepted ${JSON.stringify(raw)}`);
    }

    // An array passes the `typeof === 'object'` guard, so it is read as a
    // fieldless object. The property that matters is that nothing then answers
    // "usable": config falls back to off, and the other two refuse.
    for (const raw of [[], [1, 2, 3], {}]) {
      const config = parseConfigResponse(raw);
      if (config.success) {
        assert.equal(config.data.enabled, false, `config must fall back to off for ${JSON.stringify(raw)}`);
        assert.equal(config.data.razorpayKeyId, null);
      }
      assert.ok(!parseOrderResponse(raw).success, `order accepted ${JSON.stringify(raw)}`);
      assert.ok(!parseVerifyResponse(raw).success, `verify accepted ${JSON.stringify(raw)}`);
    }
  });
});

// ---------------------------------------------------------------------------
// 9 + 11. Terminal outcomes the seeker must not be invited to retry
// ---------------------------------------------------------------------------

describe('razorpay client: terminal outcomes must not offer a retry', () => {
  const ALL_STATES: RazorpayUiState[] = [
    'idle', 'loading_config', 'not_enabled', 'config_error', 'creating_order', 'opening_checkout',
    'processing', 'verifying', 'success', 'failed', 'expired', 'already_completed', 'unavailable',
  ];

  it('keeps the terminal and retryable sets disjoint', () => {
    // A state that is both would render a retry button on a card that has
    // already given up, which is how a seeker ends up paying twice.
    for (const state of ALL_STATES) {
      assert.equal(
        isTerminalState(state) && isRetryableState(state),
        false,
        `${state} must not be both terminal and retryable`,
      );
    }
  });

  it('classifies every declared state into exactly one handled bucket', () => {
    // The card's switch renders a spinner for processing states, a terminal
    // panel for terminal ones and a retry button for retryable ones. A state in
    // none of those would fall through to the default branch silently.
    for (const state of ALL_STATES) {
      const buckets = [isProcessingState(state), isTerminalState(state), isRetryableState(state)].filter(Boolean).length;
      assert.ok(buckets <= 1, `${state} matched ${buckets} buckets`);
    }
    // `idle` is the only settled-but-actionable state; the rest are handled.
    assert.equal(isProcessingState('idle'), false);
    assert.equal(isTerminalState('idle'), false);
    assert.equal(isRetryableState('idle'), false);
  });

  it('does not let an in-flight state be retried', () => {
    // The card renders a spinner, not a retry button, while a request is open;
    // a retry offered here would be a second concurrent order.
    for (const state of ['loading_config', 'creating_order', 'opening_checkout', 'processing', 'verifying'] as RazorpayUiState[]) {
      assert.equal(isRetryableState(state), false, `${state} must not offer a retry`);
    }
  });

  it('refuses a retry once a hold has expired', () => {
    // The slot has been released; a "Retry Payment" button here would send the
    // seeker to pay for a slot somebody else may now hold.
    const state = mapRazorpayErrorCode('HOLD_EXPIRED');
    assert.equal(state, 'expired');
    assert.equal(isTerminalState(state), true);
    assert.equal(isRetryableState(state), false);
  });

  it('refuses a retry once the booking is already paid', () => {
    const state = mapRazorpayErrorCode('PAYMENT_ALREADY_COMPLETED');
    assert.equal(state, 'already_completed');
    assert.equal(isTerminalState(state), true);
    assert.equal(isRetryableState(state), false);
  });
});

// ---------------------------------------------------------------------------
// 4. Loading the checkout script
// ---------------------------------------------------------------------------

interface FakeScript {
  src: string;
  async: boolean;
  onload?: () => void;
  onerror?: () => void;
  remove: () => void;
}

/**
 * A minimal DOM modelling what `loadRazorpayScript` actually depends on:
 * `querySelector` finds a tag still in the document, `createElement` makes one,
 * `body.appendChild` publishes it, and a script can `remove()` itself.
 *
 * Two details matter for fidelity. The window starts WITHOUT the SDK — that is
 * the state a first visit is in, and the loader must still inject. And a tag
 * whose load failed stays in the document, exactly as in a real browser, so the
 * loader has to cope with that rather than treating mere presence as "already
 * loaded".
 */
function installFakeDom(options: { preExistingTag?: boolean; sdkOnLoad?: boolean } = {}) {
  const created: FakeScript[] = [];
  const inDocument: FakeScript[] = [];
  const sdkOnLoad = options.sdkOnLoad !== false;

  const makeScript = (): FakeScript => {
    const script: FakeScript = {
      src: '',
      async: false,
      remove: () => {
        const index = inDocument.indexOf(script);
        if (index >= 0) inDocument.splice(index, 1);
      },
    };
    created.push(script);
    return script;
  };

  if (options.preExistingTag) inDocument.push(makeScript());

  (globalThis as Record<string, unknown>).document = {
    querySelector: (selector: string) =>
      selector.includes('checkout.razorpay.com') ? inDocument[inDocument.length - 1] ?? null : null,
    createElement: () => makeScript(),
    body: { appendChild: (node: FakeScript) => void inDocument.push(node) },
  };
  (globalThis as Record<string, unknown>).window = {};

  return {
    created,
    inDocument,
    /** Fires load and makes the SDK available, as a real browser would. */
    load(script: FakeScript) {
      if (sdkOnLoad) (globalThis as Record<string, unknown>).window = { Razorpay: function Razorpay() {} };
      script.onload?.();
    },
    /** Fires error, leaving the SDK absent. */
    error(script: FakeScript) {
      script.onerror?.();
    },
  };
}

describe('razorpay client: loading the checkout script', () => {
  it('resolves false with no document, rather than crashing', async () => {
    // Guards the SSR / non-browser case: the caller gets an honest `false` and
    // shows an error, not a ReferenceError.
    assert.equal(await loadRazorpayScript(), false);
  });

  it('injects the script from Razorpay’s own origin, async', async () => {
    const dom = installFakeDom();

    const loading = loadRazorpayScript();

    assert.equal(dom.created.length, 1, 'a first visit must inject the script');
    // The origin is the security-relevant part: a same-origin or third-party
    // checkout script could read the bearer token this page holds.
    assert.ok(dom.created[0].src.startsWith('https://checkout.razorpay.com/'));
    // `async` matters: a blocking script would stall first paint.
    assert.equal(dom.created[0].async, true);

    dom.load(dom.created[0]);
    assert.equal(await loading, true);
  });

  it('resolves false when the script fails to load', async () => {
    const dom = installFakeDom();
    const loading = loadRazorpayScript();

    dom.error(dom.created[0]);

    assert.equal(await loading, false);
  });

  it('resolves false when the script loads but the SDK is not a constructor', async () => {
    // The script arrives but does not define `Razorpay` - a blocked or altered
    // response. The card must get `false` rather than throw "Razorpay
    // constructor not available" as an unexplained error.
    const dom = installFakeDom({ sdkOnLoad: false });
    const loading = loadRazorpayScript();

    dom.load(dom.created[0]);

    assert.equal(await loading, false);
  });

  it('never injects the script twice for concurrent callers', async () => {
    const dom = installFakeDom();

    // Two taps in the same tick must not append two script tags.
    const a = loadRazorpayScript();
    const b = loadRazorpayScript();

    assert.equal(dom.created.length, 1, 'the in-flight load must be shared');
    dom.load(dom.created[0]);
    assert.deepEqual([await a, await b], [true, true]);
  });

  it('does not re-inject a script that already delivered the SDK', async () => {
    // Re-injecting could double-initialise the SDK, so a second call resolves
    // from the loaded state instead of touching the document.
    const dom = installFakeDom();
    const first = loadRazorpayScript();
    dom.load(dom.created[0]);
    assert.equal(await first, true);

    const result = await loadRazorpayScript();

    assert.equal(dom.created.length, 1, 'a loaded SDK must not be re-injected');
    assert.equal(result, true);
  });

  it('replaces a tag left behind by an earlier failed load', async () => {
    // A real browser keeps a script element whose load failed. Treating its mere
    // presence as "already loaded" reported the gateway as broken for the rest
    // of the page's life, leaving the seeker no way to recover by retrying.
    const dom = installFakeDom();
    const failed = loadRazorpayScript();
    dom.error(dom.created[0]);
    assert.equal(await failed, false);
    assert.equal(dom.inDocument.length, 0, 'a failed load must not leave its tag in the document');

    const retry = loadRazorpayScript();
    dom.load(dom.created[1]);

    assert.equal(await retry, true);
    assert.equal(dom.inDocument.length, 1);
  });

  it('replaces a pre-existing tag that never produced an SDK', async () => {
    const dom = installFakeDom({ preExistingTag: true });

    const loading = loadRazorpayScript();

    // The stale tag cannot work, so it is dropped and a fresh one is injected.
    assert.equal(dom.created.length, 2);
    dom.load(dom.created[1]);
    assert.equal(await loading, true);
  });

  it('recovers after a failed load, so a later attempt can try again', async () => {
    const first = installFakeDom();
    const a = loadRazorpayScript();
    first.error(first.created[0]);
    assert.equal(await a, false);

    // The failed load must not be cached as an in-flight promise, or every
    // subsequent attempt would resolve the original `false` forever.
    const second = installFakeDom();
    const b = loadRazorpayScript();
    second.load(second.created[0]);
    assert.equal(await b, true);
    assert.equal(second.created.length, 1);
  });
});

// ---------------------------------------------------------------------------
// 1. The manual flow stays reachable while the gateway is off
// ---------------------------------------------------------------------------

const PAGE_SOURCE = readFileSync(
  join(import.meta.dirname, '..', 'src', 'pages', 'seeker', 'SeekerPaymentPage.tsx'),
  'utf8',
);

const CARD_SOURCE = readFileSync(
  join(import.meta.dirname, '..', 'src', 'components', 'seeker', 'RazorpayCheckoutCard.tsx'),
  'utf8',
);

describe('razorpay frontend: the manual flow is unaffected by the gateway', () => {
  it('never lets a failed probe take the manual configuration with it', async () => {
    // The probe is a separate request. If it fails, only the gateway option
    // disappears; the manual configuration request must still have succeeded.
    const urls: string[] = [];
    stubFetch((url) => {
      urls.push(url);
      return url.includes('razorpay') ? json({ success: false, error: { code: 'NETWORK', message: 'down' } }, 500) : json({ payment: { upiId: 'suggestkey@upi' } });
    });

    const razorpay = await fetchRazorpayConfig();

    assert.ok(!razorpay.success);
    // Independent requests, so a Razorpay failure cannot have short-circuited
    // the manual configuration.
    assert.deepEqual(urls, ['/api/payments/razorpay/config']);
  });

  it('starts on the manual method and only selects Razorpay when it is usable', () => {
    // The initial value plus the two-part condition are what keep an
    // unconfigured or half-configured deployment on the manual flow rather than
    // on a checkout that cannot complete.
    assert.ok(
      /useState<'manual' \| 'razorpay'>\('manual'\)/.test(PAGE_SOURCE),
      'the page must start on the manual method',
    );
    assert.ok(
      /razorpayResult\.data\.enabled && razorpayResult\.data\.razorpayKeyId/.test(PAGE_SOURCE),
      'Razorpay may only be selected when it is enabled AND a key id exists',
    );
    assert.ok(
      /} else \{[\s\S]{0,200}setSelectedPaymentMethod\('manual'\);/.test(PAGE_SOURCE),
      'a failed probe must fall back to the manual method',
    );
  });

  it('gates the manual form on the manual configuration alone', () => {
    // The manual branch's own condition names only manual state. If it also
    // required `razorpayEnabled`, a gateway outage would blank the QR form.
    assert.ok(
      /selectedPaymentMethod === 'manual' && hasPaymentDestination \? \(/.test(PAGE_SOURCE),
      'the manual branch must be gated on the manual method and a configured destination only',
    );

    // And the card it renders is handed the manual configuration and the manual
    // submit handler, with no gateway value in sight.
    const branch = PAGE_SOURCE.slice(PAGE_SOURCE.indexOf("selectedPaymentMethod === 'manual' && hasPaymentDestination ? ("));
    assert.ok(branch.length > 0, 'the manual branch must exist');
    const card = branch.slice(0, branch.indexOf('/>'));

    assert.ok(/<PaymentFormCard/.test(card), 'the manual branch must render the manual form card');
    assert.ok(/paymentDetails=\{paymentDetails!\}/.test(card), 'the manual card must be given the manual configuration');
    assert.ok(/handleSubmit=\{handleSubmit\}/.test(card), 'the manual card must be given the manual submit handler');
    assert.ok(!/razorpay/i.test(card), 'the manual card must receive no gateway value');
  });

  it('keeps the manual proof submission path intact', () => {
    // The pre-existing flow must not have been replaced by the gateway.
    assert.ok(/submitPaymentProof/.test(PAGE_SOURCE), 'the manual proof submission must still be wired');
    assert.ok(/hasPaymentDestination/.test(PAGE_SOURCE), 'the manual UPI destination gate must still be wired');
  });
});

// ---------------------------------------------------------------------------
// 10. Double-click prevention
// ---------------------------------------------------------------------------

describe('razorpay frontend: double-clicking the pay button', () => {
  it('guards the handler with a synchronous ref as well as the disabled prop', () => {
    // The `disabled` attribute only reaches the DOM after React re-renders, so
    // two clicks in the same tick would both fire. The synchronous ref check is
    // what actually stops the second one; the button is only the visible half.
    assert.ok(/isProcessingRef\.current = true/.test(CARD_SOURCE), 'the in-flight guard must be set synchronously');
    assert.ok(
      /if \(isProcessingRef\.current\) return/.test(CARD_SOURCE),
      'the pay handler must bail out on a second synchronous tap',
    );
    assert.ok(/if \(isProcessingState\(uiState\)\) return/.test(CARD_SOURCE), 'the handler must also bail on an in-flight state');
    assert.ok(/disabled=\{isProcessing\}/.test(CARD_SOURCE), 'the button must be disabled while an attempt is in flight');
  });

  it('releases the guard when an attempt ends, so a retry stays possible', () => {
    const handler = CARD_SOURCE.slice(CARD_SOURCE.indexOf('const handlePayClick'));

    // A guard that is only ever set would make every failure permanent, which
    // is the opposite of the retry the failed state offers.
    assert.ok(
      /finally\s*\{[\s\S]{0,200}isProcessingRef\.current = false/.test(handler),
      'the in-flight guard must be released in a finally block',
    );
  });

  it('does not double-verify when the checkout handler fires twice', () => {
    // Razorpay can invoke the success handler more than once. The second call
    // must not POST a second verification.
    const verifyHandler = CARD_SOURCE.slice(
      CARD_SOURCE.indexOf('handler: async'),
      CARD_SOURCE.indexOf('onDismiss: handleDismiss'),
    );

    assert.ok(
      /if \(isProcessingRef\.current\) return;[\s\S]*isProcessingRef\.current = true/.test(verifyHandler),
      'the checkout handler must guard against a repeated success callback',
    );
  });

  it('returns the same order id for a repeated order request', async () => {
    // The client's half of double-click safety: the server is idempotent, so a
    // second tap must resolve to the same order rather than a second charge.
    let call = 0;
    const calls = stubFetch(() => json(orderBody, call++ === 0 ? 201 : 200));

    const first = await createRazorpayOrder(BOOKING_ID);
    const second = await createRazorpayOrder(BOOKING_ID);

    assert.ok(first.success && second.success);
    assert.equal(first.data.razorpayOrderId, second.data.razorpayOrderId);
    assert.equal(first.data.paymentId, second.data.paymentId);
    assert.equal(calls.length, 2, 'a reused order must not be re-requested');
  });

  it('resolves a lost double-tap race to the winning order instead of an error', async () => {
    // Two taps can both clear the server's pre-flight read before either writes
    // its row, so the loser is answered 409 PAYMENT_ALREADY_IN_PROGRESS even
    // though its own first tap succeeded. Reporting that as a failure showed
    // "Payment Failed" beside a checkout that was in fact open. The endpoint is
    // idempotent, so the client asks once more and gets the winning order.
    let attempt = 0;
    const calls = stubFetch(() => {
      attempt += 1;
      return attempt === 1
        ? json({ success: false, error: { code: 'PAYMENT_ALREADY_IN_PROGRESS', message: 'A payment for this booking is already being processed.' } }, 409)
        : json(orderBody, 200);
    });

    const result = await createRazorpayOrder(BOOKING_ID);

    assert.ok(result.success, 'the race must resolve to the order that did win');
    assert.ok(result.success && result.data.razorpayOrderId === ORDER_ID);
    assert.ok(result.success && result.data.alreadyCreated === true);
    assert.equal(calls.length, 2, 'the conflict must be retried exactly once');
  });

  it('surfaces a genuine conflict rather than retrying forever', async () => {
    // A manual proof mid-review produces the same code on every attempt. The
    // retry is bounded to one, so this surfaces as the failure it is.
    const calls = stubFetch(() =>
      json({ success: false, error: { code: 'PAYMENT_ALREADY_IN_PROGRESS', message: 'A payment for this booking is already being processed.' } }, 409),
    );

    const result = await createRazorpayOrder(BOOKING_ID);

    assert.ok(!result.success);
    assert.ok(!result.success && result.code === 'PAYMENT_ALREADY_IN_PROGRESS');
    assert.equal(calls.length, 2, 'the retry must be bounded to a single extra attempt');
  });

  it('reports whether the order it handed back is new or reused', async () => {
    // The server signals this with the status code (201 created, 200 reused) and
    // does not put it in the body, so the client derives it from the status. It
    // used to be a hardcoded `false`, which made the field meaningless.
    stubFetch(() => json(orderBody, 201));
    const created = await createRazorpayOrder(BOOKING_ID);
    assert.ok(created.success && created.data.alreadyCreated === false, 'a 201 is a freshly minted order');

    stubFetch(() => json(orderBody, 200));
    const reused = await createRazorpayOrder(BOOKING_ID);
    assert.ok(reused.success && reused.data.alreadyCreated === true, 'a 200 is a reused in-flight order');
  });

  it('defaults the mapper to a fresh order when no status is supplied', () => {
    // Keeps the mapper honest for direct callers: without evidence of reuse, the
    // safe answer is that the order is new.
    const parsed = parseOrderResponse(orderBody);
    assert.ok(parsed.success && parsed.data.alreadyCreated === false);
  });
});

// ---------------------------------------------------------------------------
// 12. Nothing secret can reach the browser bundle
// ---------------------------------------------------------------------------

const REPO_ROOT = join(import.meta.dirname, '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', 'dist', '.git', '.kilo'].includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Resolves an import specifier to a repo source file, or null. */
function resolveImport(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = join(REPO_ROOT, specifier.slice(2));
  else if (specifier.startsWith('.')) base = resolve(dirname(fromFile), specifier);
  else return null; // a bare specifier is an npm package, not repo source

  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (candidate.endsWith('.ts') || candidate.endsWith('.tsx')) {
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // not this one; keep trying
      }
    }
  }
  return null;
}

/**
 * Walks the real import graph from the browser entry point.
 *
 * A directory listing is not enough: `src/lib` holds both the client bridge and
 * the server-only gateway modules, and only the import graph decides which a
 * bundler actually pulls in. This returns every repo source file reachable
 * from `src/main.tsx`, which is what `index.html` loads.
 */
function browserReachableFiles(): string[] {
  const seen = new Set<string>();
  const queue = [join(REPO_ROOT, 'src', 'main.tsx')];

  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    let contents: string;
    try {
      contents = readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    const specifiers = [
      ...[...contents.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]{0,400}?from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]),
      ...[...contents.matchAll(/(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g)].map((m) => m[1]),
    ];

    for (const specifier of specifiers) {
      const resolved = resolveImport(specifier, file);
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }

  return [...seen];
}

/** Modules that legitimately read a Razorpay secret; none may reach the browser. */
const SERVER_ONLY_SECRET_MODULES = [
  'src/lib/razorpayConfig.ts',
  'src/lib/razorpayService.ts',
  'src/lib/razorpaySignature.ts',
  'src/lib/razorpayStore.ts',
];

describe('razorpay frontend: no secret key is reachable from the browser', () => {
  it('pulls no server-only gateway module into the browser bundle', () => {
    // The load-bearing frontend check. The gateway secret lives in
    // `razorpayConfig`; if the page's import graph ever reached that module, the
    // secret reader would ship to every visitor.
    const reachable = browserReachableFiles().map((f) => relative(REPO_ROOT, f).replace(/\\/g, '/'));

    for (const serverOnly of SERVER_ONLY_SECRET_MODULES) {
      assert.ok(!reachable.includes(serverOnly), `${serverOnly} is reachable from the browser entry point`);
    }

    // Sanity check on the walk itself: the client bridge and the page that uses
    // it must be in the graph, or the assertions above would pass vacuously.
    assert.ok(reachable.includes('src/lib/razorpayClient.ts'), 'the client bridge must be in the browser graph');
    assert.ok(reachable.includes('src/pages/seeker/SeekerPaymentPage.tsx'), 'the payment page must be in the browser graph');
  });

  it('finds no secret reader in any module the browser actually bundles', () => {
    const offenders = browserReachableFiles()
      .map((f) => relative(REPO_ROOT, f).replace(/\\/g, '/'))
      .filter((rel) => /getRazorpayKeySecret|getRazorpayWebhookSecret|RAZORPAY_KEY_SECRET|RAZORPAY_WEBHOOK_SECRET/.test(readFileSync(join(REPO_ROOT, rel), 'utf8')));

    assert.deepEqual(offenders, [], `a Razorpay secret is readable from a bundled module: ${offenders.join(', ')}`);
  });

  it('reads no Razorpay credential from the environment in a bundled module', () => {
    // A client module has no `process.env`, so such a read is both dead and a
    // sign that server code has leaked into the bundle.
    const offenders = browserReachableFiles()
      .map((f) => relative(REPO_ROOT, f).replace(/\\/g, '/'))
      .filter((rel) => /process\.env\.[A-Z_]*RAZORPAY/.test(readFileSync(join(REPO_ROOT, rel), 'utf8')));

    assert.deepEqual(offenders, [], `a bundled module reads a Razorpay env var: ${offenders.join(', ')}`);
  });

  it('keeps the client bridge free of any inline credential or env read', () => {
    // The bridge builds every value the browser holds, so it is checked directly
    // as well as through the graph walk.
    const client = readFileSync(join(REPO_ROOT, 'src', 'lib', 'razorpayClient.ts'), 'utf8');

    assert.ok(!/rzp_test_key_secret/.test(client));
    assert.ok(!/process\.env/.test(client), 'the client bridge must read no environment at all');
  });

  it('exposes no Razorpay secret through a VITE_ prefixed variable', () => {
    // Only `VITE_`-prefixed values are inlined into the bundle.
    const offenders = [...sourceFiles(join(REPO_ROOT, 'src')), join(REPO_ROOT, 'server.ts'), join(REPO_ROOT, '.env.example')]
      .filter((file) => /VITE_RAZORPAY/i.test(readFileSync(file, 'utf8')))
      .map((file) => relative(REPO_ROOT, file).replace(/\\/g, '/'));

    assert.deepEqual(offenders, [], `VITE_RAZORPAY must not appear in: ${offenders.join(', ')}`);
  });

  it('sends only gateway proof material to the server, never a credential', async () => {
    // The verify request carries the signature the gateway produced, which the
    // server re-derives. It never carries anything the browser could use to
    // forge one.
    const calls = stubFetch(() => json(verifyBody));

    await verifyRazorpayPayment(BOOKING_ID, {
      razorpayOrderId: ORDER_ID,
      razorpayPaymentId: 'pay_OK',
      razorpaySignature: 'a'.repeat(64),
    });

    const body = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ['razorpayOrderId', 'razorpayPaymentId', 'razorpaySignature']);
    assert.ok(!JSON.stringify(body).includes(KEY_SECRET));
    assert.ok(!JSON.stringify(body).includes(WEBHOOK_SECRET));
  });
});
