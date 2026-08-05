"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, KeyRound, Loader2, Trash2, TriangleAlert } from "lucide-react";
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
 * Engine settings — pick what drives speech-to-text and text-to-speech.
 *
 * The server decides what is selectable (live health + subscription probe per
 * engine) and this page renders that decision rather than re-deriving it. An
 * engine that is unreachable, unconfigured, or out of quota arrives with
 * selectable=false and a reason, and is rendered disabled with the reason
 * visible — the whole point is that nobody picks an engine that will fail on
 * first use.
 */

type Status = "loading" | "ready" | "error";

export default function SettingsPage() {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string>("");
  const [catalog, setCatalog] = useState<EngineCatalog | null>(null);
  const [settings, setSettings] = useState<VoiceSettings | null>(null);
  const [saving, setSaving] = useState<string>("");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      // One round trip each, in parallel — the catalog probe is the slow one.
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
      toast.success(`${kind === "tts" ? "Text-to-speech" : "Speech-to-text"} set to ${engineLabel(id)}`);
    } catch (e) {
      toast.error("Could not save", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving("");
    }
  };

  if (status === "loading") {
    return (
      <main className="mx-auto flex min-h-[70vh] max-w-4xl flex-col items-center justify-center px-6">
        <Loader2 size={28} className="animate-spin text-neutral-400" aria-hidden="true" />
        <p className="mt-4 text-[15px] font-medium">Checking engine availability</p>
        <p className="mt-1 text-[13px] text-neutral-500">
          Each engine is probed live, so you only see what you can actually use.
        </p>
      </main>
    );
  }

  if (status === "error" || !catalog || !settings) {
    return (
      <main className="mx-auto flex min-h-[70vh] max-w-xl items-center px-6">
        <div className="w-full rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/40">
          <p className="font-medium text-red-800 dark:text-red-300">Could not load engine settings</p>
          <p className="mt-1 text-sm text-red-700 dark:text-red-400">{error}</p>
          <button
            onClick={() => void load()}
            className="mt-3 rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-800 hover:bg-red-100 dark:border-red-800 dark:text-red-300"
          >
            Retry
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <Link
        href="/"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
      >
        <ArrowLeft size={14} /> Back
      </Link>

      <h1 className="text-2xl font-semibold tracking-tight">Engine settings</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Choose what powers transcription and speech. Availability is checked live — engines that
        are unreachable, unconfigured, or out of quota cannot be selected.
      </p>

      <EngineSection
        title="Text to speech"
        blurb="Generates the spoken audio, including cloned voices."
        rows={catalog.tts}
        active={settings.tts_provider ?? catalog.active.tts}
        saving={saving}
        kind="tts"
        byok={settings.byok_configured}
        onChoose={choose}
        onKeyChanged={setSettings}
        showVoices
      />

      <EngineSection
        title="Speech to text"
        blurb="Transcribes microphone and uploaded audio."
        rows={catalog.stt}
        active={settings.stt_provider ?? catalog.active.stt}
        saving={saving}
        kind="stt"
        byok={settings.byok_configured}
        onChoose={choose}
        onKeyChanged={setSettings}
      />
    </main>
  );
}

function EngineSection({
  title,
  blurb,
  rows,
  active,
  saving,
  kind,
  byok,
  onChoose,
  onKeyChanged,
  showVoices = false,
}: {
  title: string;
  blurb: string;
  rows: EngineRow[];
  active: string;
  saving: string;
  kind: "tts" | "stt";
  byok: string[];
  onChoose: (kind: "tts" | "stt", id: string) => Promise<void>;
  onKeyChanged: (s: VoiceSettings) => void;
  showVoices?: boolean;
}) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="mt-0.5 text-sm text-neutral-500">{blurb}</p>

      <ul role="list" className="mt-4 flex flex-col gap-3">
        {rows.map((row) => (
          <EngineCard
            key={row.id}
            row={row}
            kind={kind}
            isActive={row.id === active}
            isSaving={saving === `${kind}:${row.id}`}
            hasOwnKey={byok.includes(row.id)}
            onChoose={onChoose}
            onKeyChanged={onKeyChanged}
            showVoices={showVoices}
          />
        ))}
      </ul>
    </section>
  );
}

