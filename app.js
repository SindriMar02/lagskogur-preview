/* Hótel Rangá — Sobha Privy Collection engine transplant
   scroller (lerp .1 + gravity wells + snap) · parallax-V-E keyframe engine ·
   reveal system · split titles · lazy media · preloader · themed header · menu ·
   sticky slider · WebGL rings · map · quotes cursor · footer mask */
/* three.js is 671KB. Importing it at the top costs that on EVERY page, including
   the four room pages that have no WebGL at all. Load it on demand instead, the
   first time a ring chapter comes within range, and let the chapter loader cover
   the wait. */
let THREE = null, texLoader = null, threeReq = null;
const ensureThree = () => threeReq || (threeReq = import('three').then(m => { THREE = m; texLoader = new m.TextureLoader(); return m; }));

const html = document.documentElement;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const isMac = /Mac/.test(navigator.platform);
const isTouch = matchMedia('(hover: none) and (pointer: coarse)').matches;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
/* Match the CSS breakpoint EXACTLY. `innerWidth >= 768` is not the same test:
   when content overflows horizontally, mobile Chrome shrink-to-fits and reports a
   ballooned innerWidth (measured 1500 on a 375px iPhone), so the JS took the
   desktop path while the CSS took the mobile one — which produced the very
   overflow that caused the zoom-out. matchMedia cannot drift from the stylesheet. */
const mdUp = () => matchMedia('(min-width: 768px)').matches;
const SMOOTH = !isTouch && !reduced && mdUp();
html.classList.add(SMOOTH ? 'has-scroll-smooth' : 'no-scroll-smooth');
if (isTouch) html.classList.add('no-hover');

/* ---------- viewport ---------- */
const probe = document.createElement('div');
probe.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:100svh;pointer-events:none;visibility:hidden';
document.body.appendChild(probe);
let VH = probe.offsetHeight || innerHeight, VW = document.documentElement.clientWidth || innerWidth;
const measureViewport = () => { VH = probe.offsetHeight || innerHeight; VW = document.documentElement.clientWidth || innerWidth; };
const spacing = () => parseFloat(getComputedStyle(html).getPropertyValue('--spacing')) || 20;

/* ---------- easings ---------- */
const E = {
  linear: t => t,
  easeInQuad: t => t * t, easeOutQuad: t => t * (2 - t), easeInOutQuad: t => t < .5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  easeInCubic: t => t ** 3, easeOutCubic: t => 1 - (1 - t) ** 3, easeInOutCubic: t => t < .5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2,
  easeOutExpo: t => t === 1 ? 1 : 1 - 2 ** (-10 * t),
  easeSection: t => 2 * t - t * t, easeSectionInverse: t => t * t,
};
const bezier = (x1, y1, x2, y2) => {
  const A = (a1, a2) => 1 - 3 * a2 + 3 * a1, B = (a1, a2) => 3 * a2 - 6 * a1, C = a1 => 3 * a1;
  const calc = (t, a1, a2) => ((A(a1, a2) * t + B(a1, a2)) * t + C(a1)) * t;
  const slope = (t, a1, a2) => 3 * A(a1, a2) * t * t + 2 * B(a1, a2) * t + C(a1);
  return x => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) { const s = slope(t, x1, x2); if (!s) break; t -= (calc(t, x1, x2) - x) / s; }
    return calc(t, y1, y2);
  };
};
const easeSnap = bezier(.25, 0, .35, 1);
const easeHouse = bezier(.7, 0, .3, 1);

/* ---------- doc positions (layout, transform-free) ---------- */
const docTop = el => { let y = 0; while (el) { y += el.offsetTop; el = el.offsetParent; } return y; };
const docLeft = el => { let x = 0; while (el) { x += el.offsetLeft; el = el.offsetParent; } return x; };

/* ============================================================
   SCROLLER
   ============================================================ */
const scroller = (() => {
  const s = { y: scrollY, target: scrollY, limit: 0, moving: false, wells: [], snaps: [], listeners: [] };
  const LERP = .1, BAND = () => VH * .25;
  let snapTimer = 0, tween = null, lastWheel = 0, expected = -1;
  const setLimit = () => { s.limit = Math.max(0, document.scrollingElement.scrollHeight - innerHeight); };
  const wellFactor = y => {
    let f = 1;
    for (const w of s.wells) { const d = Math.abs(y - w); if (d < BAND()) f = Math.min(f, clamp((d / BAND() + .35) / 1.35)); }
    return f;
  };
  const inBand = y => s.wells.some(w => Math.abs(y - w) < BAND());
  const onWheel = e => {
    if (!SMOOTH || html.classList.contains('with-modal')) return;
    e.preventDefault();
    let d = e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? VH : 1);
    if (isMac) d *= .4;
    if (inBand(s.target)) d *= .25;
    s.target = clamp(s.target + d, 0, s.limit);
    tween = null; lastWheel = performance.now();
    clearTimeout(snapTimer); snapTimer = setTimeout(trySnap, 250);
  };
  const onKey = e => {
    if (!SMOOTH || html.classList.contains('with-modal')) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    let d = 0;
    if (e.key === 'ArrowDown') d = 240; else if (e.key === 'ArrowUp') d = -240;
    else if (e.key === ' ' || e.key === 'PageDown') d = VH * (e.shiftKey ? -1 : 1); else if (e.key === 'PageUp') d = -VH;
    else if (e.key === 'Home') { s.target = 0; } else if (e.key === 'End') { s.target = s.limit; } else return;
    e.preventDefault(); s.target = clamp(s.target + d, 0, s.limit); tween = null;
  };
  const trySnap = () => {
    if (!s.snaps.length) return;
    const y = s.target, pts = s.snaps;
    const first = pts[0].y, last = pts[pts.length - 1].y;
    if (y < first - VH * .5 || y > last + VH * .5) return;
    const lastScrollable = pts[pts.length - 1].scrollable;
    if (lastScrollable && y > pts[pts.length - 2].y + VH * .5) return;
    let best = pts[0]; for (const p of pts) if (Math.abs(p.y - y) < Math.abs(best.y - y)) best = p;
    if (Math.abs(best.y - y) < 1) return;
    tweenTo(best.y, 1000, easeSnap);
  };
  const tweenTo = (to, dur, ease = easeHouse) => {
    const from = s.y, t0 = performance.now();
    s.target = to; tween = { from, to, t0, dur, ease };
  };
  const syncExternal = () => {
    const sy = scrollY;
    if (Math.abs(sy - expected) > 1.5 && !tween) { s.y = s.target = sy; }
  };
  /* Snap the scroll position to the device-pixel grid. The browser positions
     `position:sticky` layers on whole device pixels, while our parallax writes
     transforms from the raw fractional lerp value — the mismatch between the two
     is what read as jitter/shimmer on the pinned sections. Snapping ONCE here
     means the sticky layer and every transform derived from `scroller.y` land on
     the same grid. */
  const DPR = () => Math.max(1, Math.min(devicePixelRatio || 1, 3));
  const snap = v => Math.round(v * DPR()) / DPR();
  const write = () => { s.y = snap(s.y); expected = Math.round(s.y); window.scrollTo(0, s.y); };
  const tick = () => {
    if (!SMOOTH) { s.y = s.target = scrollY; return; }
    if (tween) {
      const t = clamp((performance.now() - tween.t0) / tween.dur);
      s.y = lerp(tween.from, tween.to, tween.ease(t));
      if (t >= 1) tween = null;
      write();
      s.moving = true;
    } else {
      const diff = s.target - s.y;
      if (Math.abs(diff) > .5) {
        s.y += diff * LERP * wellFactor(s.y);
        write();
        s.moving = true;
      } else if (s.moving) { s.y = s.target; write(); s.moving = false; }
    }
    html.classList.toggle('has-scroll-scrolling', s.moving);
  };
  const scrollToEl = (el, offset = 0) => {
    const to = clamp(docTop(el) + offset, 0, s.limit);
    if (!SMOOTH) { window.scrollTo({ top: to, behavior: reduced ? 'auto' : 'smooth' }); return; }
    const dist = Math.abs(to - s.y);
    if (dist > VH * 2) {
      const ov = $('#page-overlay'); ov.classList.add('is-on');
      setTimeout(() => { s.y = s.target = to; expected = Math.round(to); window.scrollTo(0, to); tween = null; setTimeout(() => ov.classList.remove('is-on'), 80); }, 420);
    } else tweenTo(to, 1000, easeHouse);
  };
  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKey);
  window.addEventListener('scroll', syncExternal, { passive: true });
  return Object.assign(s, { tick, setLimit, scrollToEl, tweenTo, wellFactor, get isTweening() { return !!tween; } });
})();

/* custom scrollbar */
(() => {
  if (!SMOOTH) return;
  const bar = $('#scrollbar'), thumb = $('.c-scrollbar__thumb', bar);
  let drag = false, startY = 0, startScroll = 0;
  const update = () => {
    const total = document.scrollingElement.scrollHeight;
    const h = Math.max(40, VH * VH / total);
    thumb.style.height = h + 'px';
    thumb.style.transform = `translateY(${(scroller.y / (scroller.limit || 1)) * (VH - h)}px)` + (bar.matches(':hover') || drag ? ' scaleX(1.45)' : '');
  };
  thumb.addEventListener('pointerdown', e => { drag = true; startY = e.clientY; startScroll = scroller.y; bar.classList.add('is-dragging'); thumb.setPointerCapture(e.pointerId); e.preventDefault(); });
  thumb.addEventListener('pointermove', e => { if (!drag) return; const h = thumb.offsetHeight; const dy = e.clientY - startY; const to = clamp(startScroll + dy / (VH - h) * scroller.limit, 0, scroller.limit); scroller.y = scroller.target = to; window.scrollTo(0, to); });
  thumb.addEventListener('pointerup', () => { drag = false; bar.classList.remove('is-dragging'); });
  scroller.listeners.push(update);
})();

