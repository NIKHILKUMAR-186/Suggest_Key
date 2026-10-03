/**
 * THE SEGMENT EXPERIENCE CMS.
 *
 * Replaces the old flat, form-only experience tab. The structure follows how
 * an admin actually thinks: each section is a card, sections are grouped into
 * tabs, each section can be switched off without losing its content, and the
 * whole thing can be previewed as a seeker before saving.
 *
 * The important architectural constraint:
 *
 *   THE PREVIEW IS THE SAME RENDERER.
 *
 * `AdminExperiencePreview` imports the very same `SegmentExperienceRenderer`
 * the live seeker page uses, and it reads this component''s in-memory draft.
 * So an admin is looking at the real page, with unsaved changes, rather than a
 * second UI written to approximate it.
 *
 * SAVE STATES are explicit and honest. "Saved" appears ONLY after the server
 * confirms, and any edit after a successful save moves the state straight back
 * to "Unsaved changes", so the badge can never lie about what is stored.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  Eye,
  Image as ImageIcon,
  Loader2,
  Save,
  Trash2,
  Plus,
  Upload,
} from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { AdminColorControls } from '@/src/pages/admin/AdminColorControls';
import { AdminSegmentTopicManager } from '@/src/pages/admin/AdminSegmentTopicManager';
import {
  AdminExperiencePreview,
  type PreviewViewport,
} from '@/src/pages/admin/AdminExperiencePreview';
import { apiFetch } from '@/src/lib/apiClient';
import { useToast } from '@/src/context/ToastContext';
import { toUserMessage } from '@/src/lib/errorMessages';
import { sanitizeSegmentColor } from '@/src/lib/segmentExperience';
import { SEGMENT_SECTION_KEYS, type SegmentSectionKey } from '@/src/lib/segmentExperience';
import {
  fetchSegmentTopics,
  type SegmentTopicView,
} from '@/src/lib/segmentTopics';
import { cn } from '@/src/lib/utils';

/** Explicit save states. `saved` exists only between a confirmed save and the next edit. */
type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

type TabKey = 'branding' | 'content' | 'topics' | 'preview';

/** Human labels for the section registry, in the order an admin meets them. */
const SECTION_LABELS: Record<SegmentSectionKey, string> = {
  hero: 'Hero',
  topics: 'Topic bar',
  quickHelp: 'Quick help',
  mentors: 'Mentor marketplace',
  journey: 'Journey',
  benefits: 'Benefits',
  guides: 'Guides',
  stories: 'Stories',
  faq: 'FAQ',
  cta: 'Call to action',
};

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'branding', label: 'Branding' },
  { key: 'content', label: 'Content' },
  { key: 'topics', label: 'Topics' },
  { key: 'preview', label: 'Preview' },
];

export interface AdminSegmentExperienceEditorProps {
  segmentId: string;
  segmentName: string;
  segmentSlug: string;
}

/**
 * Read a JSON error body without handing an HTML page to a JSON caller.
 *
 * A validation failure carries `fields`, a map of failing path to message. The
 * flat `message` alone ("Enter a valid URL.") leaves an admin with a config of
 * a dozen fields and no idea which one to fix, so the first failing path is
 * prefixed onto the message: "cta.buttonUrl: Enter a valid URL: ...".
 */
async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    const message = body?.error?.message;
    if (!message) return fallback;
    const field = Object.keys(body?.error?.fields || {})[0];
    return field ? `${field}: ${message}` : message;
  } catch {
    return fallback;
  }
}

