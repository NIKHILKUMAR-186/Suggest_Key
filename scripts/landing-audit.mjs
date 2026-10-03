/**
 * HEADLESS LAYOUT AUDIT.
 *
 * The landing page is graded on geometry and contrast, neither of which a
 * type-check or a source-level test can see. This drives a real Chromium over
 * the DevTools Protocol and reports, per viewport:
 *
 *   - horizontal overflow (the single most common responsive defect)
 *   - any element whose box escapes the viewport horizontally
 *   - text that is clipped by its own container
 *   - WCAG contrast of every text node against its painted background
 *   - computed display type sizes, so the fluid scale can be checked as built
 *   - broken images and console errors
 *
 * Read-only: it navigates, measures and exits. Run with `node scripts/landing-audit.mjs`.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL_UNDER_TEST = process.env.AUDIT_URL || 'http://localhost:3000/';
const DEBUG_PORT = 9333;

const VIEWPORTS = [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'laptop-1280', width: 1280, height: 800 },
  { name: 'small-laptop-1024', width: 1024, height: 768 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'phone-430', width: 430, height: 932 },
  { name: 'phone-390', width: 390, height: 844 },
  { name: 'phone-375', width: 375, height: 812 },
];

/**
 * Reads the element that currently holds focus and judges its ring.
 *
 * Evaluated once per Tab press, because a ring only exists while something is
 * focused and `:focus-visible` only applies when the browser decided the focus
 * was keyboard-driven. Both of those are things only the browser can know, so
 * this cannot be faked by calling `.focus()` from script.
 *
 * Self-contained on purpose: it re-declares the small amount of colour maths it
 * needs instead of sharing a helper block with the main pass, so the two probes
 * cannot drift apart when one of them is edited.
 */