/* ============================================================
   PARALLAX ENGINE — parallax-<V>-<E>
   key scroll = measureTop + measureH*E/100 - VH*V/100 (+ off*VH)
   ============================================================ */
const sp = () => spacing();
const PATTERNS = {
  sectionOutTiny: { measure: 'self', keys: el => el.classList.contains('sticky--under-next')
      ? [{ v: 200, e: 100, p: { transform: 'translateY(0svh)' } }, { v: 100, e: 100, p: { transform: 'translateY(-10svh)' } }]
      : [{ v: 100, e: 100, p: { transform: 'translateY(0svh)' } }, { v: 0, e: 100, p: { transform: 'translateY(10svh)' } }], clamp: true },
  imageMove: { measure: 'self', target: 'img', keys: () => [{ v: 100, e: 0, p: { transform: 'translateY(-16.667%)' } }, { v: 0, e: 100, p: { transform: 'translateY(0%)' } }], clamp: true, mobile: true },
  backgroundMove: { measure: 'closest:.section', target: 'img', keys: () => [{ v: 100, e: 0, p: { transform: 'scale(1.2) translateY(-8.33%)' } }, { v: 0, e: 100, p: { transform: 'scale(1.2) translateY(8.33%)' } }], clamp: true, mobile: true },
  landingLuxuryTitle: { measure: 'closest:.section', keys: () => [{ v: 100, e: 0, p: { transform: `translateY(${-5 * sp()}px)` }, easing: 'easeOutQuad' }, { v: 0, e: 0, p: { transform: 'translateY(0px)' } }], clamp: true },
  landingLuxuryMoveSideDesktop: { measure: 'closest:.section', keys: () => [{ v: 100, e: 0, p: { transform: `translateY(${-10 * sp()}px)` } }, { v: 25, e: 0, p: { transform: `translateY(${-2.5 * sp()}px)` }, easing: 'easeOutQuad' }, { v: 0, e: 0, p: { transform: 'translateY(0px)' } }], clamp: true },
  landingLuxuryScaleCenterDesktop: { measure: 'closest:.sticky', keys: () => [{ v: 65, e: 0, p: { transform: 'scale(1)', 'clip-path': 'inset(0% 0)' } }, { v: 0, e: 0, off: 1, p: { transform: 'scale(1.4)', 'clip-path': 'inset(10% 0)' } }], easing: 'easeInOutQuad', clamp: true },
  landingLuxuryScaleSideLeftDesktop: { measure: 'closest:.sticky', keys: () => [{ v: 65, e: 0, p: { transform: 'translateX(0vw)' } }, { v: 0, e: 0, off: 1, p: { transform: 'translateX(-8.33vw)' } }], easing: 'easeInOutQuad', clamp: true },
  landingLuxuryScaleSideRightDesktop: { measure: 'closest:.sticky', keys: () => [{ v: 65, e: 0, p: { transform: 'translateX(0vw)' } }, { v: 0, e: 0, off: 1, p: { transform: 'translateX(8.33vw)' } }], easing: 'easeInOutQuad', clamp: true },
  landingSensationBackground: { measure: 'closest:.section', keys: () => [{ v: 100, e: 0, p: { transform: 'translateY(-10svh)' } }, { v: 0, e: 0, p: { transform: 'translateY(0svh)' } }], clamp: true },
  landingThreeWorldsBackground: { measure: 'closest:.section', keys: () => [{ v: 100, e: 0, p: { transform: 'translateY(-40svh)' } }, { v: -200, e: 0, p: { transform: 'translateY(80svh)' } }], clamp: false },
  landingThreeWorldsTitle: { measure: 'closest:.sticky', keys: () => [{ v: 50, e: 0, p: { transform: 'translateY(-8svh)' }, easing: 'easeOutQuad' }, { v: 0, e: 0, p: { transform: 'translateY(0svh)' } }, { v: -100, e: 0, p: { transform: 'translateY(0svh)' }, easing: 'easeInOutQuad' }, { v: -200, e: 0, p: { transform: 'translateY(-61.4svh)' } }], clamp: true },
  landingThreeWorldsWebGl: { measure: 'closest:.sticky', keys: () => [{ v: 50, e: 0, p: { transform: 'translateY(-25svh)' } }, { v: 0, e: 0, p: { transform: 'translateY(0svh)' } }], clamp: true },
  // unused since the ring became a selector: it clipped the canvas for the reference's
  // wipe-shader stage, and left on it simply chopped the room images in half
  landingThreeWorldsWebGlClip: { measure: 'closest:.sticky', keys: () => [{ v: -100, e: 0, p: { 'clip-path': 'inset(0 0 0% 0)' } }, { v: -200, e: 0, p: { 'clip-path': 'inset(0 0 50% 0)' } }], clamp: true },
  landingTenetsBackground: { measure: 'closest:.sticky', keys: (el) => [{ v: 0, e: 0, p: { transform: 'translateY(0%)' } }, { v: 100, e: 100, p: { transform: `translateY(${-((el.offsetHeight - VH) / el.offsetHeight) * 100}%)` } }], clamp: true, mobile: true },
  landingExpansiveCard: { measure: 'closest:.section', keys: () => [{ v: 0, e: 0, p: { transform: 'translate(-50%,-50%) translateY(-100svh)' } }, { v: -60, e: 0, p: { transform: 'translate(-50%,-50%) translateY(0svh)' } }], clamp: true },
  landingExpansiveCardScale: { measure: 'closest:.section', keys: () => [{ v: 0, e: 0, p: { transform: 'scale(0.3333)' } }, { v: -60, e: 0, p: { transform: 'scale(1)' } }], easing: 'easeInOutQuad', clamp: true },
  landingExpansiveCardText: { measure: 'closest:.section', keys: () => [{ v: 0, e: 0, p: { transform: 'scale(3)' } }, { v: -60, e: 0, p: { transform: 'scale(1)' } }], easing: 'easeInOutQuad', clamp: true },
  landingExpansiveCardContent: { measure: 'closest:.section', keys: () => [{ v: -30, e: 0, p: { opacity: '0' } }, { v: -60, e: 0, p: { opacity: '1' } }], clamp: true },
  landingExpansiveCardVideo: { measure: 'closest:.section', keys: () => [{ v: 0, e: 0, p: { 'clip-path': 'inset(0 26.66%)', transform: 'scale(1.25)' } }, { v: -60, e: 0, p: { 'clip-path': 'inset(0 0%)', transform: 'scale(1)' } }], easing: 'easeInOutQuad', clamp: true },
  landingHandpickedTitle: { measure: 'closest:.sticky', keys: () => [{ v: -35, e: 0, p: { opacity: '0', transform: 'translateY(20svh)' }, easing: 'easeSection' }, { v: -75, e: 0, p: { opacity: '1', transform: 'translateY(0svh)' } }, { v: -130, e: 0, p: { opacity: '1', transform: 'translateY(0svh)' }, easing: 'easeSectionInverse' }, { v: -170, e: 0, p: { opacity: '0', transform: 'translateY(-20svh)' } }], clamp: true },
  /* Holt's tuning (3.05 -> 2.3) framed a dense city grid, where a tight crop still
     reads as streets. This map covers roughly forty kilometres of open country, and at
     that magnification the viewport lands on a featureless hillside with no pin, no
     route and no coastline in frame. Pulled back so the region is legible. */
  landingLocationMapDesktop: { measure: 'closest:.sticky', keys: () => [
      { v: 100, e: 0, p: { transform: 'translate(-50%,-50%) translate(6%,-26%) scale(1.85)' } },
      { v: 0, e: 0, p: { transform: 'translate(-50%,-50%) translate(4%,-12%) scale(1.85)' } },
      /* settle where all five dots sit inside the frame: the sheet is 5:4 and the dots
         span 68% of its height, so anything past ~1.1 crops Brún or Hrossholt */
      { v: -100, e: 0, p: { transform: 'translate(-50%,-50%) translate(0%,-1%) scale(.96)' } },
      { v: -420, e: 0, p: { transform: 'translate(-50%,-50%) translate(0%,-1%) scale(.96)' } }], clamp: true },
  landingLocationMapTitleDesktop: { measure: 'closest:.section', keys: () => [{ v: 0, e: 0, p: { opacity: '1' }, easing: 'easeOutQuad' }, { v: -100, e: 0, p: { opacity: '0' } }], clamp: true },
  landingLocationMapPinDesktop: { measure: 'closest:.section', keys: () => [{ v: 0, e: 0, p: { opacity: '0' } }, { v: -80, e: 0, p: { opacity: '0' } }, { v: -100, e: 0, p: { opacity: '1' } }], clamp: true, onUpdate: (el, p) => el.classList.toggle('is-seen', p > .99) },
  landingJourneyBackgroundDesktop: { measure: 'closest:.section', keys: () => [{ v: 0, e: 0, p: { transform: 'translateY(0svh)' } }, { v: 100, e: 100, p: { transform: 'translateY(250svh)' } }], clamp: false },
  registerBgMove: { measure: 'closest:.section', target: 'img', keys: () => [{ v: 100, e: 0, p: { transform: 'translateY(0svh)' } }, { v: 0, e: 100, p: { transform: 'translateY(-40svh)' } }], clamp: true, mobile: true },
  registerBgScale: { measure: 'closest:.section', target: 'img', keys: () => [{ v: 100, e: 0, p: { transform: 'scale(1.1)' } }, { v: 0, e: 100, p: { transform: 'scale(1)' } }], clamp: true, mobile: true },
  registerScreen: { measure: 'closest:.section', keys: () => [{ v: 100, e: 0, p: { transform: 'translateY(35svh)' } }, { v: 100, e: 100, p: { transform: 'translateY(0svh)' } }], clamp: true },
  landingExpansiveCarousel: { skip: true },
};

