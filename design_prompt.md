# MASTER PROMPT — DESIGN SPECIFICATION TO PREMIUM LANDING PAGE
## Suggest Key | Design Intelligence, Motion Engineering & Visual Quality Assurance

You are the principal product designer, creative director, senior frontend engineer, motion designer, and visual QA specialist responsible for rebuilding the Suggest Key landing page.

Your job is to transform ANY provided design specification file into a polished, distinctive, fully functional landing page.

The input might be named `design.md`, `DESIGN.md`, `landing-design.md`, `ui-specification.md`, or something else. It might describe a complete website, an individual section, a visual reference, a design system, animation patterns, or a combination of these.

You must discover the relevant instructions, understand them, resolve conflicts carefully, and implement the intended design rather than producing a generic template.

**A compiling application is not sufficient. Visual quality, real animation, typography, composition, usability, and preservation of product functionality are mandatory acceptance criteria.**

---

# 1. PRIMARY OBJECTIVES

Deliver a landing page that:

- Closely follows the supplied design specification.
- Applies the design specification's visual principles to the actual interface, not merely to documentation or CSS comments.
- Uses sophisticated typography, intentional spacing, expressive composition, and a consistent design system.
- Has real, working, perceptible animations and transitions wherever appropriate.
- Feels cohesive from the first viewport to the footer.
- Works across desktop, tablet, and mobile.
- Preserves Suggest Key's existing functionality, architecture, and data contracts.
- Is verified in a browser wherever browser tooling is available.
- Does not claim visual fidelity or test success without evidence.

Do not assume that all design specifications are complete, accurate, compatible, or suitable for direct implementation. Analyse them first.

# 2. DISCOVER AND UNDERSTAND THE DESIGN DOCUMENT

Before changing any code, inspect the repository and discover:

- Every relevant `design.md`, `DESIGN.md`, `landing-design.md`, UI specification, design-system document, and design-related instruction file.
- `AGENTS.md`, `CLAUDE.md`, `README.md`, and other applicable repository instructions.
- Existing landing-page components, routes, layouts, global CSS, design tokens, fonts, assets, and animation utilities.
- Existing packages and available browser-testing tools.
- Existing product requirements and documented visual references.

For every relevant design document:

1. Read the complete file, not just its title or introduction.
2. Extract its visual direction, typography, color palette, spacing, composition, component styles, responsive rules, motion requirements, interaction behavior, and accessibility requirements.
3. Identify the requirements that are mandatory versus illustrative.
4. Identify any assets, references, implementation examples, or supporting files it mentions.
5. Determine which requirements apply globally and which apply to specific sections.
6. Record missing information and ambiguities rather than silently inventing requirements.
7. Identify conflicts with the existing product, architecture, accessibility, performance, or other design documents.

Create a concise design interpretation before implementation.

If several design documents exist, do not arbitrarily choose the first one. Determine their scope and authority, preserve compatible requirements, and document material conflicts. Ask one focused question only when an unresolved decision would substantially change the design. Otherwise, make a reasoned, documented choice.

The design specification is the primary visual authority for the requested redesign. Existing project instructions and security constraints remain authoritative for implementation.

# 3. WEBSITE REFERENCE LIBRARY — USE ALL RELEVANT REFERENCES

Study the following references and use the aspects relevant to the supplied design document.

### Primary visual reference

Integrated Biosciences  
https://integratedbio.com/

Study its visual language, typography, scale, negative space, image composition, scrolling experience, transitions, and visual pacing.

Use these principles where compatible with the supplied specification. Do not assume that every effect on the reference is necessary for Suggest Key.

### Motion and interaction inspiration

Animmaster Library  
https://animmasterlib.dev/

Explore relevant patterns for text entrances, scrolling, transitions, hover interactions, image reveals, navigation, and other animation categories.

Skiper UI  
https://skiper-ui.com/

Explore relevant implementation patterns for sophisticated sections, scroll-linked experiences, interactive components, image reveals, and composition.

Transitions.dev  
https://transitions.dev/

Investigate relevant transition patterns and implementation guidance where they suit the existing React architecture.

for prebuilt motions
S:\suggest-key\Suggest_key\src\components\landing\motion

use this where ever needed


### Additional visual reference

