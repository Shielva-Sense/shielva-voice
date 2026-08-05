"use client";

import { useEffect, useState } from "react";
import { LogIn, LogOut, User, Sun, Moon, Cloud, HardDrive } from "lucide-react";
import Image from "next/image";
import SessionTimer from "./components/SessionTimer";
import Showcase from "./components/Showcase";
import { useEngineGate } from "./lib/useEngineGate";
import { engineLabel } from "./lib/voice-settings";
import SpeechToText from "./components/SpeechToText";
import TextToSpeech from "./components/TextToSpeech";
import VoiceLibrary from "./components/VoiceLibrary";
import Translator from "./components/Translator";
import IntentClassifier from "./components/IntentClassifier";
import RealTimeVoice from "./components/RealTimeVoice";
import AnalyticsWidget from "./components/AnalyticsWidget";
import VoiceTraining from "./components/VoiceTraining";
import { useAuth } from "./context/AuthContext";
import { useStorage } from "./context/StorageContext";
import SyncWidget from "./components/SyncWidget";

/** Marketing copy lives at module scope — it is static, so rebuilding these
 *  arrays on every render would be pure waste. */
const CAPABILITIES = [
  { title: "Speech recognition", body: "Accurate transcription across languages, with word-level timing and confidence you can act on." },
  { title: "Natural speech", body: "Low-latency synthesis that streams the first audio in well under a second." },
  { title: "Voice cloning", body: "Build a custom voice from a short sample, then use it anywhere synthesis is available." },
  { title: "Translation", body: "Move between languages while keeping the speaker's voice and intent intact." },
  { title: "Intent detection", body: "Turn what was said into what was meant, so your product can respond rather than transcribe." },
  { title: "Bring your own engine", body: "Cloud GPU, Cartesia, ElevenLabs or Groq — chosen per tenant, switched without a redeploy." },
] as const;

const STEPS = [
  { title: "Choose your engines", body: "Pick what drives transcription and speech. Availability and quota are checked live, so an engine you cannot use is never offered." },
  { title: "Use your own account, or ours", body: "Add your provider key to bill it directly, or run on the platform's. Keys are encrypted at rest and never shown again." },
  { title: "Ship it", body: "One integration stays put while the engine behind it changes — no client work when you switch provider." },
] as const;

