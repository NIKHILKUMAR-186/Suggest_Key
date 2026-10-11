# New Landing Page (`new` variant)

A complete, independent implementation of `/` converted from the supplied
standalone HTML design ("Ask the Wise"). It shares no markup, styling or state
with the legacy landing page and can be enabled or disabled with one setting.

## Where things live

| Concern | Location |
|---|---|
| Variant switch (the one setting) | `src/config/landing-page.config.ts` |
| Route selection (the only switch point) | `src/routes/Router.tsx` |
| Page entry / composition | `src/pages/public/NewLandingPage.tsx` |
| Components | `src/components/new-landing/` |
| Isolated stylesheet | `src/components/new-landing/styles/NewLandingPage.css` |
| Icons (the design's SVG art) | `src/components/new-landing/NewLandingIcons.tsx` |

```
NewLandingHero.tsx        hero banner, floating bubbles, trust row
NewLandingSections.tsx    category cards, how-it-works, experts, stories, CTA
NewLandingFaq.tsx         disclosure FAQ
NewLandingFooter.tsx      footer
useSectionScroll.ts       in-page scrolling without a page reload
NewLandingIcons.tsx       inline SVG icon set
```

## How to activate the new page

1. Open `src/config/landing-page.config.ts`.
2. Change the one value:

   ```ts
   export const LANDING_PAGE_VARIANT: LandingPageVariant = 'new';
   ```

3. Rebuild (`npm run build`) or restart the dev server (`npm run dev`).
4. Open `/`.

## How to restore the legacy page

1. Set the value back to `'legacy'` (its default).
2. Rebuild or restart.

The legacy page returns with no change to its own components — the variant is
resolved once at module load, and neither implementation is ever mounted while
the other is active.

### Verifying each variant

- `legacy` — the notebook landing page appears, byte-identical to before this
  integration (all existing sections, animations and navigation).
- `new` — the deep-purple hero renders with the pill, the display headline, the
  two actions, the trust row and the three floating category bubbles; the
  category cards overlap the hero; the "how it works" steps, FAQ, yellow CTA and
  dark footer follow.
- In the browser, check the network tab: the `NewLandingPage` CSS/JS chunk is
  **not requested at all** while the variant is `legacy`.

## What the new page is wired to

Real application behaviour, not disconnected static markup:

- **Sign in / Sign up** — the app's own auth routes, via `useNavigation()`, so
  no internal link causes a full page reload.
- **Category cards and footer section links** — `mentorDirectoryPath({ segmentSlug })`,
  the same helper the legacy page uses, so the clicked segment is preserved.
- **"Book a Session" / "Ask the Wise"** — resolved from auth state exactly as the
  legacy page does (`/seeker` when signed in, `/auth/signup` when anonymous).
- **Experts and story cards** — read the same real mentor catalogue as the legacy
  page (`useMentorDirectory`), with the same loading, error and empty states.

## Limitations and deliberate substitutions

1. **The design's expert cards were placeholders.** The supplied HTML named
   specific people, cities, session times and fees. Showing those would be
   fabricated business data, so the row is bound to the real mentor catalogue
   instead: real names, real segment, real session format and the mentor's real
   starting price, plus the same "Try again" affordance the legacy page has when
   the catalogue cannot be loaded.

2. **The design's stories row contained invented testimonials.** There is no
   testimonial source in this application, so that row shows each mentor's own
   published headline and segment rather than a quote attributed to them. No
   name, rating or count is invented.

3. **The hero's photographic banner was a ~130 KB inline base64 JPEG.** That
   blob is not copied into the bundle. The hero field is reproduced with the
   design's own gradient and colour tokens, and the design's connector tails,
   pill, headline, actions and trust marks are all reproduced exactly.

4. **The autism bubble glyph was a ~100 KB inline base64 PNG.** It is redrawn as
   an inline SVG (`AutismBadgeIcon`) rather than embedded.

5. **Footer links with no route in this application** — Guides & articles, Ask a
   question, About, Contact, Privacy, Terms — are rendered in a visibly inert
   disabled state instead of as live `#` links that would do nothing.

6. **The design's "WhatsApp us" button had no destination.** There is no
   WhatsApp integration configured, so the two CTA actions go to the mentor
   directory and expert comparison, both of which exist.

7. **Support areas use the app's existing segment configuration.** The three
   categories come from `LANDING_SEGMENTS`, the same source the legacy landing
   page uses, so the two variants agree on names, descriptions and slugs.

## Style isolation

Every rule in the stylesheet is scoped under the single `.nlg` root. There are
no `:root` variables and no `body`, `html`, `h1`, `button`, `a` or `*` rules,
and `src/index.css` is not modified. The legacy page's styles cannot reach this
page, and this page's styles cannot reach the rest of the application.

The Plus Jakarta Sans webfont is loaded by an `@import` inside this page's own
stylesheet, so it is fetched only when this variant is active and no global
document is modified to obtain it.
