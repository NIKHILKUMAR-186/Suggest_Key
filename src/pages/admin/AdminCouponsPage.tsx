import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Percent, Plus, Tag } from 'lucide-react';

import { Badge } from '@/src/components/ui/Badge';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { apiFetch } from '@/src/lib/apiClient';
import { toUserMessage } from '@/src/lib/errorMessages';
import { formatInr } from '@/src/lib/seekerFormat';
import type { AdminCoupon, CouponDiscountType, CouponStatus } from '@/src/types/database';

/**
 * Admin coupon management.
 *
 * There is no "preview this discount" control, and that is deliberate: a coupon's
 * effect depends on a real booking's price at a real moment, so the only honest
 * preview is applying it to a booking. What this page shows instead is the
 * configuration an admin actually needs to reason about - the discount, the
 * targeting, the window and how much of the allowance is already claimed.
 *
 * Every write goes to the server, which validates, audits and owns the real row.
 */

type FilterKey = 'ALL' | CouponStatus;

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'ACTIVE', label: 'Active' },
  { key: 'INACTIVE', label: 'Inactive' },
  { key: 'ARCHIVED', label: 'Archived' },
];

const STATUS_VARIANT: Record<CouponStatus, 'success' | 'secondary' | 'outline'> = {
  ACTIVE: 'success',
  INACTIVE: 'secondary',
  ARCHIVED: 'outline',
};

/** Blank form. Every field the create schema accepts, and no others. */
const EMPTY_FORM = {
  code: '',
  description: '',
  discountType: 'PERCENTAGE' as CouponDiscountType,
  discountValue: '',
  maxDiscountInr: '',
  minOrderAmountInr: '',
  maxTotalUses: '',
  maxUsesPerUser: '',
  startsAt: '',
  expiresAt: '',
  segmentId: '',
};

type CouponForm = typeof EMPTY_FORM;

/**
 * An empty string means "no limit" for every optional numeric field, which is
 * exactly what the server schema turns into SQL NULL. The UI never sends an
 * empty string as a number.
 */
const toNullableNumber = (value: string): number | null =>
  value.trim() === '' ? null : Number(value);