const STEP_FOCUS = `(() => {
  const parse = (c) => {
    const m = c.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  // Every opaque colour at or behind the element.
  const backs = (el) => {
    /**
     * Hex stops are parsed as well as rgb() ones. Several of these gradients
     * name their colour stops in hex (#1b0d33 and friends), and a parser that
     * only understands rgb() silently drops the opaque base layer of the plum
     * field — which then composites against white instead of against plum and
     * makes a perfectly visible ring look like an invisible one.
     */
    const stopsOf = (value) => {
      const out = [];
      for (const token of value.match(/rgba?\\([^)]+\\)/g) || []) {
        const c = parse(token);
        if (c) out.push(c);
      }
      for (const hex of value.match(/#[0-9a-f]{3,8}/gi) || []) {
        const h = hex.slice(1);
        const f = h.length === 3 || h.length === 4 ? h.split('').map((x) => x + x).join('') : h.padEnd(8, 'f');
        out.push({
          r: parseInt(f.slice(0, 2), 16),
          g: parseInt(f.slice(2, 4), 16),
          b: parseInt(f.slice(4, 6), 16),
          a: parseInt(f.slice(6, 8), 16) / 255,
        });
      }
      return out;
    };

    /**
     * The nearest painted surface at or behind the element, as the eye sees it.
     *
     * Both halves of a CSS background are honoured, because most of these
     * surfaces are painted with a gradient and no flat colour at all — the plum
     * hero field and the violet discovery wash are radial gradients — so reading
     * only backgroundColor would walk straight past them to the page canvas and
     * report a ring over a plum band as a ring over white paper.
     *
     * Two rules keep the result honest:
     *
     *   1. Within one element, a translucent stop composites over that same
     *      element's own opaque base, not over whatever was inherited. A violet
     *      wash over the plum gradient is a dark plum; the same wash over white
     *      would be lavender, and reporting the lavender would flag rings that
     *      are perfectly visible.
     *   2. The walk stops at the first fully opaque layer. Anything beyond it is
     *      not the surface this ring is drawn against, only further away, and
     *      including it turns every translucent field into a false alarm.
     */
    const chain = (from, stopAt) => {
      const out = [];
      let node = from;
      let carried = { r: 255, g: 255, b: 255, a: 1 };
      while (node && node !== document.documentElement && node !== stopAt) {
        const cs = getComputedStyle(node);
        const stops = stopsOf(cs.backgroundColor).concat(stopsOf(cs.backgroundImage));
        const opaqueStops = stops.filter((c) => c.a === 1);
        const base = opaqueStops.length ? { ...opaqueStops[0] } : carried;

        for (const c of stops) {
          if (c.a <= 0.05) continue;
          const composited = c.a === 1 ? { r: c.r, g: c.g, b: c.b, a: 1 } : over(c, base);
          out.push(composited);
        }

        if (opaqueStops.length) return out;
        carried = base;
        node = node.parentElement;
      }
      return out;
    };

    /**
     * A fixed bar with no background of its own is not backed by its ancestors:
     * what is behind it is a completely different subtree, which the ancestor
     * chain never reaches. Walking past the bar anyway would add the page
     * canvas — a surface the ring is never actually drawn on — and would report
     * every transparent bar as invisible.
     *
     * So the chain stops at the bar, and the honest backdrop is found by hitting
     * the point the bar actually covers.
     */
    let bar = null;
    let node = el;
    while (node && node.nodeType === 1) {
      const p = getComputedStyle(node).position;
      if (p === 'fixed' || p === 'sticky') {
        const barBg = parse(getComputedStyle(node).backgroundColor);
        if (!barBg || barBg.a < 0.05) bar = node;
        break;
      }
      node = node.parentElement;
    }

    const inside = chain(el, bar);
    if (!bar) return inside.length ? inside : [{ r: 255, g: 255, b: 255, a: 1 }];

    const r = bar.getBoundingClientRect();
    const cx = Math.min(window.innerWidth - 2, Math.max(2, r.left + r.width / 2));
    const cy = Math.min(window.innerHeight - 2, Math.max(2, r.top + r.height / 2));
    const restore = [];
    for (const n of [bar, ...bar.querySelectorAll('*')]) {
      restore.push([n, n.style.pointerEvents]);
      n.style.pointerEvents = 'none';
    }
    const hit = document.elementFromPoint(cx, cy);
    for (const [n, prev] of restore) n.style.pointerEvents = prev;

    const behind = hit && hit !== bar && !bar.contains(hit) ? chain(hit, null) : [];
    const all = [...inside, ...behind];
    return all.length ? all : [{ r: 255, g: 255, b: 255, a: 1 }];
  };

  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return null;

  const cs = getComputedStyle(el);
  const box = el.getBoundingClientRect();
  const stop = {
    label: (el.getAttribute('aria-label') || el.textContent || el.tagName)
      .trim()
      .replace(/\\s+/g, ' ')
      .slice(0, 34),
    w: Math.round(box.width),
    h: Math.round(box.height),
  };

  const ring = parse(cs.outlineColor);
  if (!ring || ring.a <= 0.05 || parseFloat(cs.outlineWidth) === 0) return stop;

  const solid = { r: ring.r, g: ring.g, b: ring.b, a: 1 };
  let worst = Infinity;
  let worstBg = null;
  for (const bg of backs(el)) {
    const here = ratio(solid, bg);
    if (here < worst) { worst = here; worstBg = bg; }
  }
  stop.worst = Number(worst.toFixed(2));
  stop.ring = cs.outlineColor;
  stop.against = 'rgb(' + Math.round(worstBg.r) + ', ' + Math.round(worstBg.g) + ', ' + Math.round(worstBg.b) + ')';
  return stop;
})()`;

