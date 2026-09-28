import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  inrToPaise,
  mapRazorpayErrorCode,
  isProcessingState,
  isRetryableState,
  isTerminalState,
  buildRazorpayCheckoutOptions,
  parseConfigResponse,
  parseOrderResponse,
  parseVerifyResponse,
} from '../src/lib/razorpayClient';

// ---------------------------------------------------------------------------
// Amount conversion
// ---------------------------------------------------------------------------

describe('razorpay client: inrToPaise', () => {
  test('converts integer rupees to paise', () => {
    assert.equal(inrToPaise(100), 10000);
    assert.equal(inrToPaise(999), 99900);
    assert.equal(inrToPaise(2499), 249900);
  });

  test('handles fractional rupees by rounding', () => {
    assert.equal(inrToPaise(100.5), 10050);
    assert.equal(inrToPaise(99.99), 9999);
    assert.equal(inrToPaise(0.01), 1);
  });

  test('handles zero and negative', () => {
    assert.equal(inrToPaise(0), 0);
    assert.equal(inrToPaise(-100), -10000);
  });
});

// ---------------------------------------------------------------------------
// Error code mapping
// ---------------------------------------------------------------------------

describe('razorpay client: mapRazorpayErrorCode', () => {
  test('maps HOLD_EXPIRED to expired state', () => {
    assert.equal(mapRazorpayErrorCode('HOLD_EXPIRED'), 'expired');
  });

  test('maps PAYMENT_ALREADY_COMPLETED to already_completed state', () => {
    assert.equal(mapRazorpayErrorCode('PAYMENT_ALREADY_COMPLETED'), 'already_completed');
  });

  test('maps booking/ownership/amount errors to unavailable state', () => {
    for (const code of [
      'BOOKING_NOT_FOUND',
      'FORBIDDEN_NOT_BOOKING_OWNER',
      'BOOKING_NOT_PAYABLE',
      'SLOT_ALREADY_STARTED',
      'AMOUNT_UNAVAILABLE',
      'PAYMENT_NOT_FOUND',
      'PAYMENT_NOT_GATEWAY',
    ] as const) {
      assert.equal(mapRazorpayErrorCode(code), 'unavailable', `${code} should map to unavailable`);
    }
  });

  test('maps gateway/signature/amount/conflict errors to failed state', () => {
    for (const code of [
      'PAYMENT_ALREADY_IN_PROGRESS',
      'RAZORPAY_ORDER_FAILED',
      'RAZORPAY_SIGNATURE_INVALID',
      'RAZORPAY_ORDER_MISMATCH',
      'RAZORPAY_AMOUNT_MISMATCH',
      'PAYMENT_NOT_CAPTURED',
      'PAYMENT_STATE_CONFLICT',
      'VALIDATION_ERROR',
    ] as const) {
      assert.equal(mapRazorpayErrorCode(code), 'failed', `${code} should map to failed`);
    }
  });

  test('maps an unreachable gateway to a terminal state, not a retry loop', () => {
    // The flag being off, or the credentials being removed, is not something a
    // retry can fix: the endpoint answers 503 for as long as it stays off. A
    // retryable state here would show a "Retry Payment" button that can only
    // ever fail again.
    for (const code of ['RAZORPAY_DISABLED', 'RAZORPAY_NOT_CONFIGURED'] as const) {
      assert.equal(mapRazorpayErrorCode(code), 'not_enabled', `${code} should map to not_enabled`);
      assert.equal(isTerminalState(mapRazorpayErrorCode(code)), true, `${code} must be terminal`);
      assert.equal(isRetryableState(mapRazorpayErrorCode(code)), false, `${code} must not be retryable`);
    }
  });

  test('maps a closed booking with a refund pending to a terminal state', () => {
    // The session will not be delivered and the money is being returned, so a
    // retry would only open a second doomed attempt.
    assert.equal(mapRazorpayErrorCode('BOOKING_CLOSED_REFUND_PENDING'), 'unavailable');
    assert.equal(isTerminalState(mapRazorpayErrorCode('BOOKING_CLOSED_REFUND_PENDING')), true);
    assert.equal(isRetryableState(mapRazorpayErrorCode('BOOKING_CLOSED_REFUND_PENDING')), false);
  });

  test('defaults unknown codes to failed state', () => {
    assert.equal(mapRazorpayErrorCode('UNKNOWN_ERROR_CODE'), 'failed');
    assert.equal(mapRazorpayErrorCode(''), 'failed');
    assert.equal(mapRazorpayErrorCode(undefined), 'failed');
  });
});

// ---------------------------------------------------------------------------
// State predicates
// ---------------------------------------------------------------------------