export const AdminSegmentExperienceEditor: React.FC<AdminSegmentExperienceEditorProps> = ({
  segmentId,
  segmentName,
  segmentSlug,
}) => {
  const toast = useToast();

  // The DRAFT is the single source of truth while editing. The preview, the
  // dirty check and the save all read it, so they can never disagree.
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [storedJson, setStoredJson] = useState<string>('{}');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('branding');
  const [previewViewport, setPreviewViewport] = useState<PreviewViewport>('desktop');
  const [topics, setTopics] = useState<SegmentTopicView[]>([]);
  const [isUploading, setIsUploading] = useState<boolean>(false);

  const draftJson = useMemo(() => JSON.stringify(draft), [draft]);
  const isDirty = draftJson !== storedJson;

  /** Every edit moves the state to "dirty" and clears a stale "saved". */
  const patch = useCallback((updater: (current: Record<string, any>) => Record<string, any>) => {
    setDraft((current) => updater(current));
    setSaveState('dirty');
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/admin/segments/${segmentId}/experience`);
        if (!res.ok) throw new Error(await readApiError(res, 'Failed to load experience config'));
        const data = await res.json();
        if (!data.success) throw new Error(data.error?.message || 'Failed to load experience config');
        if (cancelled) return;
        const config = data.segment?.experience_config || {};
        setDraft(config);
        setStoredJson(JSON.stringify(config));
        setSaveState('idle');
      } catch (err: any) {
        if (cancelled) return;
        setLoadError(toUserMessage(err, 'Failed to load experience config'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [segmentId]);

  // Topics live in their own table, so the preview reads them separately.
  const loadTopics = useCallback(async () => {
    const { topics: rows } = await fetchSegmentTopics(segmentSlug);
    setTopics(rows);
  }, [segmentSlug]);

  useEffect(() => {
    void loadTopics();
  }, [loadTopics]);

  const handleSave = async () => {
    setSaveState('saving');
    try {
      const res = await apiFetch(`/api/admin/segments/${segmentId}/experience`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: draftJson,
      });
      if (!res.ok) throw new Error(await readApiError(res, 'Failed to save experience config'));
      const data = await res.json();
      if (!data.success) throw new Error(await readApiError(res, 'Failed to save experience config'));

      // "Saved" is only ever set from a confirmed server response.
      const confirmed = data.segment?.experience_config ?? draft;
      setDraft(confirmed);
      setStoredJson(JSON.stringify(confirmed));
      setSaveState('saved');
      toast.success('Segment experience saved.');
    } catch (err: any) {
      setSaveState('error');
      toast.error(toUserMessage(err, 'Failed to save experience config'));
    }
  };

  // -- hero image ----------------------------------------------------------
  // The admin uploads a real file to the existing `segment-hero` bucket; the
  // configuration stores only the resulting path. No base64 is ever persisted.
  const handleUploadHero = async (file: File) => {
    if (!file) return;
    if (file.size === 0) {
      toast.error('Please choose a valid image larger than 0 bytes.');
      return;
    }
    const allowedHeroMimeTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    if (!allowedHeroMimeTypes.includes(file.type.toLowerCase())) {
      toast.error('Upload a PNG, JPEG, WebP or GIF image.');
      return;
    }
    setIsUploading(true);
    try {
      const signRes = await apiFetch(`/api/admin/segments/${segmentId}/hero-upload-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: file.type, fileSize: file.size }),
      });
      if (!signRes.ok) throw new Error(await readApiError(signRes, 'Failed to prepare upload'));
      const signData = await signRes.json();
      if (!signData.success) throw new Error(signData.error?.message || 'Failed to prepare upload');
      if (!signData.publicUrl) throw new Error('The upload slot response was incomplete.');

      const uploadRes = await fetch(signData.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type, 'x-upsert': 'true' },
        body: file,
      });
      if (!uploadRes.ok) throw new Error('The image upload failed. Please try again.');

      patch((current) => ({
        ...current,
        branding: { ...(current.branding || {}), heroImageUrl: signData.publicUrl },
      }));
      toast.success('Hero image added. Save to publish it.');
    } catch (err: any) {
      toast.error(toUserMessage(err, 'Failed to upload the hero image'));
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoveHero = async () => {
    setIsUploading(true);
    try {
      const res = await apiFetch(`/api/admin/segments/${segmentId}/hero-image`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await readApiError(res, 'Failed to remove the hero image'));
      patch((current) => {
        const branding = { ...(current.branding || {}) };
        delete branding.heroImageUrl;
        return { ...current, branding };
      });
      toast.success('Hero image removed.');
    } catch (err: any) {
      toast.error(toUserMessage(err, 'Failed to remove the hero image'));
    } finally {
      setIsUploading(false);
    }
  };

  const setBranding = (key: string, value: unknown) =>
    patch((current) => ({ ...current, branding: { ...(current.branding || {}), [key]: value } }));

  const isSectionEnabled = (key: SegmentSectionKey): boolean =>
    (draft.sections || {})[key]?.enabled !== false;

  const toggleSection = (key: SegmentSectionKey) => {
    const next = !isSectionEnabled(key);
    patch((current) => ({
      ...current,
      sections: { ...(current.sections || {}), [key]: { enabled: next } },
    }));
  };

  const setList = (key: string, value: any[]) => patch((current) => ({ ...current, [key]: value }));

  return (
    <div className="space-y-5">
      {/* Save state bar -------------------------------------------------- */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div aria-live="polite">
          {loadError ? (
            <p className="flex items-center gap-2 text-xs font-semibold text-red-600">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              {loadError}
            </p>
          ) : saveState === 'error' ? (
            <p className="flex items-center gap-2 text-xs font-semibold text-red-600">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              Could not save. Your changes are still here.
            </p>
          ) : saveState === 'saved' && !isDirty ? (
            <p className="flex items-center gap-2 text-xs font-semibold text-emerald-700">
              <Check className="h-4 w-4" aria-hidden="true" />
              Saved
            </p>
          ) : isDirty ? (
            <p className="flex items-center gap-2 text-xs font-semibold text-amber-700">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              Unsaved changes
            </p>
          ) : (
            <p className="text-xs text-zinc-500">No changes to save.</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setActiveTab('preview')}
            className="text-xs"
          >
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            Preview as seeker
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={savingExperienceDisabled(saveState, isDirty)}
          >
            {saveState === 'saving' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {saveState === 'saving' ? 'Saving' : 'Save experience'}
          </Button>
        </div>
      </div>

      {/* Tabs ------------------------------------------------------------- */}
      <div className="flex flex-wrap gap-1.5 border-b border-zinc-200" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'min-h-[40px] rounded-t-lg border-b-2 px-4 text-xs font-semibold transition-colors',
              activeTab === tab.key
                ? 'border-zinc-900 text-zinc-900'
                : 'border-transparent text-zinc-500 hover:text-zinc-800',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'branding' && (
        <div className="space-y-5">
          <SectionCard
            title="Hero"
            enabled={isSectionEnabled('hero')}
            onToggle={() => toggleSection('hero')}
          >
            <Input
              label="Eyebrow"
              value={draft.branding?.eyebrow ?? ''}
              onChange={(e) => setBranding('eyebrow', e.target.value)}
              placeholder="Career mentoring"
            />
            <Input
              label="Headline"
              value={draft.branding?.heroHeadline ?? ''}
              onChange={(e) => setBranding('heroHeadline', e.target.value)}
              placeholder="Make the career decision with someone who has made it"
            />
            <Input
              label="Supporting description"
              value={draft.branding?.heroSubheadline ?? ''}
              onChange={(e) => setBranding('heroSubheadline', e.target.value)}
            />
          </SectionCard>

          <SectionCard
            title="Hero image"
            enabled={isSectionEnabled('hero')}
            onToggle={undefined}
          >
            {draft.branding?.heroImageUrl ? (
              <div className="space-y-3">
                <img
                  // src={draft.branding.heroImageUrl}
                  alt={draft.branding?.heroImageAlt || ''}
                  className="h-40 w-full rounded-3xl object-cover ring-1 ring-zinc-900"
                />
                <Input
                  label="Alt text"
                  value={draft.branding?.heroImageAlt ?? ''}
                  onChange={(e) => setBranding('heroImageAlt', e.target.value)}
                  placeholder="Describe what the image shows"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleRemoveHero}
                  disabled={isUploading}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Remove image
                </Button>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-center">
                <ImageIcon className="mx-auto h-6 w-6 text-zinc-400" aria-hidden="true" />
                <p className="mt-2 text-xs text-zinc-500">
                  No image yet. Without one the seeker page shows a neutral brand panel — it
                  never shows a fabricated illustration.
                </p>
              </div>
            )}

            <label className="inline-flex min-h-[40px] cursor-pointer items-center gap-2 rounded-lg border border-zinc-200 px-3 text-xs font-semibold hover:bg-zinc-50">
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              {isUploading ? 'Uploading...' : 'Upload image'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="sr-only"
                disabled={isUploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleUploadHero(file);
                  e.target.value = '';
                }}
              />
            </label>
          </SectionCard>

          <SectionCard
            title="Colours"
            enabled
            onToggle={undefined}
          >
            <AdminColorControls
              values={{ ...(draft.branding || {}) }}
              onChange={(field, value) => setBranding(field, value)}
            />
            <p className="text-[11px] text-zinc-500">
              These tint this segment only. The Suggest Key header keeps the brand palette.
            </p>
          </SectionCard>

          <SectionCard
            title="Call to action"
            enabled={isSectionEnabled('cta')}
            onToggle={() => toggleSection('cta')}
          >
            <Input
              label="Title"
              value={draft.cta?.title ?? ''}
              onChange={(e) => patch((c) => ({ ...c, cta: { ...(c.cta || {}), title: e.target.value } }))}
            />
            <Input
              label="Description"
              value={draft.cta?.description ?? ''}
              onChange={(e) =>
                patch((c) => ({ ...c, cta: { ...(c.cta || {}), description: e.target.value } }))
              }
            />
            <Input
              label="Button text"
              value={draft.cta?.buttonText ?? draft.cta?.text ?? ''}
              onChange={(e) =>
                patch((c) => ({ ...c, cta: { ...(c.cta || {}), buttonText: e.target.value } }))
              }
            />
            <Input
              label="Button URL"
              value={draft.cta?.buttonUrl ?? draft.cta?.url ?? ''}
              onChange={(e) =>
                patch((c) => ({ ...c, cta: { ...(c.cta || {}), buttonUrl: e.target.value } }))
              }
              placeholder="/mentors"
            />
          </SectionCard>
        </div>
      )}

      {activeTab === 'content' && (
        <div className="space-y-5">
          <ItemListEditor
            title="Quick help"
            sectionKey="quickHelp"
            items={draft.quickHelp ?? []}
            enabled={isSectionEnabled('quickHelp')}
            onToggle={() => toggleSection('quickHelp')}
            onChange={(value) => setList('quickHelp', value)}
          />
          <ItemListEditor
            title="Journey"
            sectionKey="journey"
            items={draft.journeySteps ?? []}
            enabled={isSectionEnabled('journey')}
            onToggle={() => toggleSection('journey')}
            onChange={(value) => setList('journeySteps', value)}
          />
          <ItemListEditor
            title="Benefits"
            sectionKey="benefits"
            items={draft.benefits ?? []}
            enabled={isSectionEnabled('benefits')}
            onToggle={() => toggleSection('benefits')}
            onChange={(value) => setList('benefits', value)}
          />
          <FaqEditor
            items={draft.faq ?? []}
            enabled={isSectionEnabled('faq')}
            onToggle={() => toggleSection('faq')}
            onChange={(value) => setList('faq', value)}
          />
          <GuidesNotice enabled={isSectionEnabled('guides')} />
          <StoriesNotice enabled={isSectionEnabled('stories')} />
        </div>
      )}

      {activeTab === 'topics' && (
        <SectionCard title="Topics" enabled={isSectionEnabled('topics')} onToggle={() => toggleSection('topics')}>
          <AdminSegmentTopicManager
            segmentId={segmentId}
            onTopicsChanged={() => {
              void loadTopics();
            }}
          />
        </SectionCard>
      )}

      {activeTab === 'preview' && (
        <AdminExperiencePreview
          segmentName={segmentName}
          segmentSlug={segmentSlug}
          config={draft}
          topics={topics}
          isDirty={isDirty}
          viewport={previewViewport}
          onViewportChange={setPreviewViewport}
        />
      )}
    </div>
  );
};

/** Save is disabled while a save is in flight, or when there is nothing to save. */
function savingExperienceDisabled(state: SaveState, isDirty: boolean): boolean {
  return state === 'saving' || !isDirty;
}

/** A titled card with an on/off switch for the section it contains. */
const SectionCard: React.FC<{
  title: string;
  enabled?: boolean;
  onToggle?: (() => void) | undefined;
  children: React.ReactNode;
}> = ({ title, enabled, onToggle, children }) => (
  <section className="rounded-xl border border-zinc-200 bg-white p-4">
    <div className="mb-3 flex items-center justify-between gap-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-900">{title}</h4>
      {onToggle && (
        <label className="flex cursor-pointer items-center gap-2 text-[11px] font-semibold text-zinc-600">
          <input
            type="checkbox"
            checked={Boolean(enabled)}
            onChange={onToggle}
            className="h-4 w-4 rounded border-zinc-300"
          />
          {enabled ? 'Shown' : 'Hidden'}
        </label>
      )}
    </div>
    {children}
  </section>
);

/** Repeating title/description/icon editor used by quick help, journey, benefits. */
const ItemListEditor: React.FC<{
  title: string;
  sectionKey: SegmentSectionKey;
  items: Array<{ title: string; description: string; icon?: string }>;
  enabled: boolean;
  onToggle: () => void;
  onChange: (value: Array<{ title: string; description: string; icon?: string }>) => void;
}> = ({ title, items, enabled, onToggle, onChange }) => {
  const [open, setOpen] = useState(true);
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-900"
        >
          <ChevronDown className={cn('h-4 w-4 transition-transform', !open && '-rotate-90')} aria-hidden="true" />
          {title}
          <span className="text-[10px] font-normal normal-case text-zinc-400">
            ({items.length})
          </span>
        </button>
        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-zinc-600">
            <input
              type="checkbox"
              checked={enabled}
              onChange={onToggle}
              className="h-4 w-4 rounded border-zinc-300"
            />
            {enabled ? 'Shown' : 'Hidden'}
          </label>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onChange([...items, { title: '', description: '', icon: '' }])}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add
          </Button>
        </div>
      </div>

      {open && (
        <div className="space-y-2">
          {items.length === 0 && (
            <p className="text-xs text-zinc-500">
              Nothing here. With no content the section is hidden on the seeker page rather
              than padded with placeholder copy.
            </p>
          )}
          {items.map((item, idx) => (
            <div
              key={idx}
              className="grid grid-cols-1 gap-2 rounded-lg border border-zinc-200 p-3 sm:grid-cols-12"
            >
              <Input
                label="Title"
                value={item.title}
                onChange={(e) => {
                  const next = [...items];
                  next[idx] = { ...next[idx], title: e.target.value };
                  onChange(next);
                }}
                className="sm:col-span-4"
              />
              <Input
                label="Description"
                value={item.description}
                onChange={(e) => {
                  const next = [...items];
                  next[idx] = { ...next[idx], description: e.target.value };
                  onChange(next);
                }}
                className="sm:col-span-6"
              />
              <div className="flex items-end sm:col-span-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onChange(items.filter((_, i) => i !== idx))}
                  aria-label={`Remove item ${idx + 1}`}
                >
                  <Trash2 className="h-3.5 w-3.5 text-rose-600" aria-hidden="true" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

const FaqEditor: React.FC<{
  items: Array<{ question: string; answer: string }>;
  enabled: boolean;
  onToggle: () => void;
  onChange: (value: Array<{ question: string; answer: string }>) => void;
}> = ({ items, enabled, onToggle, onChange }) => (
  <SectionCard title="FAQ" enabled={enabled} onToggle={onToggle}>
    <div className="space-y-2">
      {items.length === 0 && <p className="text-xs text-zinc-500">No questions yet.</p>}
      {items.map((item, idx) => (
        <div key={idx} className="grid grid-cols-1 gap-2 rounded-lg border border-zinc-200 p-3 sm:grid-cols-12">
          <Input
            label="Question"
            value={item.question}
            onChange={(e) => {
              const next = [...items];
              next[idx] = { ...next[idx], question: e.target.value };
              onChange(next);
            }}
            className="sm:col-span-5"
          />
          <Input
            label="Answer"
            value={item.answer}
            onChange={(e) => {
              const next = [...items];
              next[idx] = { ...next[idx], answer: e.target.value };
              onChange(next);
            }}
            className="sm:col-span-6"
          />
          <div className="flex items-end sm:col-span-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onChange(items.filter((_, i) => i !== idx))}
              aria-label={`Remove question ${idx + 1}`}
            >
              <Trash2 className="h-3.5 w-3.5 text-rose-600" aria-hidden="true" />
            </Button>
          </div>
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        onClick={() => onChange([...items, { question: '', answer: '' }])}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        Add question
      </Button>
    </div>
  </SectionCard>
);

/**
 * Guides and stories are real content, so there is no generator for them. The
 * panel states where they come from and stays disabled until an admin has
 * supplied them, rather than offering a way to invent them.
 */
const GuidesNotice: React.FC<{ enabled: boolean }> = ({ enabled }) => (
  <SectionCard title="Guides" enabled={enabled} onToggle={undefined}>
    <p className="text-xs leading-relaxed text-zinc-500">
      Guides are real articles, so they are never generated from the mentor list. This section
      stays hidden until configured content exists for it.
    </p>
  </SectionCard>
);

const StoriesNotice: React.FC<{ enabled: boolean }> = ({ enabled }) => (
  <SectionCard title="Stories" enabled={enabled} onToggle={undefined}>
    <p className="text-xs leading-relaxed text-zinc-500">
      Stories are real seeker quotes supplied by an administrator. No testimonial is ever
      synthesised from ratings, review counts or mentor names, so this section stays hidden
      until real content is provided.
    </p>
  </SectionCard>
);

export { SEGMENT_SECTION_KEYS, SECTION_LABELS, sanitizeSegmentColor };
export default AdminSegmentExperienceEditor;