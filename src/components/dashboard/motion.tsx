import { useEffect, useRef, useState, type RefObject } from 'react';
import { useIsFetching } from '@tanstack/react-query';

const REVEAL_TARGETS = '.metric:not(.sk-tile), .chart-panel:not(.sk-panel), .notice, .empty-state';
const STAGGER_MS = 70;
const MAX_STAGGER = 6;
const COUNT_MS = 900;

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Tiles and panels under `rootRef` fade and rise when they first scroll into view, including those that appear later (a tab, a
 * filter, a page that has just loaded). Only elements this hook has seen are ever hidden, so a page without it simply shows everything.
 */
export function useScrollReveal(rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || reducedMotion() || typeof IntersectionObserver === 'undefined') return;

    const reveal = new IntersectionObserver((entries) => {
      let i = 0;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        el.style.setProperty('--rv-delay', `${Math.min(i++, MAX_STAGGER) * STAGGER_MS}ms`);
        el.classList.add('rv-in');
        reveal.unobserve(el);
      }
    }, { rootMargin: '0px 0px -40px 0px' });   // no ratio: a panel taller than the screen must still reveal

    const seen = new WeakSet<Element>();
    const mark = () => {
      root.querySelectorAll(REVEAL_TARGETS).forEach((el) => {
        if (seen.has(el) || el.parentElement?.closest(REVEAL_TARGETS)) return;
        seen.add(el);
        el.classList.add('rv');
        reveal.observe(el);
      });
    };
    mark();
    const changes = new MutationObserver(mark);
    changes.observe(root, { childList: true, subtree: true });
    return () => { changes.disconnect(); reveal.disconnect(); };
  }, [rootRef]);
}

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

/** One step of a count-up: every number in the text scaled by `progress`, keeping its decimals and thousands separators ("KES 2.05B", "234 / 48"). */
export function countUpFrame(text: string, progress: number) {
  return text.replace(NUMBER, (match) => {
    const decimals = match.split('.')[1]?.length ?? 0;
    const scaled = Number(match.replace(/,/g, '')) * progress;
    return match.includes(',')
      ? scaled.toLocaleString('en-KE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
      : scaled.toFixed(decimals);
  });
}

/** Shows `value`, counting up to it the first time it is on screen. It always ends on the exact text it was given. */
export function CountUp({ value }: { value: string }) {
  const [shown, setShown] = useState(value);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    setShown(value);
    const el = ref.current;
    if (!el || reducedMotion() || typeof IntersectionObserver === 'undefined' || !/\d/.test(value)) return;
    let frame = 0;
    const seen = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      seen.disconnect();
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / COUNT_MS);
        if (t >= 1) { setShown(value); return; }
        setShown(countUpFrame(value, 1 - (1 - t) ** 3));
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    });
    seen.observe(el);
    return () => { seen.disconnect(); cancelAnimationFrame(frame); setShown(value); };
  }, [value]);

  return <span ref={ref}>{shown}</span>;
}

const BARS = [46, 72, 58, 88, 64, 40, 78];

function SkeletonBars() {
  return <div className="sk-bars">{BARS.map((h, i) => <i key={i} style={{ height: `${h}%`, animationDelay: `${i * 90}ms` }} />)}</div>;
}

/** A panel-shaped placeholder with bars that rise and fall. */
export function PanelLoader({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="chart-panel sk-panel" role="status" aria-label={label}>
      <div className="sk-line" style={{ width: '32%' }} />
      <div className="sk-line sk-thin" style={{ width: '52%' }} />
      <SkeletonBars />
    </div>
  );
}

/** The shape of a page while its first data arrives: a row of tiles and two panels. */
export function PageLoader({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="sk-page" role="status" aria-label={label}>
      <div className="metrics-grid">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="metric sk-tile" style={{ animationDelay: `${i * 120}ms` }}>
            <div className="sk-line sk-thin" style={{ width: '58%' }} />
            <div className="sk-line sk-big" style={{ width: '42%' }} />
            <div className="sk-line sk-thin" style={{ width: '74%' }} />
          </div>
        ))}
      </div>
      <div className="sk-panels"><PanelLoader label={label} /><PanelLoader label={label} /></div>
      <p className="sk-label">{label}<span className="ai-dots" aria-hidden="true"><i /><i /><i /></span></p>
    </div>
  );
}

/** The profile drawer's placeholder. */
export function DrawerLoader({ label = 'Loading the profile...' }: { label?: string }) {
  return (
    <div className="sk-drawer" role="status" aria-label={label}>
      <div className="sk-line sk-thin" style={{ width: '24%' }} />
      <div className="sk-line sk-big" style={{ width: '70%' }} />
      <div className="sk-line sk-thin" style={{ width: '40%' }} />
      <div className="sk-tabs">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="sk-line" style={{ animationDelay: `${i * 90}ms` }} />)}</div>
      {[86, 94, 68, 90, 52].map((w, i) => <div key={i} className="sk-line sk-thin" style={{ width: `${w}%`, animationDelay: `${i * 110}ms` }} />)}
      <SkeletonBars />
    </div>
  );
}

/** The KJET mark assembling itself, shown while the session is checked on first load. */
export function BrandLoader({ label = 'Loading KJET Dashboard...' }: { label?: string }) {
  return (
    <div className="brand-loader" role="status" aria-label={label}>
      <div className="brand-mark brand-loader-mark">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path className="layer l1" d="M12 2L2 7l10 5 10-5-10-5z" />
          <path className="layer l2" d="M2 12l10 5 10-5" />
          <path className="layer l3" d="M2 17l10 5 10-5" />
        </svg>
      </div>
      <div className="brand-loader-track"><i /></div>
      <p>{label}</p>
    </div>
  );
}

/** A thin bar along the top of the page while data is loading for the first time (the quiet background refreshes do not show it). */
export function TopProgress() {
  const loading = useIsFetching({ predicate: (q) => q.state.status === 'pending' });
  return loading > 0 ? <div className="top-progress" aria-hidden="true"><i /></div> : null;
}