export const AdminCouponsPage: React.FC = () => {
  const [coupons, setCoupons] = useState<AdminCoupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('ALL');

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CouponForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/admin/coupons');
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed to load coupons');
      setCoupons(data.coupons || []);
    } catch (err) {
      setError(toUserMessage(err, 'Failed to load coupons'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(
    () => (filter === 'ALL' ? coupons : coupons.filter((c) => c.status === filter)),
    [coupons, filter],
  );

  const setField = (key: keyof CouponForm, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const res = await apiFetch('/api/admin/coupons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: form.code.trim().toUpperCase(),
          description: form.description.trim() || null,
          discountType: form.discountType,
          // An empty value is not a discount of zero: it is a refused save.
          discountValue: Number(form.discountValue),
          maxDiscountInr: toNullableNumber(form.maxDiscountInr),
          minOrderAmountInr: form.minOrderAmountInr.trim() === '' ? 0 : Number(form.minOrderAmountInr),
          maxTotalUses: toNullableNumber(form.maxTotalUses),
          maxUsesPerUser: toNullableNumber(form.maxUsesPerUser),
          startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : undefined,
          expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
          segmentId: form.segmentId.trim() || null,
          mentorId: null,
          status: 'ACTIVE',
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setFormError(data?.error?.message || 'That coupon could not be created.');
        return;
      }
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
    } catch (err) {
      setFormError(toUserMessage(err, 'That coupon could not be created.'));
    } finally {
      setSaving(false);
    }
  };

  /**
   * Status is its own endpoint because the three transitions mean different
   * things operationally and each writes a distinct audit event.
   */
  const changeStatus = async (coupon: AdminCoupon, status: CouponStatus) => {
    setBusyId(coupon.id);
    try {
      const res = await apiFetch(`/api/admin/coupons/${coupon.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data?.error?.message || 'That coupon could not be updated.');
        return;
      }
      await load();
    } catch (err) {
      setError(toUserMessage(err, 'That coupon could not be updated.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-[var(--color-shell-border)] pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-shell-text)] sm:text-3xl">
            Coupons
          </h1>
          <p className="mt-1 text-xs text-[var(--color-shell-text-muted)]">
            Discount codes seekers enter at checkout. A reservation takes a place in the limit when
            they apply it, and becomes permanent when the payment is verified.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start">
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-[var(--color-shell-bg)] p-1 text-xs">
            {FILTERS.map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={filter === option.key}
                onClick={() => setFilter(option.key)}
                className={`cursor-pointer rounded-md px-2.5 py-1.5 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)] ${
                  filter === option.key
                    ? 'bg-[var(--color-shell-surface)] text-[var(--color-shell-primary)] shadow-xs'
                    : 'text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)]'
                }`}
              >
                {option.label}
                <span className="ml-1.5 opacity-60">
                  {option.key === 'ALL'
                    ? coupons.length
                    : coupons.filter((c) => c.status === option.key).length}
                </span>
              </button>
            ))}
          </div>

          <Button size="sm" variant="default" onClick={() => setShowForm((v) => !v)}>
            <Plus className="h-3.5 w-3.5" />
            <span>{showForm ? 'Cancel' : 'New coupon'}</span>
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-[var(--color-shell-error)]/35 bg-[var(--color-shell-error-soft)] px-4 py-3 text-xs text-[var(--color-shell-error)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {showForm && (
        <form onSubmit={create} className="space-y-4 rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Code"
              required
              value={form.code}
              onChange={(e) => setField('code', e.target.value.toUpperCase())}
              placeholder="FIRST_SESSION"
              maxLength={24}
              autoComplete="off"
              spellCheck={false}
              className="uppercase"
              helperText="4–24 letters, numbers or underscores."
            />
            <div className="space-y-1.5">
              <span className="block text-xs font-semibold text-[var(--color-shell-text)]">
                Discount type
              </span>
              <div className="flex gap-2">
                {(['PERCENTAGE', 'FIXED'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    aria-pressed={form.discountType === type}
                    onClick={() => setField('discountType', type)}
                    className={`h-12 flex-1 rounded-lg border text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[var(--color-shell-accent-soft)] ${
                      form.discountType === type
                        ? 'border-[var(--color-shell-accent)] bg-[var(--color-shell-accent-soft)] text-[var(--color-shell-accent)]'
                        : 'border-[var(--color-shell-border-strong)] text-[var(--color-shell-text-muted)] hover:bg-[var(--color-shell-bg)]'
                    }`}
                  >
                    {type === 'PERCENTAGE' ? 'Percentage' : 'Fixed amount'}
                  </button>
                ))}
              </div>
            </div>
            <Input
              label={form.discountType === 'PERCENTAGE' ? 'Percent off' : 'Rupees off'}
              required
              type="number"
              min={1}
              value={form.discountValue}
              onChange={(e) => setField('discountValue', e.target.value)}
              helperText={
                form.discountType === 'PERCENTAGE'
                  ? '1–100. A 100% discount is refused: a booking is never free.'
                  : 'Whole rupees taken off the session price.'
              }
            />
            <Input
              label="Maximum discount (₹)"
              type="number"
              min={1}
              value={form.maxDiscountInr}
              onChange={(e) => setField('maxDiscountInr', e.target.value)}
              disabled={form.discountType !== 'PERCENTAGE'}
              helperText={
                form.discountType === 'PERCENTAGE'
                  ? 'Optional ceiling on a percentage discount. Leave blank for no ceiling.'
                  : 'Only applies to a percentage discount.'
              }
            />
            <Input
              label="Minimum session price (₹)"
              type="number"
              min={0}
              value={form.minOrderAmountInr}
              onChange={(e) => setField('minOrderAmountInr', e.target.value)}
              placeholder="0"
              helperText="Leave blank for no minimum."
            />
            <Input
              label="Total uses"
              type="number"
              min={1}
              value={form.maxTotalUses}
              onChange={(e) => setField('maxTotalUses', e.target.value)}
              placeholder="Unlimited"
              helperText="Blank means unlimited. Reservations count, not only redemptions."
            />
            <Input
              label="Uses per seeker"
              type="number"
              min={1}
              value={form.maxUsesPerUser}
              onChange={(e) => setField('maxUsesPerUser', e.target.value)}
              placeholder="Unlimited"
            />
            <Input
              label="Segment ID"
              value={form.segmentId}
              onChange={(e) => setField('segmentId', e.target.value)}
              placeholder="All segments"
              helperText="Optional. Paste a segment id to limit this coupon to one segment."
            />
            <Input
              label="Starts at"
              type="datetime-local"
              value={form.startsAt}
              onChange={(e) => setField('startsAt', e.target.value)}
              helperText="Blank starts it immediately."
            />
            <Input
              label="Expires at"
              type="datetime-local"
              value={form.expiresAt}
              onChange={(e) => setField('expiresAt', e.target.value)}
              helperText="Blank means it never expires on its own."
            />
          </div>

          <Input
            label="Description"
            value={form.description}
            onChange={(e) => setField('description', e.target.value)}
            maxLength={300}
            helperText="Internal note. Seekers never see this."
          />

          {formError && (
            <p role="alert" className="text-xs font-medium text-[var(--color-shell-error)]">
              {formError}
            </p>
          )}

          <Button type="submit" disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Tag className="h-4 w-4" />}
            <span>{saving ? 'Creating…' : 'Create coupon'}</span>
          </Button>
        </form>
      )}

      <div className="overflow-hidden rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)]">
        {loading ? (
          <div className="p-8 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-[var(--color-shell-text-subtle)]" />
            <p className="mt-2 text-xs text-[var(--color-shell-text-muted)]">Loading coupons…</p>
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Percent}
            title="No coupons yet"
            description={
              filter === 'ALL'
                ? 'Create a discount code and seekers can enter it on the payment page.'
                : `No coupons are ${filter.toLowerCase()}.`
            }
          />
        ) : (
          <div className="table-scroll">
            <table className="w-full text-left text-xs text-[var(--color-shell-text-muted)]">
              <thead className="border-b border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] text-[11px] font-semibold uppercase tracking-wider text-[var(--color-shell-text)]">
                <tr>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Discount</th>
                  <th className="px-4 py-3">Targeting</th>
                  <th className="px-4 py-3">Claimed</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-shell-border)]">
                {filtered.map((coupon) => {
                  const claimed = coupon.reserved_count + coupon.redeemed_count;
                  return (
                    <tr key={coupon.id} className="transition-colors hover:bg-[var(--color-shell-bg)]">
                      <td className="px-4 py-3">
                        <span className="block font-mono font-bold text-[var(--color-shell-text)]">
                          {coupon.code}
                        </span>
                        {coupon.description && (
                          <span className="mt-0.5 block max-w-[240px] truncate text-[11px] text-[var(--color-shell-text-subtle)]">
                            {coupon.description}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-semibold text-[var(--color-shell-text)]">
                          {coupon.discount_type === 'PERCENTAGE'
                            ? `${coupon.discount_value}% off`
                            : `${formatInr(coupon.discount_value)} off`}
                        </span>
                        {coupon.discount_type === 'PERCENTAGE' && coupon.max_discount_inr && (
                          <span className="mt-0.5 block text-[11px] text-[var(--color-shell-text-subtle)]">
                            Max {formatInr(coupon.max_discount_inr)}
                          </span>
                        )}
                        {coupon.min_order_amount_inr > 0 && (
                          <span className="mt-0.5 block text-[11px] text-[var(--color-shell-text-subtle)]">
                            Min {formatInr(coupon.min_order_amount_inr)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[11px]">
                        {coupon.segment_id ? `Segment ${coupon.segment_id.slice(0, 8)}…` : null}
                        {coupon.mentor_id ? `Mentor ${coupon.mentor_id.slice(0, 8)}…` : null}
                        {!coupon.segment_id && !coupon.mentor_id && 'Everywhere'}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-semibold text-[var(--color-shell-text)]">
                          {claimed}
                          {coupon.max_total_uses ? ` / ${coupon.max_total_uses}` : ''}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-[var(--color-shell-text-subtle)]">
                          {coupon.redeemed_count} paid
                          {coupon.reserved_count > 0 ? `, ${coupon.reserved_count} pending` : ''}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={STATUS_VARIANT[coupon.status]} className="text-[10px]">
                          {coupon.status}
                        </Badge>
                        {coupon.expires_at && (
                          <span className="mt-1 block text-[11px] text-[var(--color-shell-text-subtle)]">
                            Until {new Date(coupon.expires_at).toLocaleDateString('en-IN')}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {coupon.status === 'ACTIVE' ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 py-1 text-xs"
                              disabled={busyId === coupon.id}
                              onClick={() => changeStatus(coupon, 'INACTIVE')}
                            >
                              Deactivate
                            </Button>
                          ) : coupon.status === 'INACTIVE' ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 py-1 text-xs"
                              disabled={busyId === coupon.id}
                              onClick={() => changeStatus(coupon, 'ACTIVE')}
                            >
                              Activate
                            </Button>
                          ) : null}
                          {coupon.status !== 'ARCHIVED' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 py-1 text-xs"
                              disabled={busyId === coupon.id}
                              onClick={() => changeStatus(coupon, 'ARCHIVED')}
                            >
                              Archive
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-[11px] text-[var(--color-shell-text-subtle)]">
        Archiving stops new bookings from using the coupon. A booking that already has it reserved
        keeps its discount and resolves it when that payment completes or is rejected.
      </p>
    </div>
  );
};