const NUM = /-?\d*\.?\d+(?:e[-+]?\d+)?/g;
const mixStr = (a, b, t) => {
  if (a === b) return a;
  const an = a.match(NUM) || [], bn = b.match(NUM) || [];
  if (an.length !== bn.length) return t < .5 ? a : b;
  let i = 0;
  return b.replace(NUM, () => { const v = lerp(parseFloat(an[i]), parseFloat(bn[i]), t); i++; return (Math.round(v * 10000) / 10000).toString(); });
};

const parallax = (() => {
  const groups = [];
  /* Every element we have ever written an inline style onto. Rebuilding the groups
     (on resize) drops the desktop-only patterns, but the styles they already wrote
     stayed on the element - so crossing the breakpoint left the heritage card with
     translateY(-100svh) and its title at scale(3). Clear before rebuilding. */
  const managed = new Set();
  const resolveMeasure = (el, spec, attr) => {
    if (spec === 'self') return el;
    if (spec && spec.startsWith('closest:')) return el.closest(spec.slice(8)) || el;
    if (attr) return el.closest(attr) || el;
    return el;
  };
  const build = () => {
    managed.forEach(el => { el.style.transform = ''; el.style.opacity = ''; el.style.removeProperty('clip-path'); delete el.dataset.pyOpacity; });
    managed.clear();
    groups.length = 0;
    const mobile = !mdUp();
    $$('[data-parallax-pattern]').forEach(el => {
      el.dataset.parallaxPattern.split(/\s+/).filter(Boolean).forEach(name => {
        const pat = PATTERNS[name];
        if (!pat || pat.skip) return;
        if (mobile && !pat.mobile) return;
        if (el.closest('.l-expansive-slider') && mobile) return;
        const measure = resolveMeasure(el, pat.measure, el.dataset.parallaxMeasure);
        const target = pat.target ? (el.matches(pat.target) ? el : $(pat.target, el)) : el;
        if (!target) return;
        groups.push({ el, target, measure, pat, name, keys: pat.keys(target, el), clamp: pat.clamp !== false, easing: pat.easing, onUpdate: pat.onUpdate, scroll: [] });
      });
    });
    // inline JSON variant
    $$('[data-parallax-100-0],[data-parallax-0-100]').forEach(el => {
      if (mobile) return;
      const keys = [];
      for (const a of el.attributes) {
        const m = a.name.match(/^data-parallax-(-?\d+)-(-?\d+)$/);
        if (m) keys.push({ v: +m[1], e: +m[2], p: JSON.parse(a.value) });
      }
      if (!keys.length) return;
      const measure = el.closest(el.dataset.parallaxMeasure || '.section') || el;
      groups.push({ el, target: el, measure, keys, clamp: el.dataset.parallaxClamp === 'true', scroll: [] });
    });
    measure();
  };
  const measure = () => {
    for (const g of groups) {
      const top = docTop(g.measure), h = g.measure.offsetHeight;
      if (g.pat && g.pat.keys.length >= 1 && (g.name === 'landingTenetsBackground')) g.keys = g.pat.keys(g.target, g.el);
      g.scroll = g.keys.map(k => top + h * (k.e || 0) / 100 - VH * (k.v || 0) / 100 + (k.off || 0) * VH);
      // sort by scroll
      const order = g.scroll.map((s, i) => i).sort((a, b) => g.scroll[a] - g.scroll[b]);
      g.sorted = order.map(i => ({ s: g.scroll[i], k: g.keys[i] }));
    }
  };
  const apply = (y) => {
    const acc = new Map();
    for (const g of groups) {
      const ks = g.sorted; if (!ks || ks.length < 2) continue;
      const first = ks[0].s, last = ks[ks.length - 1].s;
      let props;
      if (y <= first) { if (!g.clamp && y < first - VH * 3) continue; props = ks[0].k.p; }
      else if (y >= last) { props = ks[ks.length - 1].k.p; }
      else {
        let i = 0; while (i < ks.length - 2 && y > ks[i + 1].s) i++;
        const a = ks[i], b = ks[i + 1];
        let t = (y - a.s) / (b.s - a.s || 1);
        const ez = a.k.easing || g.easing; if (ez && E[ez]) t = E[ez](t);
        props = {};
        for (const p in b.k.p) props[p] = mixStr(a.k.p[p] ?? b.k.p[p], b.k.p[p], t);
      }
      // out-of-range visibility for non-clamped groups: keep extrapolation simple (hold)
      let a = acc.get(g.target); if (!a) { a = { transform: [], opacity: 1, other: {} }; acc.set(g.target, a); }
      for (const p in props) {
        if (p === 'transform') a.transform.push(props[p]);
        else if (p === 'opacity') a.opacity *= parseFloat(props[p]);
        else if (p === 'progress') { a.progress = parseFloat(props[p]); }
        else a.other[p] = props[p];
      }
      if (g.onUpdate) { const prog = clamp((y - first) / (last - first || 1)); g.onUpdate(g.el, prog); }
    }
    acc.forEach((a, el) => {
      managed.add(el);
      const st = el.style;
      if (a.transform.length) st.transform = a.transform.join(' ');
      if (a.opacity !== 1 || el.dataset.pyOpacity) { st.opacity = a.opacity; el.dataset.pyOpacity = '1'; }
      for (const p in a.other) st.setProperty(p, a.other[p]);
      if (a.progress !== undefined) el.dataset.progress = a.progress;
    });
  };
  // scroll progress helper for custom modules: progress of measure element between two keys
  const progressOf = (measureEl, v1, e1, v2, e2, y) => {
    const top = docTop(measureEl), h = measureEl.offsetHeight;
    const s1 = top + h * e1 / 100 - VH * v1 / 100, s2 = top + h * e2 / 100 - VH * v2 / 100;
    return clamp((y - s1) / (s2 - s1 || 1));
  };
  return { build, measure, apply, progressOf, groups };
})();

/* ============================================================
   SPLITTING
   ============================================================ */
const splitTitle = (el) => {
  if (el.dataset.split) return;
  el.dataset.split = 'title';
  const centred = el.matches('.text-center') || getComputedStyle(el).textAlign === 'center';
  const tokens = [];
  const walk = n => { n.childNodes.forEach(c => { if (c.nodeType === 3) { c.textContent.split(/(\s+)/).forEach(t => { if (/^\s+$/.test(t)) tokens.push({ sp: true }); else if (t) tokens.push({ w: t, lower: /[a-zà-ÿ]/.test(t) && t === t.toLowerCase(), em: !!c.parentElement.closest('em') }); }); } else if (c.tagName === 'BR') tokens.push({ br: true }); else walk(c); }); };
  walk(el);
  el.textContent = '';
  const words = [];
  tokens.forEach(t => {
    if (t.sp) { el.appendChild(document.createTextNode(' ')); return; }
    if (t.br) { const b = document.createElement('br'); b.dataset.forced = '1'; el.appendChild(b); words.push(b); return; }
    const w = document.createElement('span'); w.className = 'word' + (t.lower ? ' is-lower' : '') + (t.em ? ' is-em' : '');
    [...t.w].forEach(ch => { const c = document.createElement('span'); c.className = 'char'; c.textContent = ch; w.appendChild(c); });
    el.appendChild(w); words.push(w);
  });
  // line detection
  const lines = []; let cur = null, lastTop = null;
  words.forEach(w => {
    if (w.tagName === 'BR') { cur = null; lastTop = null; return; }
    const top = w.offsetTop;
    if (!cur || (lastTop !== null && Math.abs(top - lastTop) > 2)) { cur = []; lines.push(cur); }
    cur.push(w); lastTop = top;
  });
  el.textContent = '';
  const maxChars = Math.max(...lines.map(l => l.reduce((n, w) => n + w.children.length, 0) + l.length - 1));
  lines.forEach((l, li) => {
    const wrap = document.createElement('span'); wrap.className = 'line-wrap'; wrap.style.setProperty('--line-index', li);
    const chars = l.reduce((n, w) => n + w.children.length, 0) + l.length - 1;
    wrap.style.setProperty('--line-char-offset', centred ? (maxChars - chars) / 2 : 0);
    const line = document.createElement('span'); line.className = 'line';
    let ci = 0;
    l.forEach((w, wi) => {
      [...w.children].forEach(c => c.style.setProperty('--char-index', ci++));
      line.appendChild(w);
      if (wi < l.length - 1) { const s = document.createElement('span'); s.className = 'whitespace'; line.appendChild(s); ci++; }
    });
    wrap.appendChild(line); el.appendChild(wrap);
  });
  el.dataset.charTotal = maxChars;
};
const splitLines = (el) => {
  if (el.dataset.split) return;
  el.dataset.split = 'lines';
  const tokens = [];
  const walk = n => { n.childNodes.forEach(c => { if (c.nodeType === 3) c.textContent.split(/(\s+)/).forEach(t => { if (/^\s+$/.test(t)) tokens.push({ sp: true }); else if (t) tokens.push({ w: t }); }); else if (c.tagName === 'BR') tokens.push({ br: true }); else if (c.tagName === 'SPAN') tokens.push({ br: true }, { sub: c.cloneNode(true) }); else walk(c); }); };
  walk(el);
  el.textContent = '';
  const words = [];
  tokens.forEach(t => {
    if (t.sp) { el.appendChild(document.createTextNode(' ')); return; }
    if (t.br) { const b = document.createElement('br'); el.appendChild(b); words.push(b); return; }
    if (t.sub) { const w = document.createElement('span'); w.className = 'word'; w.style.display = 'block'; w.appendChild(t.sub); el.appendChild(w); words.push(w); return; }
    const w = document.createElement('span'); w.className = 'word'; w.textContent = t.w; el.appendChild(w); words.push(w);
  });
  const lines = []; let cur = null, lastTop = null;
  words.forEach(w => { if (w.tagName === 'BR') { cur = null; lastTop = null; return; } const top = w.offsetTop; if (!cur || (lastTop !== null && Math.abs(top - lastTop) > 2)) { cur = []; lines.push(cur); } cur.push(w); lastTop = top; });
  el.textContent = '';
  lines.forEach((l, li) => { const line = document.createElement('span'); line.className = 'line'; line.style.setProperty('--line-index', li); l.forEach((w, wi) => { line.appendChild(w); if (wi < l.length - 1) line.appendChild(document.createTextNode(' ')); }); el.appendChild(line); });
  el.dataset.lineTotal = lines.length;
};