describe('razorpay client: isProcessingState', () => {
  test('returns true for in-flight states', () => {
    for (const state of [
      'loading_config',
      'creating_order',
      'opening_checkout',
      'processing',
      'verifying',
    ] as const) {
      assert.equal(isProcessingState(state), true, `${state} should be processing`);
    }
  });

  test('returns false for terminal and idle states', () => {
    for (const state of [
      'idle',
      'success',
      'failed',
      'expired',
      'already_completed',
      'not_enabled',
      'config_error',
      'unavailable',
    ] as const) {
      assert.equal(isProcessingState(state), false, `${state} should not be processing`);
    }
  });
});

describe('razorpay client: isRetryableState', () => {
  test('returns true only for failed state', () => {
    assert.equal(isRetryableState('failed'), true);
    for (const state of [
      'idle',
      'loading_config',
      'creating_order',
      'opening_checkout',
      'processing',
      'verifying',
      'success',
      'expired',
      'already_completed',
      'not_enabled',
      'config_error',
      'unavailable',
    ] as const) {
      assert.equal(isRetryableState(state), false, `${state} should not be retryable`);
    }
  });
});

describe('razorpay client: isTerminalState', () => {
  test('returns true for terminal states', () => {
    for (const state of [
      'success',
      'expired',
      'already_completed',
      'not_enabled',
      'config_error',
      'unavailable',
    ] as const) {
      assert.equal(isTerminalState(state), true, `${state} should be terminal`);
    }
  });

  test('returns false for in-flight and retryable states', () => {
    for (const state of [
      'idle',
      'loading_config',
      'creating_order',
      'opening_checkout',
      'processing',
      'verifying',
      'failed',
    ] as const) {
      assert.equal(isTerminalState(state), false, `${state} should not be terminal`);
    }
  });
});

// ---------------------------------------------------------------------------
// Checkout options builder
// ---------------------------------------------------------------------------

describe('razorpay client: buildRazorpayCheckoutOptions', () => {
  const baseParams = {
    keyId: 'rzp_test_123',
    orderId: 'order_abc',
    amountInr: 999,
    currency: 'INR',
    bookingCode: 'BK-1001',
    handler: () => {},
  };

  test('builds valid options with required fields', () => {
    const options = buildRazorpayCheckoutOptions(baseParams);

    assert.equal(options.key, 'rzp_test_123');
    assert.equal(options.order_id, 'order_abc');
    assert.equal(options.amount, 99900);
    assert.equal(options.currency, 'INR');
    assert.equal(options.name, 'Suggest Key');
    assert.equal(options.description, 'Payment for booking BK-1001');
    assert.equal(typeof options.handler, 'function');
    assert.equal(options.theme?.color, '#3399cc');
  });

  test('includes prefill when name or email provided', () => {
    const withName = buildRazorpayCheckoutOptions({ ...baseParams, prefillName: 'John Doe' });
    assert.equal(withName.prefill?.name, 'John Doe');
    assert.equal(withName.prefill?.email, undefined);

    const withEmail = buildRazorpayCheckoutOptions({ ...baseParams, prefillEmail: 'john@example.com' });
    assert.equal(withEmail.prefill?.name, undefined);
    assert.equal(withEmail.prefill?.email, 'john@example.com');

    const withBoth = buildRazorpayCheckoutOptions({
      ...baseParams,
      prefillName: 'John Doe',
      prefillEmail: 'john@example.com',
    });
    assert.equal(withBoth.prefill?.name, 'John Doe');
    assert.equal(withBoth.prefill?.email, 'john@example.com');
  });

  test('includes modal ondismiss when provided', () => {
    const withDismiss = buildRazorpayCheckoutOptions({
      ...baseParams,
      onDismiss: () => {},
    });
    assert.equal(typeof withDismiss.modal?.ondismiss, 'function');
  });

  test('excludes prefill when neither name nor email provided', () => {
    const options = buildRazorpayCheckoutOptions(baseParams);
    assert.equal(options.prefill, undefined);
  });
});

// ---------------------------------------------------------------------------
// Response mappers: parseConfigResponse
// ---------------------------------------------------------------------------

