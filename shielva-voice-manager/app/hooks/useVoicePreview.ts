"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSampleText } from "../components/LanguagePickerModal";
import { fetchVoiceSample, synthesize as synthesizeViaPresence } from "../lib/voice-settings";
import { fetchVoiceAudio } from "../lib/amt-api";
import { notify } from "../lib/toast";

/**
 * Hear a voice before committing to it — from wherever that voice lives.
 *
 * Two sources, because the two kinds of voice genuinely differ:
 *   · a voice cloned on our own GPU stack has a STORED REFERENCE CLIP, so it
 *     plays back directly — instant, and it costs nothing to produce;
 *   · a vendor-side voice (a Cartesia preset, or a clone living in the
 *     tenant's Cartesia account) has no clip we can fetch — the vendor keeps
 *     the model. The only way to hear one is to synthesize a sample, which is
 *     what this does, using the same time-of-day greeting the language picker
 *     pre-fills.
 *
 * Results are cached per voice+language for the life of the component, so
 * replaying never re-synthesizes and never bills twice. Shared by the voice
 * picker and the Voice Library: previewing a voice is one behaviour and should
 * not be implemented twice.
 */
export interface VoicePreviewTarget {
  /** Voice id. Empty string means "the engine's default voice". */
  id: string;
  /** True when a stored reference clip exists (our own GPU stack). */
  fromClip: boolean;
  /** ISO code the sample is spoken in. Ignored when playing a stored clip. */
  language?: string;
}

export interface VoicePreview {
  playingId: string | null;
  loadingId: string | null;
  /** Play, or stop if this voice is already playing. */
  toggle: (target: VoicePreviewTarget) => Promise<void>;
  stop: () => void;
  /** The prepared audio for a voice, if it has been fetched — for download. */
  cachedUrl: (id: string, language?: string) => string | undefined;
}

export function useVoicePreview(): VoicePreview {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urls = useRef<Record<string, string>>({});

  useEffect(() => {
    const cache = urls.current;
    return () => {
      audioRef.current?.pause();
      Object.values(cache).forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlayingId(null);
  }, []);

  const toggle = useCallback(
    async (target: VoicePreviewTarget) => {
      const { id, fromClip } = target;
      const language = target.language || "en";
      if (playingId === id) {
        stop();
        return;
      }
      stop();

      const key = `${id}|${fromClip ? "clip" : language}`;
      let url = urls.current[key];
      if (!url) {
        setLoadingId(id);
        try {
          // Prefer the customer's OWN recording where we kept one. It is what
          // they submitted, so it is what they mean by "play my voice" — a
          // synthesized sample is the clone talking, which answers a different
          // question. Falls through to synthesis when no clip was stored
          // (voices cloned before clips were kept, or presets).
          let blob: Blob | null = null;
          if (id) blob = await fetchVoiceSample(id).catch(() => null);
          if (!blob && fromClip) blob = await fetchVoiceAudio(id);
          if (!blob) {
            blob = (
              await synthesizeViaPresence({
                text: getSampleText(language),
                language,
                ...(id ? { voiceId: id } : {}),
              })
            ).blob;
          }
          url = URL.createObjectURL(blob);
          urls.current[key] = url;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg === "no_audio") {
            notify.warning("No sample stored", "This voice has no reference clip to play.");
          } else {
            notify.error("Preview failed", msg);
          }
          return;
        } finally {
          setLoadingId(null);
        }
      }

      const audio = new Audio(url);
      audioRef.current = audio;
      setPlayingId(id);
      audio.onended = () => setPlayingId(null);
      audio.onerror = () => setPlayingId(null);
      void audio.play().catch(() => setPlayingId(null));
    },
    [playingId, stop],
  );

  const cachedUrl = useCallback(
    (id: string, language?: string) =>
      urls.current[`${id}|clip`] ?? urls.current[`${id}|${language || "en"}`],
    [],
  );

  return { playingId, loadingId, toggle, stop, cachedUrl };
}