Zenup Health: use the reference URL supplied in the project's instructions or the user's conversation, if available. Do not invent an unverified URL.

### Reference analysis rules

- Inspect the actual reference sites when browser or web access is available.
- Do not rely solely on a reference's marketing description or search-result summary.
- Record specific patterns that can be implemented and explain why they suit the target page.
- Distinguish observed behavior from assumptions.
- Do not copy another website's branding, proprietary code, text, or unrelated assets.
- Do not add animations merely because a reference contains them.
- If a reference is inaccessible, document the limitation and use only the evidence actually available.

The supplied design document determines which reference principles to prioritize.

# 4. IMPECCABLE AND TASTE SKILL INTEGRATION

Discover whether Impeccable and Taste are actually available in the coding environment.

Inspect their real instructions, command registries, skill files, supporting resources, and invocation methods.

For each skill:

1. Enumerate the documented capabilities and commands.
2. Verify the exact syntax and availability of each command.
3. Identify which capabilities apply to the current design document and landing page.
4. Use applicable analysis, design, critique, implementation, accessibility, and refinement workflows throughout the project.
5. Run applicable final audits after implementation.
6. Record the commands invoked and their outcomes.

Use all relevant, available capabilities rather than arbitrarily limiting the workflow to one design critique.

Do not invoke irrelevant or destructive commands just to claim complete usage.

Do not invent commands, fake execution results, or claim a skill was used if it was unavailable.

If either skill is unavailable, report the dependency and use the skill's official installation instructions when verified. Do not fabricate installation commands. Continue with documented design principles only when doing so is appropriate, and distinguish this fallback from actual skill execution.

# 5. SUGGEST KEY — PRODUCT AND ENGINEERING CONTEXT

This is a real mentorship marketplace, not a static design mockup.

The product's core journey is:

Discover a mentor → select a slot → hold the slot for five minutes → pay → mentor confirms → join at T−5 → complete the session → access the mentor-authored workspace.

The platform has Seeker, Mentor, and Admin roles.

Preserve the actual product capabilities and never invent features or business metrics.

### Existing architecture

Verify the current repository before making assumptions. The project context indicates:

- React 19, Vite, TypeScript, Tailwind CSS v4.
- `motion` package using `motion/react`.
- Lucide icons.
- A hand-rolled router.
- Supabase-backed data and realtime functionality.
- Global styling and design tokens primarily maintained in `src/index.css`.

These are expected starting points, not permission to assume the current repository is unchanged. Inspect `package.json`, the source tree, and current implementation before using them.

### Mandatory product constraints

- Use real CMS-driven segment data.
- Use real mentor data from the existing data-access layer.
- Do not fabricate testimonials, ratings, review counts, success statistics, or mentor availability.
- Do not imply that built-in video calling exists; meeting links are mentor-supplied.
- Do not assume Razorpay is the live default. Manual UPI/QR is the documented live default, and Razorpay is feature-flagged off by default.
- Keep “Become a Mentor” exclusively in the footer.
- Put Home first in the navbar.
- Home must return the user smoothly to the top of the page.
- Include an accessible back-to-top control that appears only after meaningful scrolling, if consistent with the current specification.
- Preserve existing authentication, booking, payment, routing, database, and RLS behavior.

Never change backend schemas, security policies, or payment behavior merely to achieve a visual design.

# 6. DESIGN SYSTEM AND ART DIRECTION

Translate the specification into a coherent, reusable design system.

Define or refine:

- Display typography and body typography.
- A fluid type scale using `clamp()` where appropriate.
- Font weights, line heights, letter spacing, and heading widths.
- Color roles and contrast requirements.
- Spacing and layout tokens.
- Content widths and responsive gutters.
- Section backgrounds and separators.
- Border radii, borders, and shadow usage.
- Image ratios, crops, and focal-point rules.
- Motion durations, easing, stagger, and reveal distances.
- Focus, hover, active, disabled, loading, and error states.

Use the existing token source of truth whenever possible. Avoid creating competing design systems.

Typography and composition must be deliberate. Do not use generic default heading sizes, repetitive centered sections, arbitrary font changes, or identical three-card grids throughout the page.

Every section should have its own composition while remaining part of the same visual language.

# 7. MOTION ENGINEERING — ACTUAL IMPLEMENTATION REQUIRED

Do not confuse animation declarations with working motion.

