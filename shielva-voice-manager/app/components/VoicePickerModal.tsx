"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Search, Play, Pause, Volume2 } from "lucide-react";
import { getSampleText } from "./LanguagePickerModal";
import { synthesize as synthesizeViaPresence, type PresetVoice } from "../lib/voice-settings";
import { fetchVoiceAudio } from "../lib/amt-api";
import { notify } from "../lib/toast";

/**
 * Voice picker with an audible preview.
 *
 * A dropdown of forty-odd vendor voice names ("Henry - Plainspoken Guy") tells
 * you nothing about how a voice sounds, and the whole point of choosing one is
 * how it sounds. So this mirrors the language picker: a searchable card grid,
 * each card with its own play button.
 *
 * Previews come from two different places on purpose:
 *   · a cloned voice plays its STORED REFERENCE CLIP — it is already on disk,
 *     so there is nothing to generate and nothing to bill;
 *   · a vendor preset is synthesized once, through presence-core, using the
 *     same time-of-day greeting the language picker pre-fills. Results are
 *     cached per voice+language for the life of the modal, so replaying or
 *     re-opening never re-synthesizes.
 */

/** A cloned voice, from whichever store owns it for the selected engine. */
export interface ClonedVoiceOption {
  voice_id: string;
  name: string;
  detail: string;
  /**
   * True when the voice has a stored reference clip we can play back directly
   * (our own GPU stack). False for a vendor-side clone, which has no clip to
   * fetch and must be previewed by synthesizing with it.
   */
  previewFromClip: boolean;
}

export interface VoicePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Currently selected voice id. "" means the engine's default voice. */
  value: string;
  onSelect: (voiceId: string) => void;
  /** The engine's preset voices, already filtered to `language`. */
  presets: PresetVoice[];
  /** This account's cloned voices. Empty when the engine cannot clone. */
  cloned: ClonedVoiceOption[];
  engineName: string;
  /** ISO code of the output language — previews are spoken in it. */
  language: string;
  languageLabel: string;
}

const SECTION_LABEL: React.CSSProperties = {
  display: "inline-block",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.7px",
  textTransform: "uppercase",
  color: "#ffffff",
  background: "#537f28",
  padding: "3px 10px",
  borderRadius: 20,
  marginBottom: 14,
};

interface VoiceCard {
  id: string;
  name: string;
  detail: string;
  /** Play the stored reference clip instead of synthesizing a sample. */
  fromClip: boolean;
}

