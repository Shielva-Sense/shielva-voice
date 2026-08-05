"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, KeyRound, Mic, Trash2, TriangleAlert, Volume2 } from "lucide-react";
import { toast } from "sonner";

import {
  deleteByokKey,
  engineLabel,
  getSettings,
  listEngineVoices,
  listEngines,
  saveByokKey,
  saveEngines,
  type EngineCatalog,
  type EngineRow,
  type PresetVoice,
  type VoiceSettings,
} from "../lib/voice-settings";

/**
 * Engine settings — choose what drives speech-to-text and text-to-speech.
 *
 * Built on the app's own `vm-*` design system (globals.css), NOT Tailwind
 * utilities. The rest of this app uses vm-card / vm-engine-toggle / vm-btn and
 * the --surface/--border/--text-* tokens; a page written in raw utilities reads
 * as a different product bolted on, which is exactly how the first version of
 * this screen looked.
 *
 * The engine picker deliberately reuses `.vm-engine-toggle` — the same control
 * the Text-to-Speech card already uses — so switching provider feels identical
 * to switching anything else here.
 */

type Status = "loading" | "ready" | "error";

export default function SettingsPage() {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");
  const [catalog, setCatalog] = useState<EngineCatalog | null>(null);
  const [settings, setSettings] = useState<VoiceSettings | null>(null);
  const [saving, setSaving] = useState("");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const [c, s] = await Promise.all([listEngines(), getSettings()]);
      setCatalog(c);
      setSettings(s);
      setStatus("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const choose = async (kind: "tts" | "stt", id: string) => {
    setSaving(`${kind}:${id}`);
    try {
      const next = await saveEngines(kind === "tts" ? { tts_provider: id } : { stt_provider: id });
      setSettings(next);
      toast.success(`${kind === "tts" ? "Text to speech" : "Speech to text"} → ${engineLabel(id)}`);
    } catch (e) {
      toast.error("Could not save", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving("");
    }
  };

  return (
    <div className="vm-settings-root">
      <header className="vm-settings-top">
        <Link href="/" className="vm-settings-back">
          <ArrowLeft size={14} strokeWidth={2} /> Back
        </Link>
        <h1>Engine settings</h1>
        <p>
          Choose what powers transcription and speech. Every engine is checked live — anything
          unreachable, unconfigured or out of quota can&apos;t be selected.
        </p>
      </header>

      {status === "loading" && (
        <div className="vm-settings-state" role="status" aria-live="polite">
          <span className="vm-settings-spinner" aria-hidden="true" />
          <p className="vm-settings-state-title">Checking engine availability</p>
          <p className="vm-settings-state-sub">Probing each provider so you only see what works.</p>
        </div>
      )}

      {status === "error" && (
        <div className="vm-settings-state">
          <TriangleAlert size={26} strokeWidth={1.8} className="vm-settings-err-icon" aria-hidden="true" />
          <p className="vm-settings-state-title">Could not load engine settings</p>
          <p className="vm-settings-state-sub">{error}</p>
          <button type="button" className="vm-btn vm-btn-primary vm-btn-sm" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}

      {status === "ready" && catalog && settings && (
        <div className="vm-settings-grid">
          <EngineCard
            icon={<Volume2 size={16} strokeWidth={2} />}
            title="Text to speech"
            subtitle="Generates spoken audio, including cloned voices"
            rows={catalog.tts}
            active={settings.tts_provider ?? catalog.active.tts}
            kind="tts"
            saving={saving}
            byok={settings.byok_configured}
            onChoose={choose}
            onKeyChanged={setSettings}
            showVoices
          />
          <EngineCard
            icon={<Mic size={16} strokeWidth={2} />}
            title="Speech to text"
            subtitle="Transcribes microphone and uploaded audio"
            rows={catalog.stt}
            active={settings.stt_provider ?? catalog.active.stt}
            kind="stt"
            saving={saving}
            byok={settings.byok_configured}
            onChoose={choose}
            onKeyChanged={setSettings}
          />
        </div>
      )}

      <style>{`
        .vm-settings-root { max-width: 1180px; margin: 0 auto; padding: 28px 20px 64px; }
        .vm-settings-top { margin-bottom: 22px; }
        .vm-settings-back {
          display: inline-flex; align-items: center; gap: 5px;
          font-size: 13px; color: var(--text-secondary); text-decoration: none;
          margin-bottom: 14px;
        }
        .vm-settings-back:hover { color: var(--text-primary); }
        .vm-settings-top h1 {
          margin: 0; font-size: clamp(20px, 2.6vw, 26px); font-weight: 650;
          letter-spacing: -0.02em; color: var(--text-primary);
        }
        .vm-settings-top p {
          margin: 6px 0 0; font-size: 13.5px; line-height: 1.6;
          color: var(--text-secondary); max-width: 62ch;
        }

        /* Two columns on desktop, stacked on tablet down — the cards are dense
           enough that side-by-side stops helping below ~900px. */
        /* stretch, not start: the two panels hold different numbers of
           engines, and sizing each to its own content left one card visibly
           short of the other. Equal height reads as one control surface. */
        .vm-settings-grid {
          display: grid; gap: 16px;
          grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
          align-items: stretch;
        }
        .vm-settings-grid > * { height: 100%; }
        @media (max-width: 900px) {
          .vm-settings-grid { grid-template-columns: 1fr; }
          .vm-settings-root { padding: 20px 14px 48px; }
        }

        /* ── centred loading / error, vertically settled not pinned to top ── */
        .vm-settings-state {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 6px; min-height: 46vh; text-align: center;
        }
        .vm-settings-state-title {
          margin: 10px 0 0; font-size: 15px; font-weight: 600; color: var(--text-primary);
        }
        .vm-settings-state-sub {
          margin: 0; font-size: 13px; color: var(--text-secondary); max-width: 44ch;
        }
        .vm-settings-state .vm-btn { margin-top: 16px; }
        .vm-settings-err-icon { color: var(--text-muted); }
        .vm-settings-spinner {
          width: 26px; height: 26px; border-radius: 50%;
          border: 2px solid var(--border); border-top-color: var(--accent);
          animation: vm-spin 0.75s linear infinite;
        }
        @keyframes vm-spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          .vm-settings-spinner { animation-duration: 2.4s; }
        }

        /* ── engine rows ─────────────────────────────────────────────────── */
        .vm-eng-list { list-style: none; margin: 14px 0 0; padding: 0; display: grid; gap: 8px; }
        .vm-eng {
          border: 1px solid var(--border-subtle); border-radius: 10px;
          padding: 12px 13px; background: var(--surface);
          transition: border-color 0.15s ease, background 0.15s ease;
        }
        .vm-eng[data-active="true"] {
          border-color: var(--accent-border, var(--accent));
          background: var(--accent-bg, var(--surface-hover));
        }
        /* An unavailable engine still has to be READ — its name and the reason
           it is unavailable are the two things the user most needs here. A
           blanket opacity faded exactly that text along with the button, so
           every disabled row went illegible. Signal "inert" with a recessed
           surface and a muted border instead, and let the disabled control
           carry the affordance on its own. */
        .vm-eng[data-selectable="false"] {
          background: var(--surface-hover, rgba(0, 0, 0, 0.025));
          border-style: dashed;
        }
        .vm-eng-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .vm-eng-name { font-size: 14px; font-weight: 600; color: var(--text-primary); }
        .vm-eng-pill {
          display: inline-flex; align-items: center; gap: 4px;
          font-size: 11.5px; padding: 2px 7px; border-radius: 999px;
          border: 1px solid var(--border-subtle); color: var(--text-secondary);
        }
        .vm-eng-pill[data-tone="ok"] { color: var(--accent); border-color: var(--accent); }
        .vm-eng-pill[data-tone="bad"] { color: #c0392b; border-color: #c0392b55; }
        /* The reason text is the payload of a failed probe — "quota exhausted",
           "check GROQ_API_KEY". Secondary-grey at 12.5px on a tinted card was
           under the AA threshold, so keep it at body contrast. */
        .vm-eng-detail {
          margin: 7px 0 0; font-size: 12.5px; line-height: 1.55; color: var(--text-primary);
        }
        .vm-eng-actions { margin-left: auto; display: flex; gap: 6px; align-items: center; }
        .vm-eng-link {
          background: none; border: 0; cursor: pointer; padding: 0;
          font-size: 12.5px; color: var(--text-secondary); text-decoration: underline;
          text-underline-offset: 2px;
        }
        .vm-eng-link:hover { color: var(--text-primary); }
        .vm-quota { font-size: 12px; color: var(--text-muted); font-variant-numeric: tabular-nums; }

        /* ── BYOK ────────────────────────────────────────────────────────── */
        .vm-byok { margin-top: 11px; padding-top: 11px; border-top: 1px dashed var(--border-subtle); }
        .vm-byok-row { display: flex; gap: 7px; flex-wrap: wrap; margin-top: 7px; }
        .vm-byok-row .vm-input { flex: 1 1 220px; min-width: 0; }
        .vm-byok-note { margin: 0; font-size: 12px; color: var(--text-muted); line-height: 1.5; }

        /* ── voice picker ────────────────────────────────────────────────── */
        .vm-voices { margin-top: 11px; padding-top: 11px; border-top: 1px dashed var(--border-subtle); }
        .vm-voice-filters { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
        .vm-voice-chip {
          border: 1px solid var(--border-subtle); background: none; cursor: pointer;
          border-radius: 999px; padding: 3px 10px; font-size: 12px; text-transform: capitalize;
          color: var(--text-secondary);
        }
        .vm-voice-chip[aria-pressed="true"] {
          background: var(--text-primary); border-color: var(--text-primary);
          color: var(--surface);
        }
        .vm-voice-grid {
          list-style: none; margin: 9px 0 0; padding: 0; display: grid; gap: 6px;
          grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
          max-height: 210px; overflow-y: auto;
        }
        .vm-voice {
          border: 1px solid var(--border-subtle); border-radius: 8px;
          padding: 7px 9px; font-size: 12.5px; color: var(--text-primary);
          display: flex; justify-content: space-between; gap: 6px; align-items: baseline;
        }
        .vm-voice span { color: var(--text-muted); font-size: 11.5px; }
      `}</style>
    </div>
  );
}

function EngineCard({
  icon,
  title,
  subtitle,
  rows,
  active,
  kind,
  saving,
  byok,
  onChoose,
  onKeyChanged,
  showVoices = false,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  rows: EngineRow[];
  active: string;
  kind: "tts" | "stt";
  saving: string;
  byok: string[];
  onChoose: (kind: "tts" | "stt", id: string) => Promise<void>;
  onKeyChanged: (s: VoiceSettings) => void;
  showVoices?: boolean;
}) {
  return (
    <section className="vm-card">
      <div className="vm-card-header">
        <div className="vm-card-icon">{icon}</div>
        <div>
          <div className="vm-card-title">{title}</div>
          <div className="vm-card-subtitle">{subtitle}</div>
        </div>
      </div>

      <ul role="list" className="vm-eng-list">
        {rows.map((r) => (
          <EngineRowItem
            key={r.id}
            row={r}
            kind={kind}
            isActive={r.id === active}
            isSaving={saving === `${kind}:${r.id}`}
            hasOwnKey={byok.includes(r.id)}
            onChoose={onChoose}
            onKeyChanged={onKeyChanged}
            showVoices={showVoices}
          />
        ))}
      </ul>
    </section>
  );
}

function EngineRowItem({
  row,
  kind,
  isActive,
  isSaving,
  hasOwnKey,
  onChoose,
  onKeyChanged,
  showVoices,
}: {
  row: EngineRow;
  kind: "tts" | "stt";
  isActive: boolean;
  isSaving: boolean;
  hasOwnKey: boolean;
  onChoose: (kind: "tts" | "stt", id: string) => Promise<void>;
  onKeyChanged: (s: VoiceSettings) => void;
  showVoices: boolean;
}) {
  const [panel, setPanel] = useState<"" | "key" | "voices">("");

  return (
    <li className="vm-eng" data-active={isActive} data-selectable={row.selectable}>
      <div className="vm-eng-head">
        <span className="vm-eng-name">{engineLabel(row.id)}</span>

        {row.healthy === true && (
          <span className="vm-eng-pill" data-tone="ok">
            <Check size={11} aria-hidden="true" /> Available
          </span>
        )}
        {row.healthy === false && (
          <span className="vm-eng-pill" data-tone="bad">
            <TriangleAlert size={11} aria-hidden="true" /> Unavailable
          </span>
        )}
        {row.healthy === null && <span className="vm-eng-pill">Not checked</span>}

        {hasOwnKey && (
          <span className="vm-eng-pill">
            <KeyRound size={11} aria-hidden="true" /> Your key
          </span>
        )}
        {typeof row.quota_left === "number" && (
          <span className="vm-quota">{row.quota_left.toLocaleString()} left</span>
        )}

        <div className="vm-eng-actions">
          <button
            type="button"
            className="vm-eng-link"
            onClick={() => setPanel(panel === "key" ? "" : "key")}
          >
            {hasOwnKey ? "Key" : "Add key"}
          </button>
          {showVoices && row.selectable && (
            <button
              type="button"
              className="vm-eng-link"
              onClick={() => setPanel(panel === "voices" ? "" : "voices")}
            >
              Voices
            </button>
          )}
          <button
            type="button"
            className={isActive ? "vm-btn vm-btn-sm" : "vm-btn vm-btn-primary vm-btn-sm"}
            disabled={!row.selectable || isActive || isSaving}
            onClick={() => void onChoose(kind, row.id)}
          >
            {isSaving ? "Saving…" : isActive ? "In use" : "Use"}
          </button>
        </div>
      </div>

      {/* The probe's own reason is the useful part — show it verbatim. */}
      {row.detail && <p className="vm-eng-detail">{row.detail}</p>}

      {panel === "key" && <Byok engine={row.id} hasOwnKey={hasOwnKey} onChanged={onKeyChanged} />}
      {panel === "voices" && <Voices engine={row.id} />}
    </li>
  );
}

function Byok({
  engine,
  hasOwnKey,
  onChanged,
}: {
  engine: string;
  hasOwnKey: boolean;
  onChanged: (s: VoiceSettings) => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const id = `byok-${engine}`;

  const run = async (fn: () => Promise<VoiceSettings>, ok: string) => {
    setBusy(true);
    try {
      onChanged(await fn());
      setValue("");
      toast.success(ok);
    } catch (e) {
      toast.error("Failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vm-byok">
      <label className="vm-label" htmlFor={id}>
        Use your own {engineLabel(engine)} account
      </label>
      <p className="vm-byok-note">Billed to you. Encrypted at rest and never shown again.</p>
      <div className="vm-byok-row">
        <input
          id={id}
          type="password"
          autoComplete="off"
          className="vm-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={hasOwnKey ? "Enter a new key to replace the saved one" : "API key"}
        />
        <button
          type="button"
          className="vm-btn vm-btn-primary vm-btn-sm"
          disabled={busy || value.trim().length < 8}
          onClick={() => void run(() => saveByokKey(engine, value.trim()), "Key saved")}
        >
          Save
        </button>
        {hasOwnKey && (
          <button
            type="button"
            className="vm-btn vm-btn-sm"
            disabled={busy}
            aria-label={`Remove your ${engineLabel(engine)} key`}
            onClick={() => void run(() => deleteByokKey(engine), "Key removed")}
          >
            <Trash2 size={13} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

function Voices({ engine }: { engine: string }) {
  const [voices, setVoices] = useState<PresetVoice[] | null>(null);
  const [err, setErr] = useState("");
  const [g, setG] = useState<"all" | "male" | "female">("all");

  useEffect(() => {
    let dead = false;
    listEngineVoices(engine)
      .then((r) => !dead && setVoices(r.voices))
      .catch((e) => !dead && setErr(e instanceof Error ? e.message : String(e)));
    return () => {
      dead = true;
    };
  }, [engine]);

  if (err) return <p className="vm-eng-detail">{err}</p>;
  if (!voices) return <p className="vm-eng-detail">Loading voices…</p>;

  const shown = g === "all" ? voices : voices.filter((v) => v.gender === g);

  return (
    <div className="vm-voices">
      <div className="vm-voice-filters">
        <span className="vm-label" style={{ marginRight: 2 }}>
          Voices
        </span>
        {(["all", "male", "female"] as const).map((k) => (
          <button
            key={k}
            type="button"
            className="vm-voice-chip"
            aria-pressed={g === k}
            onClick={() => setG(k)}
          >
            {k}
          </button>
        ))}
        <span className="vm-quota">{shown.length}</span>
      </div>

      {shown.length === 0 ? (
        <p className="vm-eng-detail">No {g === "all" ? "" : `${g} `}voices published by this engine.</p>
      ) : (
        <ul role="list" className="vm-voice-grid">
          {shown.map((v) => (
            <li key={v.voice_id} className="vm-voice">
              {v.name}
              {v.gender && <span>{v.gender}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