Inspect the existing animation stack and reuse suitable utilities before adding new dependencies.

Implement motion that supports hierarchy, feedback, storytelling, or spatial continuity.

### A. Initial entrance

Where appropriate:

- Create a coordinated hero entrance.
- Use staggered headline, supporting copy, CTA, and visual timing.
- Use carefully controlled opacity, translation, clipping, or line reveals.
- Avoid making users wait for important content to become available.

### B. Typography motion

- Use selected line-based or character-based reveals for display text where appropriate.
- Prevent layout shifts and broken text selection.
- Avoid animating every heading in exactly the same way.
- Ensure text stays readable when JavaScript or animation initialization fails.

### C. Scroll-triggered motion

- Reveal selected content as it enters the viewport.
- Use appropriate viewport thresholds and one-time triggers where suitable.
- Use scroll-linked progress or transforms only when they strengthen the experience.
- Avoid scroll hijacking and excessive parallax.
- Avoid repeatedly replaying all entrance animations when scrolling back and forth.

### D. Image and media motion

- Implement controlled image reveals, clipping, masks, or scale transitions where appropriate.
- Prevent layout shifts.
- Respect image ratios, focal points, and mobile performance.
- Avoid heavy visual effects that do not contribute to the design.

### E. Interactive motion

- Add refined hover, focus, press, and active states.
- Make buttons feel responsive.
- Use magnetic pointer movement only where appropriate and never as the only means of interaction.
- Ensure touch and keyboard interactions remain fully functional.

### F. Navigation and transitions

- Add intentional navigation entrance and scroll-state behavior.
- Use natural scrolling and preserve navigation usability.
- Add section transitions only when they improve pacing.
- Avoid intrusive page transitions or effects that delay navigation.

### G. Motion system

Use consistent duration, easing, and distance tokens.

Prefer performant transform and opacity animations when appropriate.

Avoid:
- Constant floating decorations.
- Random movement.
- Excessive spring effects.
- Long, theatrical delays on ordinary content.
- Simultaneous animations on every element.
- Animation that reduces readability or makes interactions slower.
- Heavy WebGL, canvas, or particle effects without a clear design justification.

### H. Accessibility

- Respect `prefers-reduced-motion`.
- Keep meaningful content visible when nonessential motion is disabled.
- Provide keyboard-visible focus states.
- Avoid flashes, disorienting transitions, and forced scrolling.
- Keep animations from interfering with screen readers or interaction state.

### I. Motion verification

Verify animations in the browser when tooling is available. Check that they actually trigger, complete correctly, and work across screen sizes.

An imported animation library is not evidence of a functioning motion experience.

# 8. SECTION COMPOSITION

Discover the sections required by the supplied design document. Do not assume every design requires the same sections.

For the standard Suggest Key landing page, the expected sequence is:

1. Navigation.
2. Hero.
3. Mentorship segments.
4. How It Works.
5. Mentor Showcase.
6. Why Suggest Key.
7. FAQ.
8. Footer.

Use the document's specified structure when it differs, unless it conflicts with mandatory product requirements.

For each section, define:

- Its purpose in the user journey.
- The dominant visual element.
- Heading scale and text alignment.
- Layout and image composition.
- Primary action, if any.
- Entry and exit behavior.
- Relevant hover, scroll, or interaction states.
- Responsive transformation.
- Accessibility considerations.

Do not build every section as the same collection of cards.

Use visual contrast and changes in scale to create rhythm across the complete page. Ensure the transitions between sections feel intentional rather than disconnected.

# 9. RESPONSIVE DESIGN

Verify the design at representative viewport sizes, including approximately:

- Mobile: 375 px and 430 px.
- Tablet: 768 px.
- Desktop: 1280 px and 1440 px.

Use actual project breakpoints where available.

Check:

- Heading wrapping and overflow.
- Navigation collapse and usability.
- Image crop and composition.
- Section spacing and reading rhythm.
- Card or list density.
- Touch targets.
- Horizontal overflow.
- Animation performance.
- Reduced-motion behavior.
- Footer layout.

Do not simply shrink the desktop design. Recompose sections for smaller screens.

# 10. IMPLEMENTATION WORKFLOW

Work in phases. Do not attempt a complete redesign in a single uncontrolled code change.

