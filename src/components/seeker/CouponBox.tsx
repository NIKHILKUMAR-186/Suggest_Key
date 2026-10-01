import React, { useState } from 'react';
import { Tag, X } from 'lucide-react';

import { applyCouponToBooking, removeCouponFromBooking } from '@/src/lib/couponService';
import { formatInr } from '@/src/lib/seekerFormat';
import { cn } from '@/src/lib/utils';
import { InlineNotice, SectionCard } from '@/src/components/booking/StatePanel';
import { TONE_TEXT } from '@/src/components/booking/tokens';

export interface CouponBoxProps {
  bookingId: string;
  bookingCode: string;
  /** Server-owned pricing. The box reads it and never computes it. */
  couponCode: string | null;
  discountAmountInr: number;
  amountInr: number;
  /**
   * Whether a coupon may still be changed. False once a payment is in flight or
   * the booking has moved on - the server refuses anyway, and hiding the input
   * is the honest version of that.
   */
  editable: boolean;
  /** Called with the server's pricing so the page can refresh its amount. */
  onPricingChange: (pricing: {
    amount_inr: number;
    discount_amount_inr: number;
    coupon_code: string | null;
  }) => void;
  className?: string;
}

/**
 * The seeker's coupon field on the payment page.
 *
 * Deliberately thin. It sends a code, renders whatever the server says, and
 * displays no discount arithmetic of its own - there is no local "you save
 * X" calculation to disagree with the amount that will actually be charged.
 *
 * Only an APPLIED coupon is shown. There is no "available coupons" list: the
 * platform has no public coupon catalogue surface, and inventing one would mean
 * shipping codes to every visitor.
 */
export const CouponBox: React.FC<CouponBoxProps> = ({
  bookingId,
  bookingCode,
  couponCode,
  discountAmountInr,
  amountInr,
  editable,
  onPricingChange,
  className,
}) => {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;

    setBusy(true);
    setError(null);
    const result = await applyCouponToBooking(bookingId, trimmed);
    setBusy(false);

    if (!result.success || !result.booking) {
      setError(result.error?.message ?? 'That coupon could not be applied.');
      return;
    }
    setCode('');
    onPricingChange(result.booking);
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    const result = await removeCouponFromBooking(bookingId);
    setBusy(false);

    if (!result.success || !result.booking) {
      setError(result.error?.message ?? 'That coupon could not be removed.');
      return;
    }
    onPricingChange(result.booking);
  };

  const applied = Boolean(couponCode) && discountAmountInr > 0;

  return (
    <SectionCard
      title="Coupon"
      description={`Discounts are applied to booking ${bookingCode} before you pay.`}
      icon={Tag}
      className={className}
    >
      {applied ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold text-[var(--color-shell-text)]">
                {couponCode}
              </p>
              <p className="mt-0.5 text-[12px] text-[var(--color-shell-text-muted)]">
                {formatInr(discountAmountInr)} off &middot; you pay {formatInr(amountInr)}
              </p>
            </div>
            {editable && (
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className={cn('btn-ghost shrink-0', busy && 'opacity-60')}
                aria-label={`Remove coupon ${couponCode}`}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                Remove
              </button>
            )}
          </div>

          {!editable && (
            <InlineNotice tone="neutral" title="Applied">
              This discount is locked in. It can no longer be changed now that your payment has
              started.
            </InlineNotice>
          )}
        </div>
      ) : editable ? (
        <form onSubmit={apply} className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <label htmlFor="coupon-code" className="sr-only">
              Coupon code
            </label>
            <input
              id="coupon-code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={busy}
              placeholder="Enter code"
              autoComplete="off"
              spellCheck={false}
              aria-describedby={error ? 'coupon-error' : undefined}
              className="min-w-0 flex-1 rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] px-3.5 py-2.5 text-[14px] uppercase text-[var(--color-shell-text)] placeholder:normal-case placeholder:text-[var(--color-shell-text-subtle)] focus:border-[var(--color-shell-text-subtle)] focus:outline-none disabled:opacity-60"
            />
            <button type="submit" disabled={busy || !code.trim()} className="btn-secondary shrink-0">
              {busy ? 'Applying…' : 'Apply'}
            </button>
          </div>

          {error && (
            <p id="coupon-error" role="alert" className={cn('text-[12.5px]', TONE_TEXT.danger)}>
              {error}
            </p>
          )}
        </form>
      ) : (
        <p className="text-[12.5px] text-[var(--color-shell-text-subtle)]">
          Coupons cannot be changed at this stage of the booking.
        </p>
      )}
    </SectionCard>
  );
};