export default function Home() {
  // SSR-safe: always "dark" on server (matches layout.tsx inline script fallback).
  // After mount, reads localStorage / time-based preference to avoid hydration mismatch.
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const { user, isAuthenticated, isLoading, login, logout } = useAuth();
  // Tools stay locked until this tenant has actually chosen its engines.
  const gate = useEngineGate(isAuthenticated);
  const { settings: storageSettings, activeMode, isLocalFallback, openModal: openStorageModal, configLoading: storageConfigLoading } = useStorage();

  // Hydrate theme from localStorage / time-of-day after first client render
  useEffect(() => {
    const saved = localStorage.getItem("vm-theme") as "dark" | "light" | null;
    const hour = new Date().getHours();
    const resolved = saved ?? (hour >= 6 && hour < 20 ? "light" : "dark");
    setTheme(resolved);
    // data-theme already set by inline script in layout.tsx — just keep in sync
    document.documentElement.setAttribute("data-theme", resolved);
  }, []);

  // Sync theme to <html data-theme="..."> and persist manual overrides.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("vm-theme", theme);
  }, [theme]);




  return (
    <div className="vm-root">
      {/* ─── Header ─── */}
      <header className="vm-header">
        <div className="vm-logo">
          <div className="vm-logo-icon">
            <Image src="/shielva_brand_logo.svg" alt="Shielva" width={34} height={34} />
          </div>
          <div className="vm-logo-text">
            Shielva <span>Voice</span>
          </div>
        </div>

        <nav className="vm-nav" aria-label="Primary">
          {/* Marketing anchors are for visitors; once signed in the nav is
              workspace navigation, not a pitch. */}
          {!isAuthenticated ? (
            <>
              <a href="/docs">Docs</a>
              <a href="#how">How it works</a>
              <a href="#showcase">Showcase</a>
            </>
          ) : (
            <a href="/settings">Settings</a>
          )}
        </nav>

        <div className="vm-header-right">
          {/* Storage mode badge — authenticated users only (public auto-uses local /tmp silently) */}
          {isAuthenticated && (
            <button
              className="vm-storage-badge"
              onClick={openStorageModal}
              title="Storage settings — click to configure"
              data-mode={storageConfigLoading ? "loading" : activeMode}
              data-fallback={isLocalFallback ? "true" : undefined}
            >
              {storageConfigLoading ? (
                <span style={{ width: 10, height: 10, border: "1.5px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
              ) : activeMode === "cloud" ? (
                <Cloud size={13} strokeWidth={2} />
              ) : (
                <HardDrive size={13} strokeWidth={2} />
              )}
              <span>
                {storageConfigLoading
                  ? "Loading…"
                  : activeMode === "cloud"
                    ? (storageSettings.mode === "local" && isLocalFallback ? "Cloud (fallback)" : "Cloud")
                    : "Local"}
              </span>
              <span className="vm-storage-badge__dot" />
            </button>
          )}

          {/* Global sync — authenticated users only */}
          {isAuthenticated && <SyncWidget />}

          <button
            className="vm-theme-toggle"
            onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}
            title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          >
            {theme === "dark" ? <Sun size={15} strokeWidth={2} /> : <Moon size={15} strokeWidth={2} />}
          </button>

          {/* Public session countdown — only shown when not authenticated */}
          {!isLoading && !isAuthenticated && (
            <SessionTimer onExpired={() => {}} />
          )}

          {/* Auth button */}
          {!isLoading && (
            isAuthenticated ? (
              <div className="vm-auth-user">
                <User size={14} />
                <span className="vm-auth-name">{user?.name || user?.email || "Account"}</span>
                <button className="vm-auth-btn" onClick={logout} title="Sign out">
                  <LogOut size={14} />
                </button>
              </div>
            ) : (
              <button className="vm-auth-btn vm-auth-btn--login" onClick={login} title="Sign in for full access">
                <LogIn size={14} />
                <span>Sign in</span>
              </button>
            )
          )}
        </div>
      </header>

      {/* ─── Hero ─── */}
      <section className="vm-hero">
        <h1>
          <span className="accent">Voice Intelligence</span> Platform
        </h1>
        <p>
          Real-time speech recognition, voice cloning, neural translation, and intent
          detection — powered by faster-whisper, Chatterbox, and Qwen.
        </p>
        {!isAuthenticated && !isLoading && (
          <p className="vm-hero-trial-note">
            <button className="vm-hero-signin-link" onClick={login}>
              Sign in
            </button>{" "}
            to start using voice features with your plan.
          </p>
        )}
      </section>

      {/* ─── Marketing — anonymous visitors only ─── */}
      {!isAuthenticated && !isLoading && (
      <>
      <Showcase />

      <section id="capabilities" className="vm-marketing">
        <h2>Everything a voice product needs, in one platform</h2>
        <p className="vm-marketing-sub">
          Swap the engine behind any capability without touching your integration.
        </p>
        <ul role="list" className="vm-cap-grid">
          {CAPABILITIES.map((c) => (
            <li key={c.title} className="vm-cap">
              <h3>{c.title}</h3>
              <p>{c.body}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* ─── How it works ─── */}
      <section id="how" className="vm-marketing">
        <h2>How it works</h2>
        <ol className="vm-steps">
          {STEPS.map((step, i) => (
            <li key={step.title}>
              <span className="vm-step-n" aria-hidden="true">{i + 1}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
      </>
      )}

      {/* ─── Feature Grid ─── */}
      {/* Tools are for signed-in users only — an anonymous visitor gets the
          marketing page and nothing operable. Previously STT, TTS and
          Translation ran pre-login, which handed out real compute to anyone
          who loaded the page. */}
      {isAuthenticated && !gate.ready && (
        <section className="vm-gate">
          <h2>Choose your engines first</h2>
          <p>{gate.loading ? "Checking your engine selection…" : gate.reason}</p>
          {!gate.loading && (
            <div className="vm-gate-row">
              <a href="/settings" className="vm-gate-cta">Open Settings</a>
              <button type="button" onClick={() => void gate.refresh()} className="vm-gate-alt">
                Re-check
              </button>
            </div>
          )}
          <style>{`
            .vm-gate {
              max-width: 620px; margin: 60px auto; padding: 32px;
              border: 1px solid var(--border-subtle); border-radius: 14px;
              background: var(--surface-subtle); text-align: center;
            }
            .vm-gate h2 { margin: 0 0 8px; font-size: 19px; font-weight: 600; }
            .vm-gate p {
              margin: 0; font-size: 14px; line-height: 1.6;
              color: var(--text-secondary);
            }
            .vm-gate-row { display: flex; gap: 10px; justify-content: center; margin-top: 20px; }
            .vm-gate-cta, .vm-gate-alt {
              height: 32px; padding: 0 14px; border-radius: 7px; font-size: 13px;
              display: inline-flex; align-items: center; cursor: pointer;
              border: 1px solid var(--border-subtle); text-decoration: none;
              color: var(--text-primary); background: var(--surface);
            }
            .vm-gate-cta {
              background: var(--brand-500, #6d9f37); border-color: transparent; color: #fff;
            }
          `}</style>
        </section>
      )}

      {isAuthenticated && gate.ready && (
        <>
          {/* The active engines, stated plainly — a tenant on Cartesia should
              not have to guess which stack their audio is hitting. */}
          <div className="vm-active-engines">
            <span>Speech to text: <b>{gate.stt ? engineLabel(gate.stt) : "Platform default"}</b></span>
            <span>Text to speech: <b>{gate.tts ? engineLabel(gate.tts) : "Platform default"}</b></span>
            <a href="/settings">Change</a>
            <style>{`
              .vm-active-engines {
                max-width: 1400px; margin: 0 auto 4px; padding: 0 24px;
                display: flex; gap: 18px; flex-wrap: wrap; align-items: center;
                font-size: 12.5px; color: var(--text-secondary);
              }
              .vm-active-engines b { color: var(--text-primary); font-weight: 600; }
              .vm-active-engines a { color: var(--text-secondary); }
            `}</style>
          </div>

          <div className="vm-grid">
            <AnalyticsWidget />
            <SpeechToText />
            <TextToSpeech />
            <VoiceLibrary />
            <VoiceTraining />
            {/* Translation and live translation are cloud-GPU-only paths
                (Qwen / NLLB run on our stack). Hosted vendors do not offer
                them, so showing those controls on Cartesia or ElevenLabs
                would advertise something the selected engine cannot do. */}
            {(gate.isCloudGpuTts || !gate.tts) && <Translator />}
            {(gate.isCloudGpuTts || !gate.tts) && <IntentClassifier />}
            {(gate.isCloudGpuTts || !gate.tts) && <RealTimeVoice />}
          </div>
        </>
      )}

      {/* ─── Footer ─── */}
      <footer className="vm-footer">
        Shielva Voice &middot; Speech recognition, synthesis and cloning &middot; Multi-tenant by design
      </footer>

      <style>{`
        /* ── Primary nav ─────────────────────────────────────────── */
        .vm-nav {
          display: flex;
          align-items: center;
          gap: 22px;
          margin-left: 34px;
          margin-right: auto;
        }
        .vm-nav a {
          color: var(--text-secondary);
          font-size: 13px;
          text-decoration: none;
          /* Reserve the underline's space up front so hover doesn't shift the row. */
          border-bottom: 1px solid transparent;
          padding-bottom: 2px;
          transition: color 0.15s ease, border-color 0.15s ease;
        }
        .vm-nav a:hover,
        .vm-nav a:focus-visible {
          /* --text-primary is defined for BOTH themes. The previous
             var(--text, #eaeaea) had no such token, so the near-white fallback
             always applied and the label disappeared on the light theme. */
          color: var(--text-primary);
          border-bottom-color: currentColor;
        }
        @media (max-width: 860px) {
          /* Marketing anchors are noise on small screens, but Settings is the
             only way in — it was previously lost with the rest of the nav. */
          .vm-nav a:not([href="/settings"]) { display: none; }
          .vm-nav { margin-left: 18px; gap: 0; }
        }

        /* ── Marketing sections ──────────────────────────────────── */
        .vm-marketing {
          max-width: 1080px;
          margin: 0 auto;
          padding: 56px 24px 8px;
        }
        .vm-marketing h2 {
          font-size: clamp(22px, 3vw, 30px);
          font-weight: 600;
          letter-spacing: -0.02em;
          text-wrap: balance;
          margin: 0;
        }
        .vm-marketing-sub {
          margin: 8px 0 0;
          color: var(--text-secondary);
          font-size: 15px;
          max-width: 62ch;
        }

        .vm-cap-grid {
          list-style: none;
          margin: 28px 0 0;
          padding: 0;
          display: grid;
          gap: 1px;
          /* Single-pixel gap over a rule colour: the cards read as one table of
             capabilities rather than six floating boxes. */
          background: var(--border, #1f1f1f);
          border: 1px solid var(--border, #1f1f1f);
          border-radius: 12px;
          overflow: hidden;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        }
        .vm-cap {
          background: var(--surface, #0d0d0d);
          padding: 22px 20px;
        }
        .vm-cap h3 {
          margin: 0 0 6px;
          font-size: 15px;
          font-weight: 600;
        }
        .vm-cap p {
          margin: 0;
          font-size: 13.5px;
          line-height: 1.62;
          color: var(--text-secondary);
        }

        .vm-steps {
          list-style: none;
          counter-reset: none;
          margin: 26px 0 0;
          padding: 0;
          display: grid;
          gap: 20px;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        }
        .vm-steps li {
          display: flex;
          gap: 14px;
          align-items: flex-start;
        }
        .vm-step-n {
          flex: 0 0 auto;
          width: 26px;
          height: 26px;
          border-radius: 50%;
          display: grid;
          place-items: center;
          font-size: 12px;
          font-variant-numeric: tabular-nums;
          color: var(--accent, #8ec07c);
          border: 1px solid currentColor;
        }
        .vm-steps h3 {
          margin: 2px 0 5px;
          font-size: 14.5px;
          font-weight: 600;
        }
        .vm-steps p {
          margin: 0;
          font-size: 13.5px;
          line-height: 1.62;
          color: var(--text-secondary);
        }

        @media (prefers-reduced-motion: reduce) {
          .vm-nav a { transition: none; }
        }
        .vm-auth-user {
          display: flex;
          align-items: center;
          gap: 6px;
          color: var(--text-secondary);
          font-size: 13px;
        }
        .vm-auth-name {
          max-width: 120px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .vm-auth-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          background: transparent;
          border: 1px solid var(--border, #1a1a1a);
          color: var(--text-secondary);
          border-radius: 6px;
          padding: 4px 10px;
          font-size: 12px;
          cursor: pointer;
          transition: border-color 0.15s, color 0.15s;
        }
        .vm-auth-btn:hover {
          border-color: var(--bamboo-600, #6d9f37);
          color: var(--white, #fff);
        }
        .vm-auth-btn--login {
          border-color: rgba(109,159,55,0.4);
          color: var(--bamboo-400, #a3c96e);
        }
        .vm-auth-btn--login:hover {
          background: rgba(109,159,55,0.08);
        }
        .vm-hero-trial-note {
          font-size: 13px;
          color: var(--text-secondary);
          margin-top: 8px;
        }
        .vm-hero-signin-link {
          background: none;
          border: none;
          color: var(--bamboo-400, #a3c96e);
          cursor: pointer;
          font-size: 13px;
          padding: 0;
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .vm-hero-signin-link:hover {
          color: var(--bamboo-300, #c5e08a);
        }
      `}</style>
    </div>
  );
}
