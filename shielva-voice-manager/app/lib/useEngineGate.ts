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
  /** True only when both are chosen AND currently usable. */
  ready: boolean;
  /** Why not ready — rendered verbatim so the user knows what to fix. */
  reason: string;
  /** True when the selected TTS engine is our own GPU stack, which is the only
   *  one exposing sub-engine choices (Chatterbox) and translation engines. */
  isCloudGpuTts: boolean;
  isCloudGpuStt: boolean;
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

  let ready = false;
  let reason = "";
  if (err) {
    reason = err;
  } else if (!tts && !stt) {
    reason = "Choose a speech-to-text and a text-to-speech engine in Settings before using these tools.";
  } else if (!tts) {
    reason = "Choose a text-to-speech engine in Settings.";
  } else if (!stt) {
    reason = "Choose a speech-to-text engine in Settings.";
  } else if (catalog) {
    // A selection that no longer passes its health probe is worse than no
    // selection: the user thinks they are configured and every call fails.
    const t = catalog.tts.find((r) => r.id === tts);
    const s = catalog.stt.find((r) => r.id === stt);
    if (t && !t.selectable) reason = `Text-to-speech engine is unavailable — ${t.detail}`;
    else if (s && !s.selectable) reason = `Speech-to-text engine is unavailable — ${s.detail}`;
    else ready = true;
  } else {
    ready = true; // settings present, catalog unavailable — do not block on a probe outage
  }

  return {
    loading,
    tts,
    stt,
    ready,
    reason,
    isCloudGpuTts: tts === "shielva",
    isCloudGpuStt: stt === "amt",
    refresh,
  };
}