/* ============================================================
   TRANSITION ENGINE
   ============================================================ */
const DUR = { rise: 800, title: 1400, subtitle: 1400, text: 1000, 'fade-in': 400, 'fade-out': 400, 'zoom-in': 400, 'slide-in-bottom': 400, 'slide-in-top': 400, 'slide-in': 1000, fast: 200, slow: 1000, block: 1600 };
/* Split into two halves so a reveal can be ARMED (split + inactive state applied)
   while the element is still hidden, and only RUN later. Doing both at once meant
   the finished text was on screen for the whole reveal delay before it animated. */
const prepareTransition = (el, names) => {
  const list = names.split(/\s+/).filter(Boolean);
  if (list.includes('title')) splitTitle(el);
  if (list.includes('text')) splitLines(el);
  const cls = [];
  list.forEach(n => cls.push('animation', `animation--${n}`, `animation--${n}--inactive`));
  el.classList.add(...cls, 'disable-transitions');
  void el.offsetWidth;                       // flush, so the inactive state is what paints
  return { list, cls };
};
const runTransition = (el, prepared, cb) => {
  const { list, cls } = prepared;
  let dur = Math.max(...list.map(n => DUR[n] || 400));
  if (list.includes('block')) dur = 1600; else if (list.includes('slow')) dur = 1000; else if (list.includes('fast')) dur = 200;
  if (list.includes('title')) dur = 1400 + (+el.dataset.charTotal || 0) * 39;
  if (list.includes('text')) dur = 1000 + (+el.dataset.lineTotal || 0) * 40;
  el.classList.remove('disable-transitions');
  requestAnimationFrame(() => {
    list.forEach(n => { el.classList.remove(`animation--${n}--inactive`); el.classList.add(`animation--${n}--active`); });
    setTimeout(() => {
      el.classList.remove(...cls, ...list.map(n => `animation--${n}--active`));
      cb && cb();
    }, dur + 90);
  });
};
const transition = (el, names, cb) => runTransition(el, prepareTransition(el, names), cb);

/* ============================================================
   REVEAL
   ============================================================ */
const reveal = (() => {
  let started = false;
  const done = (el, name) => { el.removeAttribute('data-reveal'); el.setAttribute('data-reveal-old', name); };
  const show = (el, extraDelay = 0) => {
    if (el.hasAttribute('data-reveal-visible')) return;
    const name = el.dataset.reveal;
    const delay = (+el.dataset.revealDelay || 0) + extraDelay;
    const overshoot = el.getBoundingClientRect().bottom < 0;
    if (overshoot || reduced) { el.setAttribute('data-reveal-visible', ''); done(el, name); return; }
    // arm while still hidden, THEN drop the hidden state: the inactive state is
    // what paints, never the finished text
    // touch: one cheap rise instead of splitting every character
    const effective = mdUp() ? name : name.split(/\s+/).map(n => (n === 'title' || n === 'subtitle' || n === 'text') ? 'rise' : n).join(' ');
    const prepared = prepareTransition(el, effective);
    el.setAttribute('data-reveal-visible', '');
    setTimeout(() => runTransition(el, prepared, () => done(el, name)), mdUp() ? delay : Math.min(delay, 260));
  };
  /* Trigger on VISUAL position, not on IntersectionObserver boxes.
     Most titles here live inside pinned/parallaxed layers, and IO reports the
     element's TRANSFORMED box: a line can be sitting in the middle of the screen
     while its IO box is still a viewport away, so the reveal fired long after the
     text was already on screen (that is the "fades in too late" and the blank-then-
     pop glitch). A rect check each frame is accurate under transforms, and 50-odd
     reads at 10Hz is cheap. Reads run before the parallax writes, so no thrash. */
  let pending = [];
  const ENTER = .88;                     // fire once the top edge is inside 88% of the viewport
  const start = () => {
    if (started) return; started = true;
    if (reduced) { $$('[data-reveal]').forEach(el => { el.setAttribute('data-reveal-visible', ''); el.setAttribute('data-reveal-old', el.dataset.reveal); el.removeAttribute('data-reveal'); }); return; }
    pending = $$('[data-reveal]').map(el => {
      const group = el.closest('[data-reveal-group]');
      return { el, group, trigger: group || el, delay: group ? (+group.dataset.revealDelay || 30) : 0 };
    });
    check();
  };
  const check = () => {
    if (!pending.length) return;
    const still = [];
    for (const p of pending) {
      if (p.el.hasAttribute('data-reveal-visible')) continue;
      const r = p.trigger.getBoundingClientRect();
      if (!r.height && !r.width) { still.push(p); continue; }
      if (r.top < VH * ENTER && r.bottom > 0) show(p.el, p.delay);
      else if (r.bottom <= 0) show(p.el, 0);          // scrolled past before it ever fired
      else still.push(p);
    }
    pending = still;
  };
  let lastCheck = 0;
  const tick = now => {
    if (!started || now - lastCheck < 100) return; lastCheck = now;
    check();
  };
  return { start, tick };
})();

/* ============================================================
   LAZY MEDIA (appear)
   ============================================================ */
const media = (() => {
  const imgs = $$('img[data-img]');
  /* below 860px a frame with a portrait ladder (data-p) serves its 9:16 centre crop:
     same pixels as object-fit would show, a third of the bytes (memory sizes-must-cover-the-crop) */
  const phone = matchMedia('(max-width: 860px)').matches;
  imgs.forEach(img => {
    const usePortrait = phone && img.dataset.p;
    const name = img.dataset.img + (usePortrait ? '-p' : ''), ws = (usePortrait ? img.dataset.p : img.dataset.w).split(/\s+/).map(Number);
    img.dataset.srcset = ws.map(w => `assets/img/${name}@${w}.webp ${w}w`).join(', ');
    img.dataset.src = `assets/img/${name}@${ws[Math.min(1, ws.length - 1)]}.webp`;
    /* phones stack nearly every frame to most of the width, and most boxes are portrait
       over landscape sources, so a desktop 'sizes' of 25vw under-selects by 3x at DPR 3
       (memory sizes-dpr3-candidate-cliff). data-sm overrides; otherwise anything narrow
       on desktop is treated as 80vw here. */
    if (phone) img.sizes = img.dataset.sm || (parseFloat(img.sizes) < 60 ? '80vw' : img.sizes);
    img.loading = 'lazy'; img.decoding = 'async';
  });
  const load = img => {
    if (img.dataset.loaded) return; img.dataset.loaded = '1';
    img.srcset = img.dataset.srcset; img.src = img.dataset.src;
    const done = () => img.classList.add('is-loaded');
    if (img.decode) img.decode().then(done, done); else img.onload = done;
  };
  const pre = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { pre.unobserve(en.target); load(en.target); } }), { rootMargin: '600px 0px' });
  imgs.forEach(i => pre.observe(i));
  $$('.intro__img, .header__logo-mark, .modal__img').forEach(i => { if (i.complete) i.classList.add('is-loaded'); else i.addEventListener('load', () => i.classList.add('is-loaded')); });
  if ('requestIdleCallback' in window) requestIdleCallback(() => imgs.forEach(i => { if (!i.closest('.l-expansive-slider') || mdUp()) load(i); }), { timeout: 8000 });
  return { load };
})();

/* ============================================================
   PRELOADER
   ============================================================ */
const preloader = (() => {
  const el = $('#preloader'), counter = $('#preloader-counter'), fill = $('#preloader-fill');
  const skip = !mdUp() || location.hash === '#skip-preloader' || sessionStorage.getItem('lagskogur-preloaded');
  const MIN = 1200; const t0 = performance.now();
  let assets = 0, total = 2, shown = 0, done = false;
  const hero = $('.intro__img');
  const bump = () => { assets++; };
  if (!hero) bump(); else if (hero.complete) bump(); else { hero.addEventListener('load', bump); hero.addEventListener('error', bump); }
  document.fonts.ready.then(bump);
  const finish = (cb) => {
    if (done) return; done = true;
    setTimeout(() => {
      el.classList.add('is-done');
      setTimeout(() => { el.classList.add('is-removed'); }, 1700);
      cb();
    }, skip ? 0 : 1000);
  };
  const tick = (cb) => {
    const p = Math.min(1, ((performance.now() - t0) / MIN + assets / total) / 2);
    shown = lerp(shown, p, .15);
    if (fill) fill.style.transform = `scaleX(${shown.toFixed(4)})`;
    if (counter) counter.textContent = Math.round(shown * 100);
    if (p >= 1 && shown > .995) finish(cb);
  };
  return { skip, tick, finish, el };
})();

/* ============================================================
   THEMED HEADER + TOP + HIDE
   ============================================================ */