const AUDIT = `(() => {
  const report = { overflowX: 0, offenders: [], clipped: [], lowContrast: [], images: [], consoleErrors: [], sizes: {}, headings: [], rhythm: [], actions: [], focusStops: [], smallTargets: [] };

  const vw = window.innerWidth;
  report.overflowX = Math.max(0, document.documentElement.scrollWidth - vw);

  // Anything whose painted box leaves the viewport sideways.
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' && el.className && String(el.className).includes('sk-lp-nav')) continue;
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.right > vw + 1.5 || r.left < -1.5) {
      const key = el.tagName + '.' + String(el.className).slice(0, 60);
      if (seen.has(key)) continue;
      seen.add(key);
      report.offenders.push({
        sel: key,
        left: Math.round(r.left),
        right: Math.round(r.right),
      });
    }
  }

  // Text that is taller than its own clipped box.
  for (const el of document.querySelectorAll('p, h1, h2, h3, span, a, button, li')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.overflow === 'visible' || cs.webkitLineClamp !== 'none') continue;
    if (el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 0) {
      const key = el.tagName + '.' + String(el.className).slice(0, 60);
      if (seen.has(key)) continue;
      seen.add(key);
      report.clipped.push({ sel: key, scrollH: el.scrollHeight, clientH: el.clientHeight });
    }
  }

  // WCAG contrast for every rendered text node.
  const parse = (c) => {
    const m = c.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  // Every background the text could plausibly sit on. Gradients are how these
  // surfaces are painted, so ignoring them would report white text on a plum
  // field as 1.04:1 and hide every real failure. Hex stops are parsed as well as
  // rgb() stops, and the worst case across all candidates is reported.
  //
  // Two modelling rules keep the report honest rather than noisy:
  //   1. Layers composite from the root down, so an element never inherits the
  //      page canvas as a candidate when something opaque is painted over it.
  //   2. Where one element paints several gradients, a translucent wash sitting
  //      on top of an opaque field is not a backdrop on its own. If any stop of a
  //      background stack is solid, the translucent stops of that same stack are
  //      atmosphere, not background, and are dropped.
  //
  // A fixed bar with a transparent background has no painted background of its
  // own: what is behind it depends on where it happens to be. For those, the
  // element actually under the bar's centre is hit-tested and its backgrounds
  // are used, which is the only way to check a transparent header honestly.
  // These regexes are evaluated inside a template literal, so their escapes are
  // doubled here on purpose: a single backslash would be consumed by the outer
  // literal and silently turn the pattern into something that never matches.
  const COLOR_FN = new RegExp('rgba?[(]([^)]+)[)]', 'g');
  const parseList = (c) => {
    const out = (c.match(COLOR_FN) || []).map(parse).filter(Boolean);
    for (const hex of c.match(/#[0-9a-f]{3,8}\\b/gi) || []) {
      const h = hex.slice(1);
      const f = h.length === 3 || h.length === 4 ? h.split('').map((x) => x + x).join('') : h.padEnd(8, 'f');
      const n = parseInt(f.slice(0, 6), 16);
      out.push({
        r: (n >> 16) & 255,
        g: (n >> 8) & 255,
        b: n & 255,
        a: f.length >= 8 ? parseInt(f.slice(6, 8), 16) / 255 : 1,
      });
    }
    return out;
  };
  const WHITE = { r: 255, g: 255, b: 255, a: 1 };
  const layersOf = (node) => {
    const cs = getComputedStyle(node);
    let stops = parseList(cs.backgroundImage || 'none');
    if (stops.some((s) => s.a >= 0.6)) stops = stops.filter((s) => s.a >= 0.6);
    const bg = parse(cs.backgroundColor);
    return [...stops, ...(bg && bg.a > 0 ? [bg] : [])];
  };
  const candidatesFrom = (el) => {
    const chain = [];
    let node = el;
    while (node && node.nodeType === 1) {
      chain.push(node);
      node = node.parentElement;
    }
    let composites = [WHITE];
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      const layers = layersOf(chain[i]);
      if (layers.length === 0) continue;
      const next = [];
      for (const layer of layers) {
        if (layer.a < 0.005) continue;
        for (const b of composites) next.push(layer.a >= 0.999 ? layer : over(layer, b));
      }
      if (next.length === 0) continue;
      const opaque = next.filter((c) => c.a >= 0.999);
      // Root first, then each descendant painting over what came before, so the
      // deepest opaque layer is the one that survives. The traversal keeps going
      // even once an ancestor is opaque, because everything below it paints on
      // top.
      composites = opaque.length ? opaque : next;
    }
    return composites;
  };
  const candidateBgs = (el) => {
    const cs = getComputedStyle(el);
    const selfBg = parse(cs.backgroundColor);
    // The element being measured is usually NOT the fixed bar — it is a link
    // inside it. So the nearest positioned ancestor is what has to be looked
    // through, and only if it paints nothing of its own.
    let anchor = null;
    if (!selfBg || selfBg.a < 0.05) {
      let n = el;
      while (n && n.nodeType === 1) {
        const p = getComputedStyle(n).position;
        if (p === 'fixed' || p === 'sticky') {
          const b = parse(getComputedStyle(n).backgroundColor);
          if (!b || b.a < 0.05) anchor = n;
          break;
        }
        n = n.parentElement;
      }
    }
    if (anchor) {
      const r = anchor.getBoundingClientRect();
      const cx = Math.min(window.innerWidth - 2, Math.max(2, r.left + r.width / 2));
      const cy = Math.min(window.innerHeight - 2, Math.max(2, r.top + r.height / 2));
      // The bar's own subtree sits on top of itself, so it is taken out of
      // hit-testing first; otherwise the probe just finds the bar again.
      const restore = [];
      for (const n of [anchor, ...anchor.querySelectorAll('*')]) {
        restore.push([n, n.style.pointerEvents]);
        n.style.pointerEvents = 'none';
      }
      const hit = document.elementFromPoint(cx, cy);
      for (const [n, prev] of restore) n.style.pointerEvents = prev;
      if (hit && hit !== anchor && !anchor.contains(hit)) return candidatesFrom(hit);
    }
    return candidatesFrom(el);
  };





  const contrastSeen = new Set();
  for (const el of document.querySelectorAll('p, h1, h2, h3, li, a, button, span')) {
    const direct = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!direct) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) continue;
    if (rect.top > window.innerHeight * 40 && rect.top < window.innerHeight * 41) continue;
    const fg = parse(cs.color);
    if (!fg) continue;
    const cands = candidateBgs(el);
    const solidFg = fg.a < 0.999 ? over(fg, cands[0]) : fg;
    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    let worst = Infinity;
    let worstBg = cands[0];
    for (const bg of cands) {
      const r = ratio(solidFg, bg);
      if (r < worst) {
        worst = r;
        worstBg = bg;
      }
    }
    if (worst < need) {
      const key = el.tagName + '.' + String(el.className).slice(0, 50) + '|' + Math.round(size);
      if (contrastSeen.has(key)) continue;
      contrastSeen.add(key);
      report.lowContrast.push({
        sel: key,
        size: Math.round(size),
        ratio: Math.round(worst * 100) / 100,
        need,
        color: cs.color,
        against: 'rgb(' + Math.round(worstBg.r) + ', ' + Math.round(worstBg.g) + ', ' + Math.round(worstBg.b) + ')',
      });
    }
  }

  for (const img of document.querySelectorAll('img')) {
    report.images.push({
      src: img.currentSrc || img.src,
      ok: img.complete && img.naturalWidth > 0,
      w: img.naturalWidth,
      loading: img.loading,
      readyState: img.readyState,
      srcset: Boolean(img.getAttribute('srcset')),
      alt: img.getAttribute('alt'),
    });
  }

  const grab = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { fontSize: Math.round(parseFloat(cs.fontSize) * 10) / 10, lineHeight: cs.lineHeight, weight: cs.fontWeight, tracking: cs.letterSpacing, width: Math.round(r.width), top: Math.round(r.top + window.scrollY) };
  };
  report.sizes.hero = grab('.sk-lp-display--xl');
  report.sizes.h2 = grab('.sk-lp-head .sk-lp-display');
  report.sizes.body = grab('.sk-lp-lead');
  report.sizes.areaName = grab('.sk-lp-area__name');
  report.sizes.mentorName = grab('.sk-lp-mentor__name');
  report.sizes.stepTitle = grab('.sk-lp-step__title');
  report.sizes.final = grab('.sk-lp-display--final');

  for (const h of document.querySelectorAll('h1, h2, h3')) {
    report.headings.push({ level: h.tagName, text: (h.textContent || '').trim().slice(0, 60) });
  }

  // --- art-direction critique ---------------------------------------------
  // The section rhythm, measured rather than eyeballed: for each band, the first
  // opaque colour actually painted behind it, its padding, the type sizes it
  // sets, and the colour of its own headline. This is what says whether the
  // scroll alternates deliberately or merely drifts.
  /**
   * The colour a band actually reads as. A dark section paints a gradient over a
   * colour, so the gradient's own stops are the honest answer, not the colour
   * behind it — reporting the ancestor's white would make every band look like
   * paper and hide exactly the rhythm this check exists to measure.
   */
  const surfaceOf = (el) => {
    let node = el;
    while (node && node !== document.documentElement) {
      const cs = getComputedStyle(node);
      const stops = cs.backgroundImage.match(COLOR_FN);
      if (stops) {
        const c = parse(stops[0]);
        if (c) return c;
      }
      const flat = parse(cs.backgroundColor);
      if (flat && flat.a === 1) return flat;
      node = node.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };

  const bands = Array.from(document.querySelectorAll('main > section, footer'));
  report.rhythm = bands.map((s) => {
    const cs = getComputedStyle(s);
    const r = s.getBoundingClientRect();
    const solid = surfaceOf(s);
    const heading = s.querySelector('h1, h2');
    const headCs = heading ? getComputedStyle(heading) : null;
    const body = s.querySelector('.sk-lp-lead, .sk-lp-body, .sk-lp-state__text');
    return {
      id: s.id || (s.className || '').split(' ')[0],
      top: Math.round(r.top + window.scrollY),
      height: Math.round(r.height),
      padTop: Math.round(parseFloat(cs.paddingTop)),
      surface: [solid.r, solid.g, solid.b].map((v) => Math.round(v)).join(','),
      wash: cs.backgroundImage !== 'none',
      headSize: headCs ? Math.round(parseFloat(headCs.fontSize)) : null,
      headColor: headCs ? headCs.color : null,
      bodyColor: body ? getComputedStyle(body).color : null,
      headline: heading ? (heading.textContent || '').trim().slice(0, 44) : '',
    };
  });

  // Every action the page offers, with the band it sits in, so the conversion
  // rule can be checked as a list rather than as a memory.
  report.actions = Array.from(document.querySelectorAll('a, button')).map((el) => {
    const label = (el.textContent || '').trim().replace(/\\s+/g, ' ');
    if (!label) return null;
    const band = el.closest('section, footer, header');
    return {
      label: label.slice(0, 40),
      band: band ? (band.id || band.className.split(' ')[0] || band.tagName) : '?',
      kind: el.tagName,
    };
  }).filter(Boolean);

  report.sections = Array.from(document.querySelectorAll('main > section, main > div, footer')).map((s) => {
    const r = s.getBoundingClientRect();
    return { tag: s.tagName, id: s.id || '', h: Math.round(r.height), bg: getComputedStyle(s).backgroundColor };
  });

  /**
   * Touch targets, at the WCAG 2.2 minimum of 24 CSS pixels rather than a larger
   * invented number: inline prose links are exempt from that criterion, so
   * anything reported here is a standalone control a finger would miss.
   */
  report.smallTargets = Array.from(
    document.querySelectorAll('a[href], button:not([disabled])')
  )
    .filter((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (el.closest('p')) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.height < 24 || r.width < 24);
    })
    .map((el) => {
      const r = el.getBoundingClientRect();
      return {
        label: (el.getAttribute('aria-label') || el.textContent || el.tagName)
          .trim()
          .replace(/\\s+/g, ' ')
          .slice(0, 30),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    });

  report.pageHeight = Math.round(document.documentElement.scrollHeight);
  report.heroHeight = Math.round((document.querySelector('.sk-lp-hero') || { getBoundingClientRect: () => ({ height: 0 }) }).getBoundingClientRect().height);
  report.heroCtas = document.querySelectorAll('.sk-lp-hero__actions button').length;

  /**
   * Where the action actually sits. A hero can be the right height and still
   * push its own button below the fold, so the button's offset is measured, not
   * inferred from the section height.
   */
  const heroCta = document.querySelector('.sk-lp-hero__actions button');
  report.heroCtaBottom = heroCta ? Math.round(heroCta.getBoundingClientRect().bottom) : null;
  report.heroMediaTop = Math.round(
    (document.querySelector('.sk-lp-hero__media') || { getBoundingClientRect: () => ({ top: -1e6 }) }).getBoundingClientRect().top
  );
  report.viewportH = window.innerHeight;
  report.areaCards = document.querySelectorAll('.sk-lp-area').length;
  report.mentorCards = document.querySelectorAll('.sk-lp-mentor').length;
  report.steps = document.querySelectorAll('.sk-lp-step').length;
  report.trustItems = document.querySelectorAll('.sk-lp-trust__item').length;
  return report;
})()`;

