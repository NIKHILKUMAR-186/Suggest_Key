/**
 * ADMIN COLOUR CONTROLS.
 *
 * Native picker plus hex input, with a live swatch that previews exactly what
 * a seeker will see. Every value is validated with the SAME
 * `sanitizeSegmentColor` the renderer uses, so a preview can never show a
 * colour the seeker page would reject.
 *
 * There is deliberately no per-slug palette anywhere in this file. The theme
 * is whatever the admin picks, which is what lets a brand-new segment get its
 * identity without a code change.
 */

import React from 'react';
import { AlertCircle } from 'lucide-react';
import { sanitizeSegmentColor } from '@/src/lib/segmentExperience';
import { cn } from '@/src/lib/utils';

export interface AdminColorControlsProps {
  values: Record<string, string>;
  onChange: (field: string, value: string) => void;
  className?: string;
}

interface FieldSpec {
  key: string;
  label: string;
  hint: string;
}

const FIELDS: FieldSpec[] = [
  { key: 'accent', label: 'Accent', hint: 'Buttons, active chips, highlights.' },
  { key: 'accentSoft', label: 'Accent soft', hint: 'Tinted card and chip backgrounds.' },
  { key: 'accentSecondary', label: 'Secondary accent', hint: 'Supporting gradient stop.' },
  { key: 'heroTint', label: 'Hero tint', hint: 'The wash behind the hero content.' },
  { key: 'gradientStart', label: 'Gradient start', hint: 'Left end of the hero gradient.' },
  { key: 'gradientEnd', label: 'Gradient end', hint: 'Right end of the hero gradient.' },
];

export const AdminColorControls: React.FC<AdminColorControlsProps> = ({
  values,
  onChange,
  className,
}) => {
  return (
    <div className={cn('space-y-3', className)}>
      {FIELDS.map((field) => {
        const raw = values[field.key] ?? '';
        const safe = sanitizeSegmentColor(raw);
        const isInvalid = raw.trim().length > 0 && !safe;

        return (
          <div key={field.key}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label
                htmlFor={`color-${field.key}`}
                className="text-xs font-semibold text-zinc-700"
              >
                {field.label}
              </label>
              {safe && (
                <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                  <span
                    className="h-4 w-4 rounded ring-1 ring-zinc-200"
                    style={{ background: safe }}
                    aria-hidden="true"
                  />
                  <code>{safe}</code>
                </span>
              )}
            </div>

            <p className="mt-0.5 text-[11px] text-zinc-500">{field.hint}</p>

            <div className="mt-1.5 flex items-center gap-2">
              {/* The native picker. Disabled when the text is not a valid hex
                  so the two controls can never disagree. */}
              <input
                type="color"
                value={safe ?? '#000000'}
                disabled={!safe}
                onChange={(e) => onChange(field.key, e.target.value)}
                aria-label={`${field.label} colour picker`}
                className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-zinc-200 bg-white p-1 disabled:cursor-not-allowed disabled:opacity-40"
              />
              <input
                id={`color-${field.key}`}
                type="text"
                value={raw}
                spellCheck={false}
                placeholder="#0d9488"
                onChange={(e) => onChange(field.key, e.target.value)}
                aria-invalid={isInvalid}
                className={cn(
                  'min-h-[40px] flex-1 rounded-lg border px-3 font-mono text-sm uppercase',
                  isInvalid ? 'border-red-400 bg-red-50' : 'border-zinc-200 bg-white',
                )}
              />
            </div>

            {isInvalid && (
              <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-red-600">
                <AlertCircle className="h-3 w-3" aria-hidden="true" />
                Use a 6-digit hex colour, for example #0d9488.
              </p>
            )}
          </div>
        );
      })}

      <div>
        <label htmlFor="color-textMode" className="text-xs font-semibold text-zinc-700">
          Text mode
        </label>
        <p className="mt-0.5 text-[11px] text-zinc-500">
          How text is chosen on top of the accent. Auto picks the readable option.
        </p>
        <select
          id="color-textMode"
          value={values.textMode ?? 'auto'}
          onChange={(e) => onChange('textMode', e.target.value)}
          className="mt-1.5 min-h-[40px] w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm"
        >
          <option value="auto">Auto</option>
          <option value="light">Light text</option>
          <option value="dark">Dark text</option>
        </select>
      </div>
    </div>
  );
};

export default AdminColorControls;