### Phase 0 — Discovery and planning

- Read the design specification.
- Inspect the repository and existing product requirements.
- Inspect the reference websites.
- Audit Impeccable and Taste availability.
- Audit existing typography, layout, assets, motion, and dependencies.
- Produce a requirements matrix, section plan, motion plan, and risk list.

Do not change landing-page implementation in this phase.

### Phase 1 — Foundation + first two sections

- Refine the design tokens, fonts, typography, layout primitives, and motion utilities.
- Implement the first two required sections in the specified order.
- Verify desktop, mobile, animation behavior, and accessibility.

### Phase 2 onward — Two sections per phase

Implement the next two sections in document order.

For each phase:
1. Read the corresponding requirements.
2. Use relevant available Impeccable and Taste capabilities.
3. Implement the assigned sections.
4. Integrate shared components and transitions.
5. Test data integration and interactions.
6. Perform visual critique and refinement.
7. Verify responsive behavior and reduced motion.
8. Run relevant tests.
9. Capture visual evidence.
10. Report results and stop for approval.

If only one section remains, implement that section plus the integration and quality work necessary to complete the page.

### Final phase — Full-page polish

Review the complete page as a single continuous experience.

Correct:
- Typography inconsistencies.
- Weak or repetitive compositions.
- Spacing problems.
- Broken or imperceptible animations.
- Abrupt section transitions.
- Poor mobile layouts.
- Excessive decorative effects.
- Accessibility regressions.
- Performance problems.
- Any deviations from the supplied design specification.

Do not stop after the first successful build.

# 11. TESTING AND VISUAL QUALITY ASSURANCE

Run the repository's available checks, including where supported:

- `npm run lint`
- `npm test`
- `npm run build`

Inspect `package.json` before assuming scripts exist.

Use browser automation and screenshots if available. Inspect both initial and scrolled states, interactive states, and mobile layouts.

Compare the result against the actual design specification. A successful build proves technical compilation, not visual quality.

For every visual issue found, record the problem, correct it, and verify the correction.

Do not fabricate screenshots, test results, performance scores, or accessibility audit outcomes.

If a test cannot run, report why and identify what remains unverified.

# 12. DEPENDENCY AND CODE QUALITY RULES

- Reuse existing components and utilities where appropriate.
- Avoid unnecessary animation or UI dependencies.
- Do not create duplicate global tokens or competing styling systems.
- Keep landing-specific code organized in the established source structure.
- Keep data fetching inside the existing data-access patterns.
- Do not fetch all mentors and slice the results in the browser if the existing architecture supports cursor-based pagination.
- Avoid changing unrelated files.
- Do not remove existing functionality without explicit approval.
- Do not leave unused components, dead code, debug statements, or incomplete animation utilities.
- Keep code maintainable and type-safe.

# 13. REQUIRED REPORTING

At the end of each phase, report:

1. Design document(s) used.
2. Requirements implemented.
3. Visual decisions and rationale.
4. Impeccable and Taste capabilities actually invoked.
5. Files changed.
6. Animations and interactions implemented and verified.
7. Desktop and mobile verification evidence.
8. Lint, test, and build results.
9. Known limitations and remaining issues.
10. The exact next phase.

Maintain a checklist of design requirements so that implementation remains traceable to the source document.

# 14. FINAL ACCEPTANCE CRITERIA

The landing page is complete only when:

- It follows the supplied design specification.
- Typography, layout, and visual hierarchy are clearly intentional.
- Each section has an appropriate composition.
- Motion is implemented, perceptible, purposeful, and accessible.
- Responsive behavior is verified.
- Actual product data and functionality are preserved.
- No unsupported product claims or fabricated business metrics are introduced.
- Technical checks pass where supported.
- Visual evidence exists where browser tooling permits.
- Remaining limitations are explicitly documented.

Do not mark the task complete because the code compiles.

Do not replace a missing design requirement with an arbitrary generic template.

Do not claim skill execution without evidence.

## START NOW

Begin with Phase 0 only.

Discover the design document, read the repository instructions, inspect the current implementation, study the relevant references, and verify skill availability.

Produce the design interpretation, capability matrix, section plan, motion plan, and risk assessment.

Do not implement any landing-page section until Phase 0 has been reported. Then wait for explicit approval before starting Phase 1.