function cdpConnect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => resolve(ws);
    ws.onerror = (e) => reject(new Error('ws error ' + e.message));
  });
}

function send(ws, id, method, params) {
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id !== id) return;
      ws.removeEventListener('message', onMessage);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => reject(new Error('timeout ' + method)), 45000);
  });
}

const profile = mkdtempSync(join(tmpdir(), 'lp-audit-'));
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const cleanup = () => {
  try { chrome.kill(); } catch {}
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
};
process.on('exit', cleanup);

async function waitForDevtools() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      if (res.ok) return res.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('devtools never became reachable');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await waitForDevtools();
  const version = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json();
  console.log(`browser: ${version.Browser}\nurl: ${URL_UNDER_TEST}\n`);

  const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  const ws = await cdpConnect(page.webSocketDebuggerUrl);

  let id = 0;
  const consoleErrors = [];
  await send(ws, ++id, 'Runtime.enable');
  await send(ws, ++id, 'Log.enable');

  for (const vp of VIEWPORTS) {
    await send(ws, ++id, 'Emulation.setDeviceMetricsOverride', {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: 1,
      mobile: vp.width < 700,
    });

    /**
     * Emulate the pointer and hover capabilities of the device being tested.
     *
     * Without this the narrow viewports are a small desktop, and the `@media
     * (hover: none)` rules that give text links a finger-sized target never
     * apply — so the touch layout would go unmeasured while the audit claimed to
     * have covered it.
     */
    await send(ws, ++id, 'Emulation.setEmulatedMedia', {
      features: [
        { name: 'hover', value: vp.width < 700 ? 'none' : 'hover' },
        { name: 'pointer', value: vp.width < 700 ? 'coarse' : 'fine' },
        { name: 'any-hover', value: vp.width < 700 ? 'none' : 'hover' },
        { name: 'any-pointer', value: vp.width < 700 ? 'coarse' : 'fine' },
      ],
    });

    await send(ws, ++id, 'Page.navigate', { url: URL_UNDER_TEST });
    await sleep(2600);

    // Trigger every reveal by walking the page, then return to the top.
    await send(ws, ++id, 'Runtime.evaluate', {
      expression: `(async () => {
        const step = window.innerHeight * 0.7;
        for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
          window.scrollTo(0, y);
          await new Promise(r => setTimeout(r, 130));
        }
        window.scrollTo(0, 0);
        await new Promise(r => setTimeout(r, 500));
      })()`,
      awaitPromise: true,
    });
    await sleep(900);

    /**
     * Below-the-fold images are lazily loaded and decode asynchronously, so a
     * fixed wait leaves a race: the audit reports images as broken that are
     * merely still in flight, and the failure moves between runs because the
     * lazy fetch depends on exactly when the scroll passed each element.
     *
     * A broken-image check should answer "does this URL resolve?", so every
     * image is made eager first and then waited on for real, with a ceiling so
     * one genuinely missing file cannot hang the run.
     */
    await send(ws, ++id, 'Runtime.evaluate', {
      expression: `(async () => {
        for (const img of document.images) img.loading = 'eager';
        const deadline = performance.now() + 10000;
        const pending = () => Array.from(document.images).filter(i => !i.complete || i.naturalWidth === 0);
        while (pending().length && performance.now() < deadline) {
          await new Promise(r => setTimeout(r, 120));
        }
        await new Promise(r => requestAnimationFrame(() => r(null)));
      })()`,
      awaitPromise: true,
    });
    await sleep(400);

    /**
     * Wait for the data, not just the pictures. The areas and mentor sections
     * render skeletons while their reads are in flight, so measuring too early
     * reports a catalogue that has not arrived yet as an empty page.
     */
    await send(ws, ++id, 'Runtime.evaluate', {
      expression: `(async () => {
        const deadline = performance.now() + 10000;
        const settled = () =>
          !document.querySelector('.sk-lp-skeleton') &&
          document.querySelector('#areas, #mentors');
        while (!settled() && performance.now() < deadline) {
          await new Promise(r => setTimeout(r, 150));
        }
      })()`,
      awaitPromise: true,
    });

    /**
     * Tab through the page with real key events and read the ring at each stop.
     * A pass over the document (measure everything, once) cannot do this: the ring
     * only exists while an element holds focus, and `:focus-visible` only applies
     * when the focus came from the keyboard.
     */
    await send(ws, ++id, 'Runtime.evaluate', {
      expression: 'document.body.focus(); if (document.activeElement) document.activeElement.blur(); null',
      returnByValue: true,
    });

    const FOCUS_STOPS = 46;
    const focusStops = [];
    for (let i = 0; i < FOCUS_STOPS; i += 1) {
      for (const type of ['rawKeyDown', 'char', 'keyUp']) {
        await send(ws, ++id, 'Input.dispatchKeyEvent', {
          type,
          windowsVirtualKeyCode: 9,
          key: 'Tab',
          code: 'Tab',
          nativeVirtualKeyCode: 9,
        });
      }
      const probe = await send(ws, ++id, 'Runtime.evaluate', {
        expression: STEP_FOCUS,
        returnByValue: true,
      });
      if (probe.result && probe.result.value) focusStops.push(probe.result.value);
    }

    // The Tab walk scrolls the page to whatever it focuses. Return to the top so
    // the geometry measured below is the geometry a visitor actually lands on.
    await send(ws, ++id, 'Runtime.evaluate', {
      expression: 'window.scrollTo(0, 0); null',
      returnByValue: true,
    });
    await sleep(500);

    const result = await send(ws, ++id, 'Runtime.evaluate', {
      expression: AUDIT,
      returnByValue: true,
    });
    if (!result.result || result.result.value === undefined) {
      throw new Error(
        'the page-side audit threw: ' + JSON.stringify(result.exceptionDetails ?? result)
      );
    }
    const r = result.result.value;
    r.focusStops = focusStops;

    const invisibleRing = focusStops.filter((s) => s.worst !== undefined && s.worst < 1.35);
    const unringed = focusStops.filter((s) => s.worst === undefined);

    const problems = [];
    if (r.overflowX > 0) problems.push(`horizontal overflow ${r.overflowX}px`);
    if (r.offenders.length) problems.push(`${r.offenders.length} element(s) outside viewport`);
    if (r.clipped.length) problems.push(`${r.clipped.length} clipped text block(s)`);
    if (r.lowContrast.length) problems.push(`${r.lowContrast.length} contrast failure(s)`);
    if (invisibleRing.length) problems.push(`${invisibleRing.length} invisible focus ring(s)`);
    if (unringed.length) problems.push(`${unringed.length} focus stop(s) with no ring`);
    if (r.smallTargets.length && vp.width < 700) {
      problems.push(`${r.smallTargets.length} tap target(s) under 24px`);
    }
    const broken = r.images.filter((i) => !i.ok);
    if (broken.length) problems.push(`${broken.length} broken image(s)`);
    if (r.mentorCards === 0 && !r.areaCards) problems.push('no data sections rendered');
    if (r.heroCtaBottom !== null && r.heroCtaBottom > r.viewportH) {
      problems.push(`hero CTA below the fold (${r.heroCtaBottom}px > ${r.viewportH}px)`);
    }

    /**
     * The conversion rule, enforced rather than remembered: one destination for
     * "Find a Mentor" everywhere, and the mentor-signup route reachable from the
     * footer only.
     */
    const stray = r.actions.filter(
      (a) => /become a mentor/i.test(a.label) && a.band !== 'sk-lp-footer'
    );
    if (stray.length) problems.push(`${stray.length} "Become a Mentor" outside the footer`);

    console.log(`── ${vp.name} ${vp.width}x${vp.height} ${problems.length ? '✗ ' + problems.join(', ') : '✓ clean'}`);
    console.log(`   page ${r.pageHeight}px | hero ${r.heroHeight}px | hero CTAs ${r.heroCtas} | areas ${r.areaCards} | mentors ${r.mentorCards} | steps ${r.steps} | trust ${r.trustItems}`);
    console.log(`   fold  viewport ${r.viewportH}px | hero CTA bottom ${r.heroCtaBottom}px | hero photo top ${r.heroMediaTop}px`);
    console.log(`   type  hero ${r.sizes.hero?.fontSize}px/${r.sizes.hero?.weight}/${r.sizes.hero?.tracking}  h2 ${r.sizes.h2?.fontSize}px  final ${r.sizes.final?.fontSize}px  body ${r.sizes.body?.fontSize}px  area ${r.sizes.areaName?.fontSize}px  mentor ${r.sizes.mentorName?.fontSize}px  step ${r.sizes.stepTitle?.fontSize}px`);
    if (r.offenders.length) console.log('   outside:', JSON.stringify(r.offenders.slice(0, 5)));
    if (r.clipped.length) console.log('   clipped:', JSON.stringify(r.clipped.slice(0, 5)));
    if (r.lowContrast.length) console.log('   contrast:', JSON.stringify(r.lowContrast.slice(0, 8)));
    if (invisibleRing.length) console.log('   focus ring:', JSON.stringify(invisibleRing.slice(0, 6)));
    if (unringed.length) console.log('   no ring:', JSON.stringify(unringed.slice(0, 6)));
    if (r.smallTargets.length) console.log('   tap target:', JSON.stringify(r.smallTargets.slice(0, 8)));
    if (broken.length) console.log('   broken:', JSON.stringify(broken.slice(0, 4)));
    if (stray.length) console.log('   stray CTA:', JSON.stringify(stray));

    if (vp.width === 1440 || vp.width === 390) {
      console.log('   rhythm:');
      for (const b of r.rhythm) {
        console.log(
          `     ${String(b.top).padStart(6)}  h${String(b.height).padStart(5)}  pad ${String(b.padTop).padStart(4)}  ` +
            `${b.surface.padEnd(13)} ${b.wash ? 'wash ' : 'flat '}  head ${String(b.headSize).padStart(3)}px ${b.headColor}  ${b.headline}`
        );
      }
      if (vp.width === 1440) {
        console.log('   actions:');
        for (const a of r.actions) console.log(`     [${a.band}] ${a.kind}: ${a.label}`);
      }
    }
    console.log('');
  }

  /**
   * Reduced motion, on the real thing.
   *
   * The risk is not that the page animates too much; it is that it animates in a
   * way that hides content from someone who asked for stillness. Every entrance
   * primitive in this page starts its children at opacity 0, so if the reduced
   * path ever failed to resolve them, the visitor would get a blank page and no
   * error. This loads the page with the preference set and asserts that nothing
   * is left invisible or displaced.
   */
  await send(ws, ++id, 'Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-reduced-motion', value: 'reduce' },
      { name: 'hover', value: 'hover' },
      { name: 'pointer', value: 'fine' },
    ],
  });
  await send(ws, ++id, 'Page.navigate', { url: URL_UNDER_TEST });
  await sleep(2800);

  const reduced = await send(ws, ++id, 'Runtime.evaluate', {
    expression: `(() => {
      const hidden = [];
      for (const el of document.querySelectorAll('.sk-lp-shell *')) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        if (el.closest('[aria-hidden="true"]')) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const opacity = parseFloat(cs.opacity);
        const moved = /matrix\\(1, 0, 0, 1, 0, -?[0-9.]+\\)/.test(cs.transform);
        if (opacity < 0.99 || moved) {
          hidden.push({
            sel: el.tagName + '.' + String(el.className).slice(0, 44),
            opacity,
            transform: cs.transform,
          });
        }
      }
      return {
        matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
        count: hidden.length,
        sample: hidden.slice(0, 6),
        heroCtas: document.querySelectorAll('.sk-lp-hero__actions button').length,
      };
    })()`,
    returnByValue: true,
  });
  const rm = reduced.result.value;

  if (!rm.matches) {
    console.log('reduced motion  ✗ the preference did not reach the page');
  } else if (rm.count > 0) {
    console.log('reduced motion  ✗ ' + rm.count + ' element(s) left hidden or displaced');
    console.log('   ' + JSON.stringify(rm.sample));
  } else {
    console.log(`reduced motion  ✓ clean — every entrance resolved, ${rm.heroCtas} hero CTA`);
  }

  if (consoleErrors.length) console.log('console errors:', JSON.stringify(consoleErrors, null, 2));

  ws.close();
  cleanup();
  process.exit(0);
})().catch((err) => {
  console.error('audit failed:', err);
  cleanup();
  process.exit(1);
});