export default function VoicePickerModal({
  isOpen,
  onClose,
  value,
  onSelect,
  presets,
  cloned,
  engineName,
  language,
  languageLabel,
}: VoicePickerModalProps) {
  const [query, setQuery] = useState("");
  const [hovered, setHovered] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** voiceId|language → object URL. Kept for the life of the modal. */
  const previewUrls = useRef<Record<string, string>>({});

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Stop playback whenever the modal closes — audio outliving the dialog it
  // belongs to is disorienting.
  useEffect(() => {
    if (isOpen) return;
    audioRef.current?.pause();
    audioRef.current = null;
    setPlayingId(null);
  }, [isOpen]);

  useEffect(() => {
    const urls = previewUrls.current;
    return () => {
      audioRef.current?.pause();
      Object.values(urls).forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", fn);
    return () => document.removeEventListener("keydown", fn);
  }, [isOpen, onClose]);

  const clonedCards: VoiceCard[] = cloned.map((v) => ({
    id: v.voice_id,
    name: v.name || v.voice_id,
    detail: v.detail,
    fromClip: v.previewFromClip,
  }));

  const presetCards: VoiceCard[] = presets.map((p) => ({
    id: p.voice_id,
    name: p.name,
    detail: [p.gender, p.description].filter(Boolean).join(" · ") || languageLabel,
    fromClip: false,
  }));

  const filter = (cards: VoiceCard[]) => {
    const q = query.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter((c) => c.name.toLowerCase().includes(q) || c.detail.toLowerCase().includes(q));
  };

  const shownCloned = useMemo(() => filter(clonedCards), [clonedCards, query]);
  const shownPresets = useMemo(() => filter(presetCards), [presetCards, query]);

  const play = async (card: VoiceCard | null) => {
    const id = card?.id ?? "";
    // Second click on the one that is playing = stop.
    if (playingId === id) {
      audioRef.current?.pause();
      audioRef.current = null;
      setPlayingId(null);
      return;
    }
    audioRef.current?.pause();
    audioRef.current = null;
    setPlayingId(null);

    const key = `${id}|${language}`;
    let url = previewUrls.current[key];
    if (!url) {
      setLoadingId(id);
      try {
        const blob = card?.fromClip
          ? await fetchVoiceAudio(card.id)
          : (await synthesizeViaPresence({
              text: getSampleText(language),
              language,
              ...(id ? { voiceId: id } : {}),
            })).blob;
        url = URL.createObjectURL(blob);
        previewUrls.current[key] = url;
      } catch (err) {
        setLoadingId(null);
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === "no_audio") notify.warning("No sample stored", "This voice has no reference clip to play.");
        else notify.error("Preview failed", msg);
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
  };

  if (!isOpen || !mounted) return null;

  const renderCard = (card: VoiceCard | null) => {
    const id = card?.id ?? "";
    const name = card?.name ?? `Default ${engineName} voice`;
    const detail = card?.detail ?? "Whatever the engine picks for this language";
    const sel = id === value;
    const hov = hovered === id;
    const isPlaying = playingId === id;
    const isLoading = loadingId === id;
    return (
      <div
        key={id || "__default__"}
        onMouseEnter={() => setHovered(id)}
        onMouseLeave={() => setHovered(null)}
        onClick={() => {
          onSelect(id);
          onClose();
        }}
        style={{
          padding: "14px 14px 12px",
          borderRadius: 10,
          border: sel
            ? "2px solid #6d9f37"
            : hov
              ? "2px solid var(--border, #ccc)"
              : "1px solid var(--border-subtle, rgba(255,255,255,0.1))",
          background: sel ? "rgba(109,159,55,0.1)" : hov ? "rgba(255,255,255,0.05)" : "var(--surface-subtle)",
          cursor: "pointer",
          transition: "border-color 0.12s, background 0.12s",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          minHeight: 96,
          userSelect: "none",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void play(card);
            }}
            disabled={isLoading}
            aria-label={isPlaying ? `Stop preview of ${name}` : `Play a sample of ${name}`}
            title={isPlaying ? "Stop" : `Hear ${name} in ${languageLabel}`}
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: isLoading ? "progress" : "pointer",
              background: isPlaying ? "#6d9f37" : "rgba(109,159,55,0.12)",
              border: "1px solid rgba(109,159,55,0.35)",
              color: isPlaying ? "#fff" : "#6d9f37",
            }}
          >
            {isLoading ? (
              <div className="vm-spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />
            ) : isPlaying ? (
              <Pause size={14} strokeWidth={2.5} />
            ) : (
              <Play size={14} strokeWidth={2.5} />
            )}
          </button>
          {sel && (
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: "#6d9f37",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 10,
                fontWeight: 700,
                color: "#fff",
                flexShrink: 0,
              }}
            >
              ✓
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: sel ? "#6d9f37" : "var(--text-primary)",
            lineHeight: 1.25,
          }}
        >
          {name}
        </div>
        <div
          style={{
            fontSize: 10,
            color: "var(--text-muted)",
            lineHeight: 1.45,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {detail}
        </div>
      </div>
    );
  };

  const grid: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(175px, 1fr))",
    gap: 10,
  };

  const modal = (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.65)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
        overflow: "hidden",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "var(--card, #1a1a1a)",
          borderRadius: 16,
          width: "100%",
          maxWidth: 700,
          height: "min(680px, calc(100vh - 40px))",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 32px 80px rgba(0,0,0,0.5)",
          border: "1px solid var(--border-subtle, rgba(255,255,255,0.1))",
          animation: "lpm-in 0.18s ease",
          overflow: "hidden",
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Select voice"
      >
        {/* Header */}
        <div
          style={{
            flexShrink: 0,
            padding: "16px 18px 0",
            borderBottom: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                onClick={onClose}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: 8,
                  padding: "6px 12px",
                  color: "var(--text-primary)",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                ← Back
              </button>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>Select Voice</div>
                <div style={{ fontSize: 11, color: "#6d9f37", marginTop: 2 }}>
                  {engineName} · {languageLabel} — press play to hear a sample
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                flexShrink: 0,
                background: "rgba(255,255,255,0.1)",
                border: "1px solid rgba(255,255,255,0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                color: "var(--text-primary)",
              }}
            >
              <X size={16} strokeWidth={2.5} />
            </button>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 8,
              padding: "8px 12px",
              marginBottom: 14,
            }}
          >
            <Search size={14} color="#6d9f37" style={{ flexShrink: 0 }} />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search voices…"
              aria-label="Search voices"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{
                flex: 1,
                border: "none",
                background: "transparent",
                fontSize: 13,
                color: "var(--text-primary)",
                outline: "none",
              }}
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                aria-label="Clear search"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-muted)",
                  fontSize: 18,
                  lineHeight: 1,
                  padding: 0,
                }}
              >
                ×
              </button>
            )}
          </div>
        </div>

        {/* Cards */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "18px 18px 32px" }}>
          {!query && (
            <div style={{ marginBottom: 24 }}>
              <div style={SECTION_LABEL}>Default</div>
              <div style={grid}>{renderCard(null)}</div>
            </div>
          )}

          {shownCloned.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={SECTION_LABEL}>Your cloned voices</div>
              <div style={grid}>{shownCloned.map((c) => renderCard(c))}</div>
            </div>
          )}

          {shownPresets.length > 0 && (
            <div>
              <div style={{ ...SECTION_LABEL, background: "#416223" }}>{engineName} voices</div>
              <div style={grid}>{shownPresets.map((c) => renderCard(c))}</div>
            </div>
          )}

          {shownCloned.length === 0 && shownPresets.length === 0 && (
            <div
              style={{
                textAlign: "center",
                padding: "48px 0",
                color: "var(--text-muted)",
                fontSize: 13,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
              }}
            >
              <Volume2 size={32} strokeWidth={1.5} />
              {query
                ? `No voices match “${query}”.`
                : `${engineName} publishes no voices for ${languageLabel}. Pick another output language, or change engine in Settings.`}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes lpm-in {
          from { opacity: 0; transform: scale(0.95) translateY(8px); }
          to   { opacity: 1; transform: scale(1)    translateY(0);   }
        }
      `}</style>
    </div>
  );

  return createPortal(modal, document.body);
}
