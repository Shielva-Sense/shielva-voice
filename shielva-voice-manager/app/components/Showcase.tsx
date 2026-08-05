"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Auto-rotating product showcase for the logged-out landing page.
 *
 * Deliberately built from CSS/SVG rather than GIFs: this repo ships no media
 * assets, and a voice product's "demo" is motion over time — a waveform
 * settling into words, a language switching — which animates far more crisply
 * (and at a fraction of the bytes) as vector than as a looping raster.
 *
 * Motion is honest about what the product does. It is not decoration bolted
 * onto a static page.
 */

interface Slide {
  key: string;
  eyebrow: string;
  title: string;
  body: string;
  visual: "waveform" | "translate" | "clone";
}

const SLIDES: Slide[] = [
  {
    key: "listen",
    eyebrow: "Speech recognition",
    title: "It hears every word",
    body: "Live transcription with word-level timing and a confidence score you can branch on — not a wall of text you have to trust blindly.",
    visual: "waveform",
  },
  {
    key: "speak",
    eyebrow: "Translation",
    title: "In any language you sell in",
    body: "Move between languages mid-conversation while the speaker's voice and intent survive the trip.",
    visual: "translate",
  },
  {
    key: "clone",
    eyebrow: "Voice cloning",
    title: "In a voice that's yours",
    body: "A short sample becomes a voice you can use anywhere synthesis is available — including the ones you switch to later.",
    visual: "clone",
  },
];

const ROTATE_MS = 5200;

export default function Showcase() {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  // Honour the OS setting: auto-advancing carousels are exactly the kind of
  // motion reduced-motion users are asking us to stop.
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    if (paused || reduced.current) return;
    const t = setInterval(() => setI((v) => (v + 1) % SLIDES.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [paused]);

  const slide = SLIDES[i]!;

  return (
    <section
      id="showcase"
      className="sc"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      aria-roledescription="carousel"
      aria-label="Product showcase"
    >
      <div className="sc-inner">
        <div className="sc-copy" key={slide.key}>
          <p className="sc-eyebrow">{slide.eyebrow}</p>
          <h2>{slide.title}</h2>
          <p className="sc-body">{slide.body}</p>

          <div className="sc-dots" role="tablist" aria-label="Choose a slide">
            {SLIDES.map((s, n) => (
              <button
                key={s.key}
                role="tab"
                aria-selected={n === i}
                aria-label={s.title}
                onClick={() => setI(n)}
                className={n === i ? "sc-dot sc-dot-on" : "sc-dot"}
              />
            ))}
          </div>
        </div>

        <div className="sc-visual" aria-hidden="true">
          {slide.visual === "waveform" && <Waveform />}
          {slide.visual === "translate" && <TranslateViz />}
          {slide.visual === "clone" && <CloneViz />}
        </div>
      </div>

      <style>{`
        .sc { max-width: 1080px; margin: 0 auto; padding: 64px 24px 8px; }
        .sc-inner {
          display: grid;
          gap: 40px;
          align-items: center;
          grid-template-columns: 1fr 1fr;
          border: 1px solid var(--border, #1f1f1f);
          border-radius: 16px;
          padding: 40px;
          background: var(--surface, #0d0d0d);
        }
        @media (max-width: 820px) {
          .sc-inner { grid-template-columns: 1fr; padding: 28px; }
        }
        .sc-copy { animation: sc-in 420ms ease both; }
        @keyframes sc-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: none; }
        }
        .sc-eyebrow {
          margin: 0 0 8px;
          font-size: 12px;
          letter-spacing: 0.09em;
          text-transform: uppercase;
          color: var(--accent);
        }
        .sc h2 {
          margin: 0;
          font-size: clamp(24px, 3.4vw, 34px);
          font-weight: 600;
          letter-spacing: -0.02em;
          text-wrap: balance;
        }
        .sc-body {
          margin: 12px 0 0;
          font-size: 15px;
          line-height: 1.65;
          color: var(--text-secondary);
          max-width: 46ch;
        }
        .sc-dots { display: flex; gap: 8px; margin-top: 26px; }
        .sc-dot {
          width: 26px; height: 4px; padding: 0;
          border: 0; border-radius: 99px; cursor: pointer;
          background: var(--border, #2a2a2a);
          transition: background 0.25s ease, width 0.25s ease;
        }
        .sc-dot-on { background: var(--accent, #8ec07c); width: 42px; }
        .sc-visual { display: grid; place-items: center; min-height: 200px; }

        /* Bars rise and fall like speech energy — staggered so it reads as a
           voice, not a loading spinner. */
        .wf { display: flex; align-items: flex-end; gap: 5px; height: 120px; }
        .wf i {
          display: block; width: 7px; border-radius: 99px;
          background: linear-gradient(180deg, var(--accent, #8ec07c), var(--accent, #8ec07c) 60%, transparent);
          animation: wf 1.25s ease-in-out infinite;
        }
        @keyframes wf {
          0%, 100% { height: 14%; opacity: 0.55; }
          50%      { height: 100%; opacity: 1; }
        }

        .tv { display: grid; gap: 10px; width: 100%; max-width: 300px; }
        .tv span {
          border: 1px solid var(--border, #1f1f1f);
          border-radius: 10px;
          padding: 11px 14px;
          font-size: 14px;
          animation: sc-in 500ms ease both;
        }
        .tv span:nth-child(2) { animation-delay: 260ms; }
        .tv span:nth-child(3) { animation-delay: 520ms; color: var(--accent); }

        .cv { position: relative; width: 150px; height: 150px; display: grid; place-items: center; }
        .cv b {
          position: absolute; inset: 0; border-radius: 50%;
          border: 1px solid var(--accent, #8ec07c);
          animation: cv 2.6s ease-out infinite;
        }
        .cv b:nth-child(2) { animation-delay: 0.85s; }
        .cv b:nth-child(3) { animation-delay: 1.7s; }
        @keyframes cv {
          from { transform: scale(0.45); opacity: 0.85; }
          to   { transform: scale(1);    opacity: 0; }
        }
        .cv em {
          width: 62px; height: 62px; border-radius: 50%;
          background: var(--accent, #8ec07c); opacity: 0.16;
        }

        @media (prefers-reduced-motion: reduce) {
          .sc-copy, .tv span { animation: none; }
          .wf i, .cv b { animation: none; }
          .wf i { height: 55%; }
        }
      `}</style>
    </section>
  );
}

// Heights are fixed per bar so the "waveform" has a stable silhouette rather
// than re-randomising on every render (which would look like noise, not speech).
const BARS = [38, 64, 92, 55, 78, 100, 46, 70, 88, 52, 74, 34];

const Waveform = () => (
  <div className="wf">
    {BARS.map((h, n) => (
      <i key={n} style={{ height: `${h}%`, animationDelay: `${n * 85}ms` }} />
    ))}
  </div>
);

const TranslateViz = () => (
  <div className="tv">
    <span>Where is the nearest station?</span>
    <span>¿Dónde está la estación más cercana?</span>
    <span>निकटतम स्टेशन कहाँ है?</span>
  </div>
);

const CloneViz = () => (
  <div className="cv">
    <b />
    <b />
    <b />
    <em />
  </div>
);