function EngineCard({
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
  const [expanded, setExpanded] = useState(false);

  return (
    <li
      className={[
        "rounded-lg border p-4 transition-colors",
        isActive
          ? "border-green-500 bg-green-50/60 dark:border-green-700 dark:bg-green-950/30"
          : "border-neutral-200 dark:border-neutral-800",
        row.selectable ? "" : "opacity-60",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!row.selectable || isActive || isSaving}
          onClick={() => void onChoose(kind, row.id)}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-[13px] font-medium enabled:hover:bg-neutral-100 disabled:cursor-not-allowed dark:border-neutral-700 dark:enabled:hover:bg-neutral-800"
        >
          {isSaving ? "Saving…" : isActive ? "In use" : "Use this"}
        </button>

        <span className="font-medium">{engineLabel(row.id)}</span>

        <StatusPill row={row} />

        {hasOwnKey && (
          <span className="inline-flex items-center gap-1 rounded-full border border-neutral-300 px-2 py-0.5 text-[11px] text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
            <KeyRound size={11} aria-hidden="true" /> Your key
          </span>
        )}

        {typeof row.quota_left === "number" && (
          <span className="text-[12px] tabular-nums text-neutral-500">
            {row.quota_left.toLocaleString()} left
          </span>
        )}

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="ml-auto text-[13px] text-neutral-500 underline-offset-2 hover:underline"
        >
          {expanded ? "Hide" : "API key"}
        </button>
      </div>

      {/* The server's reason is the useful part — surface it verbatim rather
          than replacing it with a generic "unavailable". */}
      {row.detail && (
        <p className="mt-2 text-[13px] leading-relaxed text-neutral-600 dark:text-neutral-400">{row.detail}</p>
      )}

      {expanded && <ByokEditor engine={row.id} hasOwnKey={hasOwnKey} onChanged={onKeyChanged} />}
      {expanded && showVoices && row.selectable && <VoicePicker engine={row.id} />}
    </li>
  );
}

function StatusPill({ row }: { row: EngineRow }) {
  if (row.healthy === true) {
    return (
      <span className="inline-flex items-center gap-1 text-[12px] text-green-700 dark:text-green-400">
        <Check size={12} aria-hidden="true" /> Available
      </span>
    );
  }
  if (row.healthy === false) {
    return (
      <span className="inline-flex items-center gap-1 text-[12px] text-red-700 dark:text-red-400">
        <TriangleAlert size={12} aria-hidden="true" /> Unavailable
      </span>
    );
  }
  // null — no probe exists. Say so; do not imply a check passed.
  return <span className="text-[12px] text-neutral-500">Not checked</span>;
}

function ByokEditor({
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
  const inputId = `byok-${engine}`;

  const save = async () => {
    setBusy(true);
    try {
      onChanged(await saveByokKey(engine, value.trim()));
      setValue("");
      toast.success(`Key saved for ${engineLabel(engine)}`);
    } catch (e) {
      toast.error("Could not save key", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      onChanged(await deleteByokKey(engine));
      toast.success(`Removed your key for ${engineLabel(engine)}`);
    } catch (e) {
      toast.error("Could not remove key", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <label htmlFor={inputId} className="block text-[13px] font-medium">
        Use your own {engineLabel(engine)} account
      </label>
      <p className="mt-0.5 text-[12px] text-neutral-500">
        Billed to your account instead of ours. Stored encrypted; it is never shown again after
        saving.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          id={inputId}
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={hasOwnKey ? "A key is already saved — enter a new one to replace it" : "API key"}
          className="min-w-[18rem] flex-1 rounded-md border border-neutral-300 px-2.5 py-1.5 text-[13px] dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || value.trim().length < 8}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-[13px] enabled:hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:enabled:hover:bg-neutral-800"
        >
          Save
        </button>
        {hasOwnKey && (
          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy}
            aria-label={`Remove your ${engineLabel(engine)} key`}
            className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-2.5 py-1.5 text-[13px] text-red-700 enabled:hover:bg-red-50 disabled:opacity-50 dark:border-neutral-700 dark:text-red-400"
          >
            <Trash2 size={13} aria-hidden="true" /> Remove
          </button>
        )}
      </div>
    </div>
  );
}

function VoicePicker({ engine }: { engine: string }) {
  const [voices, setVoices] = useState<PresetVoice[] | null>(null);
  const [err, setErr] = useState("");
  const [gender, setGender] = useState<"all" | "male" | "female">("all");

  useEffect(() => {
    let cancelled = false;
    listEngineVoices(engine)
      .then((r) => {
        if (!cancelled) setVoices(r.voices);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [engine]);

  if (err) return <p className="mt-3 text-[13px] text-red-700 dark:text-red-400">{err}</p>;
  if (!voices) return <p className="mt-3 text-[13px] text-neutral-500">Loading voices…</p>;

  const shown = gender === "all" ? voices : voices.filter((v) => v.gender === gender);

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-medium">Sample voices</span>
        {(["all", "male", "female"] as const).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setGender(g)}
            aria-pressed={gender === g}
            className={[
              "rounded-full border px-2.5 py-0.5 text-[12px] capitalize",
              gender === g
                ? "border-neutral-800 bg-neutral-800 text-white dark:border-neutral-200 dark:bg-neutral-200 dark:text-neutral-900"
                : "border-neutral-300 dark:border-neutral-700",
            ].join(" ")}
          >
            {g}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="mt-2 text-[13px] text-neutral-500">
          This engine publishes no {gender === "all" ? "" : `${gender} `}sample voices.
        </p>
      ) : (
        <ul role="list" className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {shown.map((v) => (
            <li
              key={v.voice_id}
              className="rounded-md border border-neutral-200 px-2.5 py-1.5 text-[13px] dark:border-neutral-800"
            >
              <span className="font-medium">{v.name}</span>
              {v.gender && <span className="ml-1.5 text-[12px] text-neutral-500">{v.gender}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