const header = (() => {
  const h = $('#header');
  const sections = $$('[data-themed]');
  let ranges = [];
  const measure = () => { ranges = sections.map(s => ({ top: docTop(s), bottom: docTop(s) + s.offsetHeight, cls: s.dataset.themed })); };
  let lastCls = '';
  const tick = y => {
    const line = y + 30;
    let cur = ranges[0];
    for (const r of ranges) if (line >= r.top && line < r.bottom) { cur = r; }
    // later sections overlap earlier ones (negative margins): pick the last match
    for (let i = ranges.length - 1; i >= 0; i--) { if (line >= ranges[i].top && line < ranges[i].bottom) { cur = ranges[i]; break; } }
    if (cur && cur.cls !== lastCls) {
      h.classList.remove('ui-dark', 'ui-light', 'ui-gradient', 'ui-intro');
      h.classList.add(...cur.cls.split(/\s+/)); lastCls = cur.cls;
    }
    h.classList.toggle('header--top', y <= 10);
  };
  const hideIO = new IntersectionObserver(es => es.forEach(en => h.classList.toggle('header--hidden', en.isIntersecting)), { rootMargin: '0px 0px -86% 0px', threshold: 0 });
  const ht = $('.js-hide-header'); if (ht) hideIO.observe(ht);
  return { measure, tick, el: h };
})();

/* ============================================================
   OVERLAYS — one owner for the scroll lock and the layer
   ============================================================ */
/* The menu and the booking panel are both full-screen and both sat at z-index 9.
   Opening the menu from behind an open booking panel put it underneath, so the
   hamburger looked dead, and closing either one dropped the shared `with-modal`
   flag while the other was still open, which let the page scroll away behind it.
   One registry now: opening an overlay closes any other, and the scroll lock is
   derived from what is actually open rather than toggled by whoever ran last. */
const overlays = (() => {
  const closers = new Map();
  const live = new Set();
  const sync = () => html.classList.toggle('with-modal', live.size > 0);
  return {
    register: (name, closeFn) => closers.set(name, closeFn),
    opened(name) {
      closers.forEach((fn, other) => { if (other !== name && live.has(other)) fn(); });
      live.add(name); sync();
    },
    closed(name) { live.delete(name); sync(); },
    closeAll() { closers.forEach((fn, name) => { if (live.has(name)) fn(); }); },
    has: (name) => live.has(name),
    get any() { return live.size > 0; },
  };
})();

/* ============================================================
   MENU
   ============================================================ */
const menu = (() => {
  const modal = $('#menu'), list = $('.js-menu-list'), scrollerEl = $('.js-menu-scroller'), toggle = $('.js-menu-toggle');
  let open = false, mouseY = .5, ty = 0, cy = 0;
  const show = () => {
    if (open) return;
    overlays.opened('menu');
    open = true; modal.classList.remove('is-hidden'); modal.setAttribute('aria-hidden', 'false'); void modal.offsetWidth;
    modal.classList.add('is-open'); html.classList.add('with-modal-menu'); toggle.setAttribute('aria-expanded', 'true');
    const active = $$('.js-menu-link').find(a => { const id = a.getAttribute('href'); const el = $(id); return el && docTop(el) <= scroller.y + VH * .5 && docTop(el) + el.offsetHeight > scroller.y + VH * .5; });
    $$('.js-menu-link').forEach(a => a.classList.toggle('is-active', a === active));
  };
  const hide = () => {
    if (!open) return;
    open = false; modal.classList.remove('is-open'); modal.classList.add('is-closing'); html.classList.remove('with-modal-menu'); toggle.setAttribute('aria-expanded', 'false');
    overlays.closed('menu');
    setTimeout(() => { modal.classList.remove('is-closing'); modal.classList.add('is-hidden'); modal.setAttribute('aria-hidden', 'true'); }, 420);
  };
  overlays.register('menu', hide);
  /* The burger is the one exit that is always on screen, above every overlay. If
     something else is open it dismisses that first rather than opening the menu
     underneath it. */
  toggle.addEventListener('click', () => {
    if (!open && overlays.any) { overlays.closeAll(); return; }
    open ? hide() : show();
  });
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && open) hide(); });
  $$('.js-menu-link').forEach(a => {
    a.addEventListener('click', e => { e.preventDefault(); const t = $(a.getAttribute('href')); hide(); if (t) setTimeout(() => scroller.scrollToEl(t, t.id === 'tenets' ? -VH * .62 : 0), 200); });
    a.addEventListener('mouseenter', () => list.classList.add('is-hovering'));
    a.addEventListener('mouseleave', () => list.classList.remove('is-hovering'));
  });
  modal.addEventListener('mousemove', e => { mouseY = e.clientY / innerHeight; });
  const tick = () => {
    if (!open || !mdUp()) return;
    const over = list.offsetHeight - scrollerEl.offsetHeight + 120;
    ty = over > 0 ? -over * mouseY : 0;
    cy = lerp(cy, ty, .1);
    list.style.transform = `translateY(${cy.toFixed(2)}px)`;
  };
  return { tick, hide, isOpen: () => open };
})();

/* ============================================================
   STICKY SLIDER (horizontal chapter)
   ============================================================ */
const slider = (() => {
  const root = $('.js-sticky-slider'); if (!root) return { tick() {}, measure() {} };
  const sticky = $('.sticky-slider__sticky', root), track = $('[data-sticky-slider-content]', root);
  const moves = $$('.js-hmove', track), column = $('.l-expansive-slider__column', track), card = $('.js-expansive-card', track);
  let max = 0, top = 0, height = 0, itemsMeta = [];
  const measure = () => {
    if (!mdUp()) { root.style.minHeight = ''; track.style.transform = ''; return; }
    max = track.scrollWidth - VW;
    root.style.minHeight = (max + VH) + 'px';
    height = root.offsetHeight; top = docTop(root);
    itemsMeta = moves.map(f => ({ f, img: $('img', f), left: docLeft(f) - docLeft(track), w: f.offsetWidth }));
    if (column) { column._meta = { left: docLeft(column) - docLeft(track), w: column.offsetWidth, h: column.offsetHeight }; }
  };
  let lastP = -1;
  const tick = y => {
    if (!mdUp()) return;
    const p = clamp((y - top) / (height - VH || 1));
    if (p === lastP) return; lastP = p;
    const tx = -p * max;
    track.style.transform = `translate3d(${tx.toFixed(2)}px,0,0)`;
    for (const m of itemsMeta) {
      const x = m.left + tx;                       // screen x of figure
      const t = clamp((VW - x) / (VW + m.w));     // 0 entering from right → 1 left edge gone
      m.img.style.transform = `translateX(${(-16.667 * (1 - t)).toFixed(3)}%)`;
    }
    if (column && column._meta) {
      const x = column._meta.left + tx; const t = clamp((VW - x) / (VW + column._meta.w));
      column.style.transform = `translateY(${((VH - column._meta.h - VH * .1) * t).toFixed(2)}px)`;
    }
  };
  return { tick, measure };
})();

/* ============================================================
   WEBGL — rooms ring + art ring
   ============================================================ */
/* Try the asked-for width, then fall back: not every photo was resized to every
   step, and a miss here silently renders a BLANK WHITE PLANE rather than erroring. */
