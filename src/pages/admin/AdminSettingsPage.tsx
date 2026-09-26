import React from 'react';
import { ShieldCheck, CreditCard, Clock, QrCode, Lock } from 'lucide-react';
import { APP_CONFIG, HOLDOUT_MINUTES, SESSION_ACCESS_WINDOW_MINUTES, CANCELLATION_WINDOW_MINUTES, BOOKING_CUTOFF_MINUTES } from '@/src/config/app';

const hours = (ms: number) => ms / (60 * 60 * 1000);
const MEETING_LINK_DEADLINE_HOURS = hours(APP_CONFIG.MEETING_LINK_DEADLINE_MS);

/**
 * Read-only view of the platform configuration.
 *
 * The booking/payment rules below are enforced server-side and in the database,
 * so they are shown as the authoritative reference instead of being offered as
 * editable fields: an editable field that reports "saved" without persisting
 * anything is worse than no field at all. The values are read from
 * `APP_CONFIG`, the same module the booking engine uses, so this page can never
 * drift from the rules the platform actually enforces.
 */
export const AdminSettingsPage: React.FC = () => {
  const invariants = [
    {
      label: 'Slot Hold Duration',
      value: `${HOLDOUT_MINUTES} Minutes`,
      note: 'The atomic hold expires automatically if payment proof is not submitted in time.',
    },
    {
      label: 'Meeting Link Concealment',
      value: `T-${SESSION_ACCESS_WINDOW_MINUTES} Minutes Before Session`,
      note: 'The link is hidden from the seeker and the join control stays locked until this window opens.',
    },
    {
      label: 'Recommended Link Deadline',
      value: `${MEETING_LINK_DEADLINE_HOURS} Hours Before Session`,
      note: 'The platform records a missed deadline for audit. It does not cancel the session.',
    },
    {
      label: 'Booking Cut-off',
      value: `${BOOKING_CUTOFF_MINUTES} Minutes Before Start`,
      note: 'A slot stops being bookable inside this window.',
    },
    {
      label: 'Seeker Cancellation Policy',
      value: `≥ ${CANCELLATION_WINDOW_MINUTES} Minutes Prior`,
      note: `Cancellations inside ${CANCELLATION_WINDOW_MINUTES} minutes of the session start are locked.`,
    },
    {
      label: 'Default Timezone',
      value: APP_CONFIG.DEFAULT_TIMEZONE,
      note: 'Used when a user has not set a timezone of their own.',
    },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="border-b border-zinc-200 pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-950 sm:text-3xl">
          Platform Configuration
        </h1>
        <p className="mt-1 text-xs text-zinc-500">
          The booking, payment and session rules Suggest Key enforces, exactly as the
          platform currently applies them.
        </p>
      </div>

      {/* Core business rule invariants */}
      <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-5">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-100 pb-3">
          <div>
            <h2 className="text-sm font-bold text-zinc-950">Booking &amp; Session Rules</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Authoritative platform timings and locks.</p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-mono text-zinc-500 bg-zinc-100 px-2 py-0.5 rounded">
            <Lock className="h-3 w-3" aria-hidden="true" />
            Enforced by the server
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          {invariants.map((item) => (
            <div key={item.label} className="p-3 bg-zinc-50 rounded-lg border border-zinc-100 space-y-1">
              <span className="font-semibold text-zinc-900 block">{item.label}</span>
              <span className="text-zinc-600 break-words">{item.value}</span>
              <p className="text-[11px] text-zinc-400">{item.note}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Payment method */}
      <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-4">
        <div className="border-b border-zinc-100 pb-3">
          <h2 className="text-sm font-bold text-zinc-950 flex items-center gap-2">
            <QrCode className="h-4 w-4 text-zinc-700" />
            Payment Method
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            How sessions are paid for on the current build.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="p-3 bg-zinc-50 rounded-lg border border-zinc-100 space-y-1">
            <span className="font-semibold text-zinc-900 block">Collection method</span>
            <span className="text-zinc-600 break-words">
              Manual QR verification
            </span>
            <p className="text-[11px] text-zinc-400">
              The seeker pays to the platform account and uploads proof. An admin verifies
              the proof, which then advances the booking to mentor confirmation.
            </p>
          </div>
          <div className="p-3 bg-zinc-50 rounded-lg border border-zinc-100 space-y-1">
            <span className="font-semibold text-zinc-900 block">Currency</span>
            <span className="text-zinc-600">INR (₹) — Indian Rupee</span>
            <p className="text-[11px] text-zinc-400">
              All gig prices and booking amounts are stored in rupees.
            </p>
          </div>
        </div>

        <p className="flex items-start gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-[11px] text-zinc-500">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 mt-0.5 text-zinc-500" aria-hidden="true" />
          <span>
            The receiver UPI identifier and the payment instructions shown to seekers are
            held in the server environment, not in the browser, so they cannot be edited
            from this console. Update the deployment environment and restart the server
            to change them.
          </span>
        </p>
      </section>
    </div>
  );
};
