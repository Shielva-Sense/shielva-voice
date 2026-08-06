"use client";

import { useCallback, useEffect, useState } from "react";
import { getSettings, listEngines, type EngineCatalog, type VoiceSettings } from "./voice-settings";

/**
 * Which engines this tenant has chosen, and whether they are usable yet.
 *
 * Tools must not run before a choice exists. Previously every card rendered
 * cloud-GPU sub-engine toggles (Chatterbox / Qwen / NLLB) regardless of what
 * the tenant had actually selected — so a tenant on Cartesia saw controls for
 * models they were not using, and a tenant who had chosen nothing could still
 * fire requests at whatever the global default happened to be.
 *
 * `ready` is the gate: false until BOTH a TTS and an STT engine are selected
 * and the selected engine passes its live health probe. Cards use it to
 * disable themselves and point the user at Settings.
 */
export interface EngineGate {
  loading: boolean;
  /** Selected TTS engine id, or null when the tenant has not chosen one. */
  tts: string | null;
  /** Selected STT engine id, or null when the tenant has not chosen one. */
  stt: string | null;
  /** True when EITHER capability is usable — the page has something to offer. */
  ready: boolean;
  /** Why not ready — rendered verbatim so the user knows what to fix. */
  reason: string;
  /** Text-to-speech is chosen AND passes its probe. */
  ttsReady: boolean;
  /** Speech-to-text is chosen AND passes its probe. */
  sttReady: boolean;
  /** Per-capability explanation, for disabling one column without the other. */
  ttsReason: string;
  sttReason: string;
  /** True when the selected TTS engine is our own GPU stack, which is the only
   *  one exposing sub-engine choices (Chatterbox) and translation engines. */
  isCloudGpuTts: boolean;
  isCloudGpuStt: boolean;
  /** Languages the selected TTS engine speaks. Empty → use the client list. */
  ttsLanguages: string[];
  refresh: () => Promise<void>;
}

export function useEngineGate(enabled: boolean): EngineGate {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<VoiceSettings | null>(null);
  const [catalog, setCatalog] = useState<EngineCatalog | null>(null);
  const [err, setErr] = useState("");

  const refresh = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [s, c] = await Promise.all([getSettings(), listEngines()]);
      setSettings(s);
      setCatalog(c);
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const tts = settings?.tts_provider ?? null;
  const stt = settings?.stt_provider ?? null;

  // Each capability stands on its own. An all-or-nothing gate meant that when
  // every TTS vendor was down, a perfectly healthy speech-to-text engine was
  // unusable too and the whole page collapsed to "Choose your engines first" —
  // with nothing selectable in Settings to clear it. Transcription does not
  // depend on synthesis, so they are judged separately.
  let ttsReady = false;
  let sttReady = false;
  let ttsReason = "";
  let sttReason = "";

  if (err) {
    // FAIL OPEN — see the note below; an outage on our side must not gate tools.
    ttsReady = true;
    sttReady = true;
  } else {
    if (!tts) {
      ttsReason = "Choose a text-to-speech engine in Settings.";
    } else if (catalog) {
      const t = catalog.tts.find((r) => r.id === tts);
      if (t && !t.selectable) ttsReason = `Text-to-speech engine is unavailable — ${t.detail}`;
      else ttsReady = true;
    } else {
      ttsReady = true; // selection stored, probe unavailable — don't block on that
    }

    if (!stt) {
      sttReason = "Choose a speech-to-text engine in Settings.";
    } else if (catalog) {
      const s = catalog.stt.find((r) => r.id === stt);
      if (s && !s.selectable) sttReason = `Speech-to-text engine is unavailable — ${s.detail}`;
      else sttReady = true;
    } else {
      sttReady = true;
    }
  }

  let ready = false;
  let reason = "";
  if (err) {
    // FAIL OPEN. The settings endpoint being unreachable is OUR outage, not the
    // tenant's misconfiguration — blocking the tools behind it turns a backend
    // problem into a dead-end page with nowhere to go. Tools fall back to the
    // platform defaults, exactly as they behaved before the gate existed.
    ready = true;
    reason = "";
  } else {
    // The page is usable as soon as ONE capability works; the other column
    // renders its own disabled state with its own reason.
    ready = ttsReady || sttReady;
    if (!ready) {
      reason = !tts && !stt
        ? "Choose a speech-to-text or a text-to-speech engine in Settings to start."
        : [ttsReason, sttReason].filter(Boolean).join(" ");
    }
  }

  return {
    loading,
    tts,
    stt,
    ready,
    reason,
    ttsReady,
    sttReady,
    ttsReason,
    sttReason,
    ttsLanguages: (tts && catalog?.tts.find((r) => r.id === tts)?.languages) || [],
    isCloudGpuTts: tts === "shielva",
    isCloudGpuStt: stt === "amt",
    refresh,
  };
}