const loadTex = (name, w = 1200) => {
  const widths = [w, 1440, 1200, 1024, 720].filter((v, i, a) => a.indexOf(v) === i);
  const attempt = i => new Promise(res => {
    if (i >= widths.length) { console.warn('[lagskogur] no texture for', name); return res(null); }
    texLoader.load(`assets/img/${name}@${widths[i]}.webp`,
      t => { t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; res(t); },
      undefined, () => res(attempt(i + 1)));
  });
  return attempt(0);
};
const makeRenderer = canvas => { const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' }); r.setPixelRatio(Math.min(devicePixelRatio, 2)); r.setClearColor(0x000000, 0); return r; };
/* A quiet loader for chapters that fetch their own assets. */
const chapterLoader = (host, label) => {
  if (!host) return { show() {}, hide() {} };
  const el = document.createElement('div');
  el.className = 'chapter-loader';
  el.innerHTML = `<span class="chapter-loader__bar"></span><span class="chapter-loader__label">${label}</span>`;
  host.appendChild(el);
  return { show: () => el.classList.add('is-on'), hide: () => el.classList.remove('is-on') };
};

const R = 15;
/* Ring geometry, shared by both chapters. The ring is centred on the origin with
   radius R; the camera sits out at +Z, so the NEAR point of the ring (phi 0 →
   (0,0,R)) is what faces the lens. CAM_Z must leave real clearance: at 26 the
   front card is 11 units out, which is what makes a ~4-unit card read AS a card
   instead of swallowing the frame. Never set camera.rotation by hand in here —
   a manual roll with no lookAt tilts the entire ring (that was the bug). */
const CAM_Z = 26;
/* The ring radius has to be chosen against the plane width: neighbours sit
   2*r*sin(step/2) apart, so if that chord equals the plane width the cards tile
   edge-to-edge into a closed drum (which is exactly what the 13-plane art ring
   did at r=15). Keep the chord comfortably wider than the plane. */
const ringPos = (m, phi, r = R) => { m.position.set(r * Math.sin(phi), 0, r * Math.cos(phi)); m.rotation.y = phi; };
/* Fit every texture into a common box, preserving aspect, so a 2.5:1 banner crop
   and a square canvas carry the same visual weight on the ring. */
const fitPlane = (tex, maxW, maxH) => {
  const asp = tex && tex.image ? tex.image.width / tex.image.height : 1.5;
  let w = maxW, h = w / asp;
  if (h > maxH) { h = maxH; w = h * asp; }
  return new THREE.PlaneGeometry(w, h);
};

/* ---- ROOMS: a browsable selector, not only a scrubbed animation.
   Scroll advances it, drag moves it by hand, hover raycasts to drive the "View"
   cursor, click opens that room's page. Four items, so it is a clamped fan
   rather than an endless ring. ---- */
const rooms = (() => {
  const canvas = $('#worlds-canvas'), stage = $('#worlds-stage'); if (!canvas) return { tick() {}, resize() {} };
  const names = $$('.l-three-worlds__name'), ringBar = $('.progress-ring__bar', $('#worlds-ring')), counter = $('#worlds-counter');
  const cursor = $('#room-cursor');
  const ROOMS = names.map(n => ({ label: n.textContent.trim(), href: n.dataset.href, img: n.dataset.img, w: +n.dataset.w || 1200 }));
  names.forEach(n => { const t = n.textContent; n.textContent = ''; [...t].forEach((ch, i) => { const c = document.createElement('span'); c.className = 'char'; c.style.setProperty('--char-index', i); c.textContent = ch === ' ' ? '\u00A0' : ch; n.appendChild(c); }); });
  const SPREAD = 34 * Math.PI / 180;
  let renderer, scene, camera, ready = false, planes = [], inited = false, W = 0, H = 0, lastIndex = -1, dirty = true;
  let sel = 0, selShown = 0, dragSel = 0, dragging = false, lastX = 0, dragV = 0, hovered = -1, pointer = null, moved = 0;
  let raycaster, ndc;
  const loader = chapterLoader($('.l-three-worlds-webgl'), 'Loading the rooms');
  // the gesture differs by input, so the instruction has to as well
  if (isTouch) { const hint = $('.l-three-worlds__hint'); if (hint) hint.innerHTML = 'Swipe to browse<span>Tap a room to open it</span>'; }
  const init = async () => {
    if (inited) return; inited = true;
    loader.show();
    await ensureThree();
    raycaster = new THREE.Raycaster(); ndc = new THREE.Vector2();
    renderer = makeRenderer(canvas); scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, 1, .1, 100); camera.position.set(0, 0, CAM_Z); camera.lookAt(0, 0, 0); camera.setFocalLength(22.56);
    const texs = await Promise.all(ROOMS.map(r => loadTex(r.img, r.w)));
    texs.forEach((t, i) => {
      const m = new THREE.Mesh(fitPlane(t, 6.2, 4.1), new THREE.MeshBasicMaterial({ map: t, transparent: true }));
      m.userData.i = i; planes.push(m); scene.add(m);
    });
    resize(); ready = true; dirty = true; loader.hide(); bind();
  };
  const bind = () => {
    canvas.addEventListener('pointerdown', e => { dragging = true; moved = 0; lastX = e.clientX; dragV = 0; canvas.setPointerCapture(e.pointerId); canvas.classList.add('is-grabbing'); });
    canvas.addEventListener('pointermove', e => {
      const r = canvas.getBoundingClientRect();
      pointer = { x: e.clientX, y: e.clientY };
      ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      if (dragging) { const dx = e.clientX - lastX; lastX = e.clientX; moved += Math.abs(dx); dragV = dx; dragSel -= dx / (r.width * .28); }
      dirty = true;
    });
    canvas.addEventListener('pointerup', () => {
      canvas.classList.remove('is-grabbing');
      if (dragging && moved < 6 && hovered >= 0) go(hovered);      // a tap, not a drag
      dragging = false;
    });
    canvas.addEventListener('pointercancel', () => { dragging = false; canvas.classList.remove('is-grabbing'); });
    canvas.addEventListener('pointerleave', () => { pointer = null; hovered = -1; canvas.classList.remove('is-hit'); if (cursor) cursor.classList.remove('is-visible'); dirty = true; });
    // keyboard equivalent for the drag/click gesture
    $$('.l-three-worlds__link').forEach((a, i) => {
      a.addEventListener('focus', () => { dragSel += i - sel; dirty = true; });
    });
  };
  const go = i => { const r = ROOMS[i]; if (r && r.href) (window.__lagskogurNav || (h => { location.href = h; }))(r.href); };
  const resize = () => { if (!renderer) return; W = canvas.clientWidth || VW; H = canvas.clientHeight || VH; renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix(); dirty = true; };
  const setIndex = i => {
    if (i === lastIndex) return;
    const up = i > lastIndex;
    names.forEach((n, k) => { n.classList.toggle('is-active', k === i); n.classList.toggle('is-leaving-up', up && k < i); });
    counter.textContent = i + 1;
    ringBar.style.strokeDashoffset = 373.25 * (1 - (i + 1) / ROOMS.length);
    const link = $('#worlds-link'); if (link && ROOMS[i]) { link.href = ROOMS[i].href; }
    lastIndex = i;
  };
  const tick = y => {
    if (!mdUp()) return;                       // touch uses .l-rooms-mobile instead
    const top = docTop(stage), h = stage.offsetHeight;
    const near = y > top - VH * 2 && y < top + h + VH;
    if (near && !inited) init();
    if (!ready || !near) return;
    /* Scroll is AUTHORITATIVE: it must walk all four rooms and then let the page go.
       The old snap-to-nearest term (dragSel += (round(sel) - sel) * .08) ran every
       frame and accumulated an offset that fought this mapping, so the set often
       ended on 3/4 and the chapter released early. Drag is now a temporary offset
       that decays back to the scroll position instead. */
    const p = clamp((y - top) / (h - VH * 1.35));   // hold on the last room ~0.35vh, not a full viewport
    const scrollSel = p * (ROOMS.length - 1);
    if (!dragging) {
      if (Math.abs(dragV) > .05) { dragV *= .88; dragSel -= dragV / (W * .28) * .4; }
      dragSel *= .94;                                    // rejoin the scroll within ~half a second
      if (Math.abs(dragSel) < .002) dragSel = 0;
    }
    sel = clamp(scrollSel + dragSel, 0, ROOMS.length - 1);
    const prev = selShown; selShown = lerp(selShown, sel, .18);
    if (Math.abs(selShown - prev) > 1e-4) dirty = true;
    // entry dolly: the reference's tele flattening, stopped short of 300mm so the
    // fan stays browsable instead of collapsing into a flat stack
    const de = E.easeInOutQuad(clamp((y - (top - VH * .5)) / VH));
    camera.position.set(0, -.35 * de, CAM_Z + 6 * de); camera.lookAt(0, -.35 * de, 0);
    camera.setFocalLength(lerp(22.56, 42, de));
    planes.forEach((m, i) => {
      ringPos(m, (i - selShown) * SPREAD);
      const d = Math.abs(i - selShown);
      m.material.opacity = clamp(1 - d * .42, .18, 1);
      m.scale.setScalar(hovered === i ? 1.03 : 1);
      m.visible = d < 3.2;
      m.renderOrder = 10 - Math.round(d * 10);
    });
    if (pointer && !dragging) {
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObjects(planes.filter(m => m.visible), false)[0];
      const h2 = hit ? hit.object.userData.i : -1;
      if (h2 !== hovered) { hovered = h2; dirty = true; }
      if (cursor) {
        cursor.classList.toggle('is-visible', hovered >= 0);
        cursor.style.transform = `translate(${pointer.x}px,${pointer.y}px)`;
        if (hovered >= 0) { const l = $('.room-cursor__room', cursor); if (l) l.textContent = ROOMS[hovered].label; }
      }
      canvas.classList.toggle('is-hit', hovered >= 0);
    }
    setIndex(Math.round(selShown));
    if (!dirty) return; dirty = dragging || Math.abs(sel - selShown) > 1e-3;
    renderer.render(scene, camera);
  };
  return { tick, resize: () => { resize(); dirty = true; } };
})();

/* ---- THE HANG: the art chapter, plain DOM.
   Scroll pans the wall; pointer drag walks it by hand. One transform on one
   element, no 3D, no extra dependency — and the paintings stay rectangular. ---- */
const hang = (() => {
  const stage = $('#hang-stage'), track = $('.js-hang-track'); if (!stage || !track) return { tick() {}, measure() {} };
  const fill = $('.js-hang-fill'), idxEl = $('.js-hang-index'), totalEl = $('.js-hang-total');
  const items = $$('.l-hang__item', track);
  let maxScroll = 0, top = 0, height = 0, drag = 0, dragging = false, lastX = 0, dragV = 0, shown = 0, lastIdx = -1;
  if (totalEl) totalEl.textContent = String(items.length).padStart(2, '0');
  const measure = () => {
    maxScroll = Math.max(0, track.scrollWidth - VW);
    top = docTop(stage); height = stage.offsetHeight;
  };
  track.addEventListener('pointerdown', e => { dragging = true; lastX = e.clientX; dragV = 0; track.setPointerCapture(e.pointerId); track.classList.add('is-grabbing'); });
  track.addEventListener('pointermove', e => { if (!dragging) return; const dx = e.clientX - lastX; lastX = e.clientX; dragV = dx; drag -= dx; });
  const up = () => { dragging = false; track.classList.remove('is-grabbing'); };
  track.addEventListener('pointerup', up); track.addEventListener('pointercancel', up);
  const tick = y => {
    if (!mdUp()) return;                       // native scroll-snap on touch
    if (!maxScroll) measure();
    const near = y > top - VH * 2 && y < top + height + VH;
    if (!near) return;
    if (!dragging && Math.abs(dragV) > .1) { drag -= dragV * .35; dragV *= .9; }
    const p = clamp((y - top) / (height - VH || 1));
    const target = clamp(p * maxScroll + drag, 0, maxScroll);
    drag = target - p * maxScroll;                       // keep the hand-offset inside the rails
    shown = lerp(shown, target, .12);
    track.style.transform = `translate3d(${(-shown).toFixed(2)}px,0,0)`;
    const prog = maxScroll ? shown / maxScroll : 0;
    if (fill) fill.style.transform = `scaleX(${prog.toFixed(4)})`;
    const i = Math.min(items.length - 1, Math.round(prog * (items.length - 1)));
    if (i !== lastIdx && idxEl) { idxEl.textContent = String(i + 1).padStart(2, '0'); lastIdx = i; }
  };
  return { tick, measure };
})();