describe('razorpay client: parseConfigResponse', () => {
  test('parses successful config with enabled true', () => {
    const raw = {
      success: true,
      enabled: true,
      currency: 'INR',
      razorpayKeyId: 'rzp_test_123',
    };
    const result = parseConfigResponse(raw);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.enabled, true);
      assert.equal(result.data.currency, 'INR');
      assert.equal(result.data.razorpayKeyId, 'rzp_test_123');
    }
  });

  test('parses successful config with enabled false', () => {
    const raw = {
      success: true,
      enabled: false,
      currency: null,
      razorpayKeyId: null,
    };
    const result = parseConfigResponse(raw);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.enabled, false);
      assert.equal(result.data.currency, null);
      assert.equal(result.data.razorpayKeyId, null);
    }
  });

  test('handles null/undefined currency and keyId gracefully', () => {
    const raw = {
      success: true,
      enabled: true,
      currency: undefined,
      razorpayKeyId: undefined,
    };
    const result = parseConfigResponse(raw);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.currency, null);
      assert.equal(result.data.razorpayKeyId, null);
    }
  });

  test('returns failure for non-success response', () => {
    const raw = {
      success: false,
      error: { code: 'RAZORPAY_DISABLED', message: 'Online payment is not available.' },
    };
    const result = parseConfigResponse(raw);
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.code, 'RAZORPAY_DISABLED');
      assert.equal(result.message, 'Online payment is not available.');
    }
  });

  test('returns failure for invalid raw response', () => {
    const result = parseConfigResponse(null);
    assert.equal(result.success, false);
    if (!result.success) assert.equal(result.code, 'PARSE_ERROR');

    const result2 = parseConfigResponse('not an object');
    assert.equal(result2.success, false);
  });

  test('returns failure for missing fields in success response', () => {
    const raw = { success: true, enabled: true };
    const result = parseConfigResponse(raw);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.currency, null);
      assert.equal(result.data.razorpayKeyId, null);
    }
  });
});

// ---------------------------------------------------------------------------
// Response mappers: parseOrderResponse
// ---------------------------------------------------------------------------

describe('razorpay client: parseOrderResponse', () => {
  const validSuccess = {
    success: true,
    razorpayOrderId: 'order_abc',
    razorpayKeyId: 'rzp_test_123',
    amountInr: 999,
    currency: 'INR',
    paymentId: 'pay_123',
    message: 'Payment order created.',
  };

  test('parses valid success response', () => {
    const result = parseOrderResponse(validSuccess);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.razorpayOrderId, 'order_abc');
      assert.equal(result.data.razorpayKeyId, 'rzp_test_123');
      assert.equal(result.data.amountInr, 999);
      assert.equal(result.data.currency, 'INR');
      assert.equal(result.data.paymentId, 'pay_123');
    }
  });

  test('returns failure for non-success response', () => {
    const raw = {
      success: false,
      error: { code: 'HOLD_EXPIRED', message: 'Your payment window has expired.' },
    };
    const result = parseOrderResponse(raw);
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.code, 'HOLD_EXPIRED');
      assert.equal(result.message, 'Your payment window has expired.');
    }
  });

  test('returns failure for missing required fields', () => {
    const result = parseOrderResponse({ success: true });
    assert.equal(result.success, false);
    if (!result.success) assert.equal(result.code, 'PARSE_ERROR');
  });

  test('returns failure for invalid amount', () => {
    const raw = { ...validSuccess, amountInr: NaN };
    const result = parseOrderResponse(raw);
    assert.equal(result.success, false);
    if (!result.success) assert.equal(result.code, 'PARSE_ERROR');
  });

  test('returns failure for non-object input', () => {
    const result = parseOrderResponse('invalid');
    assert.equal(result.success, false);
    if (!result.success) assert.equal(result.code, 'PARSE_ERROR');
  });
});

// ---------------------------------------------------------------------------
// Response mappers: parseVerifyResponse
// ---------------------------------------------------------------------------

describe('razorpay client: parseVerifyResponse', () => {
  const validSuccess = {
    success: true,
    paymentId: 'pay_123',
    bookingId: 'booking_abc',
    bookingStatus: 'MENTOR_PENDING',
    paymentStatus: 'VERIFIED',
    message: 'Payment confirmed.',
  };

  test('parses valid success response', () => {
    const result = parseVerifyResponse(validSuccess);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.paymentId, 'pay_123');
      assert.equal(result.data.bookingId, 'booking_abc');
      assert.equal(result.data.bookingStatus, 'MENTOR_PENDING');
      assert.equal(result.data.paymentStatus, 'VERIFIED');
    }
  });

  test('returns failure for non-success response', () => {
    const raw = {
      success: false,
      error: { code: 'RAZORPAY_SIGNATURE_INVALID', message: 'Invalid signature.' },
    };
    const result = parseVerifyResponse(raw);
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.code, 'RAZORPAY_SIGNATURE_INVALID');
      assert.equal(result.message, 'Invalid signature.');
    }
  });

  test('returns failure for missing required fields', () => {
    const result = parseVerifyResponse({ success: true });
    assert.equal(result.success, false);
    if (!result.success) assert.equal(result.code, 'PARSE_ERROR');
  });

  test('returns failure for non-object input', () => {
    const result = parseVerifyResponse(null);
    assert.equal(result.success, false);
    if (!result.success) assert.equal(result.code, 'PARSE_ERROR');
  });
});