/* ---- SCROLL CUE ---- */
const scrollCue = (() => {
  const el = $('#scroll-cue'); if (!el) return { tick() {} };
  const holds = $$('[data-hold]');
  let lastY = -1, idleSince = 0, on = false;
  const tick = (y, now) => {
    if (Math.abs(y - lastY) > 1.5) { lastY = y; idleSince = now; if (on) { el.classList.remove('is-on'); on = false; } return; }
    if (on) return;
    if (now - idleSince < 1100) return;                       // only once the reader has gone still
    const hold = holds.find(s => { const t = docTop(s); return y > t - VH * .2 && y < t + s.offsetHeight - VH * 1.1; });
    if (!hold) return;
    el.classList.toggle('is-light', !!$('#header').classList.contains('ui-light'));
    el.classList.add('is-on'); on = true;
  };
  return { tick };
})();

/* ============================================================
   MAP CHAPTER
   ============================================================ */
const map = (() => {
  const pins = $$('.l-location__pin'), legend = $$('.js-loc-legend li'), texts = $$('.js-loc-texts p'), inner = $('.js-map-inner');
  const section = $('#locations'), sheet = $('.l-location__map-img'), mapEl = $('.js-location-map');
  const loader = chapterLoader($('.l-location__map-pin'), 'Loading the map');
  let sheetStarted = false;
  const loadSheet = () => {
    if (sheetStarted || !sheet) return; sheetStarted = true;
    loader.show();
    const src = sheet.dataset.src || sheet.getAttribute('src');
    const done = () => loader.hide();
    if (sheet.dataset.src) { sheet.src = src; }
    if (sheet.complete) done(); else { sheet.addEventListener('load', done, { once: true }); sheet.addEventListener('error', done, { once: true }); }
  };
  const mobile = $('.js-mobile-scrollable'), mapPin = $('.l-location__map-pin');
  /* One dot per place. Bakki and Holt stand thirty metres apart and Lundur and
     Klettur share a drive, so at any legible zoom they are one dot with two names. */
  const housesOf = pins.map(p => (p.dataset.houses || '').split(' ').map(Number));
  const pinOf = i => pins.findIndex((p, k) => housesOf[k].includes(i));
  const S = 2.1; // phone zoom around the chosen dot
  const lim = (v, a, b) => Math.min(b, Math.max(a, v));
  let last = -1, panX = 0, panY = 0, tx = 0, ty = 0, zoomed = false;
  const setHouse = (i, zoom) => {
    if (zoom) zoomed = true;
    if (i === last) return; last = i;
    const k = pinOf(i);
    pins.forEach((p, j) => p.classList.toggle('is-active', j === k));
    legend.forEach((l, j) => l.classList.toggle('is-active', j === i));
    texts.forEach((p, j) => p.classList.toggle('is-active', j === i));
    const pin = pins[k]; if (!pin) return;
    const fx = parseFloat(pin.style.left), fy = parseFloat(pin.style.top);
    if (mdUp()) { tx = (50 - fx) * .08; ty = (50 - fy) * .08; return; }
    if (!mapEl || !zoomed) return;
    /* centre the dot: the sheet is already centred by translate(-50%,-50%), so shift
       it by the dot's offset from centre, magnified by the zoom, and stop short of
       the sheet's edges so no bone ground shows */
    const W = mapEl.offsetWidth, H = mapEl.offsetHeight, vw = mapPin.clientWidth, vh = mapPin.clientHeight;
    const hw = vw / (2 * S * W) * 100, hh = vh / (2 * S * H) * 100;
    const cx = lim(fx, hw, 100 - hw), cy = lim(fy, hh, 100 - hh);
    mapEl.style.setProperty('--m-t', `translate(${(-50 - S * (cx - 50)).toFixed(2)}%, ${(-50 - S * (cy - 50)).toFixed(2)}%) scale(${S})`);
  };
  const tick = y => {
    if (section && !sheetStarted) { const t = docTop(section); if (y > t - VH * 2.5 && y < t + section.offsetHeight) loadSheet(); }
    if (inner && mdUp()) {
      panX = lerp(panX, tx, .06); panY = lerp(panY, ty, .06);
      inner.style.transform = `translate(${panX.toFixed(3)}%, ${panY.toFixed(3)}%)`;
    }
  };
  // desktop: a dot or a legend row under the pointer is the house on the card
  pins.forEach((p, k) => {
    p.addEventListener('mouseenter', () => { if (mdUp()) setHouse(housesOf[k][0]); });
    p.querySelector('.l-location__dot').addEventListener('focus', () => setHouse(housesOf[k][0]));
  });
  legend.forEach((l, i) => {
    l.addEventListener('mouseenter', () => setHouse(i));
    l.querySelector('button').addEventListener('click', () => setHouse(i));
  });
  if (mobile) {
    const cards = $$('.l-location__mcard', mobile);
    let programmatic = 0;
    mobile.addEventListener('scroll', () => {
      const i = Math.round(mobile.scrollLeft / (mobile.scrollWidth - mobile.clientWidth || 1) * (cards.length - 1));
      setHouse(i, programmatic === 0);
    }, { passive: true });
    // a tapped dot swipes the strip to its house, and the strip's scroll zooms the map
    pins.forEach((p, k) => p.querySelector('.l-location__dot').addEventListener('click', () => {
      if (mdUp()) return;
      const i = housesOf[k][0], card = cards[i]; if (!card) return;
      zoomed = true; programmatic = 1;
      mobile.scrollTo({ left: card.offsetLeft - (mobile.clientWidth - card.clientWidth) / 2, behavior: 'smooth' });
      setTimeout(() => { programmatic = 0; last = -1; setHouse(i, true); }, 650);
    }));
  }
  setHouse(0);
  return { tick };
})();

/* ============================================================
   QUOTES + RING CURSOR
   ============================================================ */
const quotes = (() => {
  const root = $('#quotes'), items = $$('.js-quote-items p'), cursor = $('#cursor'), bar = $('.cursor__bar'), cnt = $('#cursor-counter'), container = $('.js-cursor-target-container');
  if (!root) return { tick() {} };
  let last = -1, mx = 0, my = 0, cx = 0, cy = 0, inside = false;
  const setIndex = i => { if (i === last) return; last = i; items.forEach((p, k) => p.classList.toggle('is-active', k === i)); cnt.textContent = i + 1; bar.style.strokeDashoffset = 370.7 * (1 - (i + 1) / 3); };
  container.addEventListener('mouseenter', () => { inside = true; cursor.classList.add('is-visible'); });
  container.addEventListener('mouseleave', () => { inside = false; cursor.classList.remove('is-visible'); });
  container.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; });
  const tick = y => {
    const top = docTop(root), h = root.offsetHeight;
    const p = clamp((y - top) / (h - VH || 1));
    setIndex(Math.min(2, Math.floor(p * 3)));
    if (inside && SMOOTH) { cx = lerp(cx, mx, .5); cy = lerp(cy, my, .5); cursor.style.transform = `translate(${cx.toFixed(1)}px,${cy.toFixed(1)}px) ${mx < innerWidth / 2 ? '' : ''}`; }
  };
  setIndex(0);
  return { tick };
})();

/* ============================================================
   FOOTER MASK
   ============================================================ */
const footerMask = (() => {
  const root = $('.js-mask-text'); if (!root) return { tick() {} };
  const maskEl = $('.footer__text--mask', root);
  let mx = -300, my = -300, cx = -300, cy = -300;
  root.addEventListener('mousemove', e => { const r = maskEl.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top; });
  root.addEventListener('mouseleave', () => { mx = -300; my = -300; });
  const tick = () => { cx = lerp(cx, mx, .25); cy = lerp(cy, my, .25); maskEl.style.setProperty('--x', cx.toFixed(1) + 'px'); maskEl.style.setProperty('--y', cy.toFixed(1) + 'px'); };
  return { tick };
})();

/* ============================================================
   SNDR BOOKING — the guest-facing surface only
   ============================================================
   A demonstration of our own booking engine sitting inside the client's own
   design, which is the entire pitch: the guest books on THEIR domain, in THEIR
   look, and nobody takes a percentage on the way past.

   Deliberately front-end only. It mirrors the real product's guest flow
   (dates -> room -> who you are -> request) and stops there: the real engine
   sends the request to the owner's phone and the guest pays on arrival, so there
   is no card step to fake. Nothing is sent anywhere from here, no field is
   stored, and the confirmation says so in plain words. The markup is built once
   in JS so every page gets it without duplicating a slab of HTML.               */
const booking = (() => {
  const triggers = $$('[data-booking]');
  if (!triggers.length) return;
  const ROOMS = [
    { name: 'Brún', note: 'Golden Circle · sleeps 12 · 4 bedrooms' },
    { name: 'Nes', note: 'Bifröst · sleeps 10 · guest house' },
    { name: 'Bakki', note: 'Helluskógur · sleeps 8 · 3 bedrooms' },
    { name: 'Holt', note: 'Helluskógur · sleeps 6 · 3 bedrooms' },
    { name: 'Lundur', note: 'Borgarnes · sleeps 10 · guest house' },
    { name: 'Klettur', note: 'Borgarnes · sleeps 6 · 3 bedrooms' },
    { name: 'Hrossholt', note: 'Snæfellsnes · sleeps 12 · 5 bedrooms' },
  ];
  let el = null, room = 0, prevFocus = null;
  const iso = (d) => d.toISOString().slice(0, 10);
  const build = () => {
    const today = new Date();
    const inD = new Date(today.getTime() + 864e5 * 14);
    const outD = new Date(today.getTime() + 864e5 * 16);
    el = document.createElement('div');
    el.className = 'modal modal--booking is-hidden';
    el.id = 'booking';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = `
      <div class="modal__bg"><img class="modal__img" src="assets/img/brun-tub@1440.webp" alt=""></div>
      <div class="modal__scroller bk">
        <div class="bk__inner" role="dialog" aria-modal="true" aria-labelledby="bk-h">
          <div class="bk__head">
            <p class="bk__eyebrow text-small">Request to book · demonstration</p>
            <h2 class="bk__title" id="bk-h"><span class="text-subtitle">Stay</span><span class="h2">DIRECTLY</span></h2>
            <p class="bk__lead">No platform in between. The request reaches Heiðrún's phone, she confirms the house and the dates, and you pay her, not a marketplace.</p>
          </div>
          <form class="bk__form" novalidate>
            <div class="bk__row">
              <label class="bk__f"><span class="text-small">Arriving</span><input type="date" name="in" value="${iso(inD)}" min="${iso(today)}"></label>
              <label class="bk__f"><span class="text-small">Leaving</span><input type="date" name="out" value="${iso(outD)}" min="${iso(today)}"></label>
              <label class="bk__f bk__f--n"><span class="text-small">Guests</span><input type="number" name="guests" min="1" max="16" value="6"></label>
            </div>
            <p class="bk__nights text-small" data-nights></p>
            <fieldset class="bk__rooms">
              <legend class="text-small">House</legend>
              ${ROOMS.map((r, i) => `
                <label class="bk__room${i === 0 ? ' is-on' : ''}">
                  <input type="radio" name="room" value="${r.name}"${i === 0 ? ' checked' : ''}>
                  <span class="bk__room-n h3">${r.name}</span>
                  <span class="bk__room-d text-small">${r.note}</span>
                </label>`).join('')}
            </fieldset>
            <div class="bk__row">
              <label class="bk__f"><span class="text-small">Name</span><input type="text" name="name" autocomplete="name" placeholder="Your name"></label>
              <label class="bk__f"><span class="text-small">Phone</span><input type="tel" name="phone" autocomplete="tel" placeholder="+354 …"></label>
            </div>
            <label class="bk__f bk__f--w"><span class="text-small">Anything we should know</span><textarea name="note" rows="2" placeholder="Late arrival, a cot, two houses together"></textarea></label>
            <div class="bk__actions">
              <button type="submit" class="btn btn--primary">Send request</button>
              <a class="btn btn--underline" href="mailto:info@lagskogur.is"><span class="btn__underline">Or email info@lagskogur.is</span></a>
            </div>
            <p class="bk__fine text-small">A demonstration of the SNDR booking engine inside the site. Nothing is sent and nothing is stored.</p>
          </form>
          <div class="bk__done" hidden>
            <p class="bk__title"><span class="text-subtitle">Nothing</span><span class="h2">WAS SENT</span></p>
            <p class="bk__lead" data-done-body></p>
            <div class="bk__actions"><button type="button" class="btn btn--primary" data-bk-again>Back to the form</button></div>
          </div>
<!-- No close button of its own: the header's X is fixed, always on screen and
               already reads "Close", and a second one inside the panel scrolled out of
               reach at the bottom of the form, which is where people got stuck. -->
        </div>
      </div>`;
    document.body.appendChild(el);
    const form = $('.bk__form', el), done = $('.bk__done', el);
    const nights = () => {
      const a = new Date(form.in.value), b = new Date(form.out.value);
      const n = Math.round((b - a) / 864e5);
      $('[data-nights]', el).textContent = n > 0
        ? `${n} night${n > 1 ? 's' : ''} · the whole house, from 16:00 on the day you arrive`
        : 'Leaving date must be after arriving.';
      return n;
    };
    form.addEventListener('input', (e) => {
      nights();
      if (e.target.name === 'room') $$('.bk__room', el).forEach(l => l.classList.toggle('is-on', $('input', l).checked));
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const n = nights();
      if (n <= 0) return;
      const r = form.room.value, g = form.guests.value;
      $('[data-done-body]', el).textContent =
        `In the real engine Heiðrún would now have a request for ${r}, ${g} guest${g > 1 ? 's' : ''}, ${n} night${n > 1 ? 's' : ''}, and could confirm it from her phone. This preview sends nothing.`;
      form.hidden = true; done.hidden = false;
    });
    $('[data-bk-again]', el).addEventListener('click', () => { done.hidden = true; form.hidden = false; });
    const bkClose = $('[data-bk-close]', el); if (bkClose) bkClose.addEventListener('click', close);
    el.addEventListener('click', (e) => { if (e.target === el || e.target.classList.contains('modal__scroller')) close(); });
    nights();
  };
  const open = () => {
    if (!el) build();
    if (el.classList.contains('is-open')) return;
    overlays.opened('booking');
    html.classList.add('with-modal-booking');   // the header's own Book a stay would re-open what is already open
    prevFocus = document.activeElement;
    el.classList.remove('is-hidden'); el.setAttribute('aria-hidden', 'false');
    void el.offsetWidth; el.classList.add('is-open');
    const f = $('.bk__form input', el); if (f) f.focus({ preventScroll: true });
  };
  const close = () => {
    if (!el || !el.classList.contains('is-open')) return;
    el.classList.remove('is-open'); el.classList.add('is-closing');
    html.classList.remove('with-modal-booking');
    overlays.closed('booking');
    setTimeout(() => { el.classList.remove('is-closing'); el.classList.add('is-hidden'); el.setAttribute('aria-hidden', 'true'); }, 420);
    if (prevFocus) prevFocus.focus({ preventScroll: true });
  };
  overlays.register('booking', close);
  triggers.forEach(t => t.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;   // let a deliberate new-tab through to the real engine
    e.preventDefault(); open();
  }));
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && el && el.classList.contains('is-open')) close(); });
  return { open, close };
})();

/* ============================================================
   HASH LINKS
   ============================================================ */
$$('a[href^="#"]').forEach(a => {
  if (a.classList.contains('js-menu-link')) return;
  a.addEventListener('click', e => {
    const id = a.getAttribute('href'); if (id.length < 2) return;
    const t = $(id); if (!t) return;
    /* the wordmark and Map sit in the header, above any open overlay: going
       somewhere on the page has to dismiss what is covering it */
    overlays.closeAll();
    e.preventDefault();
    const off = t.id === 'tenets' ? -VH * .62 : 0;
    scroller.scrollToEl(t, off);
  });
});

/* ============================================================
   WELLS + SNAPS
   ============================================================ */
const measureWellsSnaps = () => {
  scroller.wells = [];
  $$('[data-gravity-well]').forEach(el => { const top = docTop(el), h = el.offsetHeight; JSON.parse(el.dataset.gravityWell).forEach(w => scroller.wells.push(top + h * w.element / 100 - VH * w.viewport / 100)); });
  scroller.snaps = [];
  $$('[data-snap]').forEach(el => { const top = docTop(el), h = el.offsetHeight; JSON.parse(el.dataset.snap).forEach(p => scroller.snaps.push({ y: top + h * p.element / 100 - VH * p.viewport / 100, scrollable: !!p.scrollable })); });
  scroller.snaps.sort((a, b) => a.y - b.y);
};

/* ============================================================
   MEASURE + LOOP
   ============================================================ */
const measureAll = () => {
  measureViewport();
  slider.measure();
  parallax.measure();
  header.measure();
  measureWellsSnaps();
  scroller.setLimit();
  rooms.resize(); hang.measure();
};
let resizeT;
const onResize = () => { clearTimeout(resizeT); resizeT = setTimeout(() => { parallax.build(); measureAll(); }, 120); };
window.addEventListener('resize', onResize);
const ro = new ResizeObserver(() => { clearTimeout(resizeT); resizeT = setTimeout(measureAll, 120); });
ro.observe(document.body);

let running = false;
const loop = (now) => {
  if (!running) { preloader.tick(startPage); }
  scroller.tick();
  const y = SMOOTH ? scroller.y : scrollY;
  reveal.tick(now);          // rect READS first, before the transform writes below
  parallax.apply(y);
  slider.tick(y);
  header.tick(y);
  rooms.tick(y);
  hang.tick(y);
  scrollCue.tick(y, now);
  map.tick(y);
  quotes.tick(y);
  footerMask.tick();
  menu.tick();
  scroller.listeners.forEach(f => f());
  requestAnimationFrame(loop);
};

const startPage = () => {
  if (running) return; running = true;
  sessionStorage.setItem('lagskogur-preloaded', '1');
  measureAll();
  // header + reveals
  if (mdUp() && !reduced) { setTimeout(() => transition(header.el, 'slide-in-top block'), 250); }
  reveal.start();
};

/* Cross-page curtain. Same-origin links inside the site fade out before they
   navigate; the incoming page raises its curtain in the head and drops it here,
   so moving between the landing page and a room never flashes raw content. */
const pageTransition = (() => {
  const ov = $('#page-overlay');
  const drop = () => { html.classList.remove('is-entering'); ov.classList.remove('is-on'); };
  const raise = href => { ov.classList.add('is-on'); setTimeout(() => { location.href = href; }, 380); };
  window.__lagskogurNav = raise;                                       // the WebGL ring navigates through the same curtain
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === '_blank') return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname) return;             // in-page anchors keep the smooth scroll
    if (!/\.html?$/.test(url.pathname) && url.pathname !== '/') return;
    e.preventDefault(); raise(url.href);
  });
  addEventListener('pageshow', drop);                            // also covers the bfcache back button
  return { drop };
})();

const boot = async () => {
  await document.fonts.ready;
  requestAnimationFrame(() => setTimeout(pageTransition.drop, 60));
  parallax.build();
  measureAll();
  // hash on load
  if (location.hash && location.hash !== '#skip-preloader') { const t = $(location.hash); if (t) { const to = docTop(t); window.scrollTo(0, to); scroller.y = scroller.target = to; } }
  if (preloader.skip) { preloader.el.classList.add('is-removed'); startPage(); }
  requestAnimationFrame(loop);
};
boot();
