"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  BarChart3,
  Mic,
  Languages,
  AudioWaveform,
  Volume2,
  BrainCircuit,
  Type,
  Play,
  Pause,
  Download,
  ChevronDown,
  ChevronUp,
  Activity,
  Hash,
  FileText,
  Clock,
  X,
  Search,
  Filter,
  ExternalLink,
  Trash2,
  Radio,
} from "lucide-react";
import {
  getHistory,
  getHistoryStats,
  deleteHistoryItem,
  getLiveTranslationClips,
  type HistoryResponse,
  type HistoryStats,
  type ProcessedItem,
} from "../lib/amt-api";
import { useAuth } from "../context/AuthContext";

const AMT_BASE = process.env.NEXT_PUBLIC_API_URL || "https://localhost:8000";

// ─── Constants ───────────────────────────────────────────────────────────────

const FEATURE_COLORS: Record<string, string> = {
  transcribe:       "#8cb856",
  translate:        "#6d9f37",
  synthesize:       "#537f28",
  vocoder:          "#abcc7e",
  classify:         "#416223",
  phonemize:        "#cde1ae",
  live_translation: "#14b8a6",
};

const FEATURE_ICONS: Record<string, React.ComponentType<{ size?: number; strokeWidth?: number; color?: string }>> = {
  transcribe:       Mic,
  translate:        Languages,
  synthesize:       AudioWaveform,
  vocoder:          Volume2,
  classify:         BrainCircuit,
  phonemize:        Type,
  live_translation: Radio,
};

const FEATURE_OPTIONS = [
  { value: "",               label: "All Features" },
  { value: "transcribe",     label: "Speech to Text" },
  { value: "translate",      label: "Translation" },
  { value: "synthesize",     label: "Text to Speech" },
  { value: "vocoder",        label: "Voice Synthesis" },
  { value: "live_translation", label: "Live Translation" },
  { value: "classify",       label: "Intent Classification" },
  { value: "phonemize",      label: "Phonemization" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Ensure UTC parsing: append Z if no timezone info (MongoDB stores naive UTC datetimes) */
function parseUTC(dateStr: string): Date {
  if (dateStr && !dateStr.endsWith("Z") && !/[+-]\d{2}:\d{2}$/.test(dateStr)) {
    return new Date(dateStr + "Z");
  }
  return new Date(dateStr);
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - parseUTC(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatTimestamp(dateStr: string): string {
  const d = parseUTC(dateStr);
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const glassCard: React.CSSProperties = {
  background: "var(--surface-subtle)",
  border: "1px solid var(--border-subtle)",
  backdropFilter: "blur(8px)",
  borderRadius: "10px",
  padding: "16px",
  flex: "1 1 0",
  minWidth: 0,
};

const sectionTitle: React.CSSProperties = {
  fontSize: "11px",
  fontWeight: 600,
  textTransform: "uppercase" as const,
  letterSpacing: "0.6px",
  color: "var(--gray-400, #888)",
  marginBottom: "10px",
};

const skeletonPulse: React.CSSProperties = {
  background: "linear-gradient(90deg, var(--surface-subtle) 25%, var(--surface-hover) 50%, var(--surface-subtle) 75%)",
  backgroundSize: "200% 100%",
  animation: "shimmer 1.5s infinite",
  borderRadius: "6px",
};

// ─── Item Row (shared between summary + modal) ──────────────────────────────

function ItemRow({
  item,
  isExpanded,
  isPlaying,
  onToggle,
  onPlay,
  onDownload,
  onSpeak,
  isSpeaking,
  showTimestamp,
}: {
  item: ProcessedItem;
  isExpanded: boolean;
  isPlaying: boolean;
  onToggle: () => void;
  onPlay: () => void;
  onDownload: () => void;
  onSpeak?: () => void;
  isSpeaking?: boolean;
  showTimestamp?: boolean;
}) {
  const Icon = FEATURE_ICONS[item.feature] || Activity;
  const color = FEATURE_COLORS[item.feature] || "#8cb856";

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: "10px 12px",
          borderRadius: "8px",
          background: isExpanded ? "var(--surface-subtle)" : "transparent",
          transition: "background 0.15s",
          cursor: "pointer",
        }}
        onClick={onToggle}
      >
        <div
          style={{
            width: "28px",
            height: "28px",
            borderRadius: "6px",
            background: `${color}18`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Icon size={14} strokeWidth={2} color={color} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "11px", fontWeight: 600, color, textTransform: "capitalize" }}>
              {item.feature_label}
            </span>
            <span style={{ fontSize: "10px", color: "var(--gray-600, #555)" }}>
              {showTimestamp ? formatTimestamp(item.created_at) : timeAgo(item.created_at)}
            </span>
          </div>
          <div
            style={{
              fontSize: "12px",
              color: "var(--gray-400, #888)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: "100%",
              marginTop: "2px",
            }}
          >
            {(() => {
              const od = item.output_data as Record<string, string> | null;
              const inputText =
                item.feature === "live_translation" && od
                  ? (od.transcript || `${od.src_lang ?? ""} → ${od.tgt_lang ?? ""}`)
                  : item.input_summary || (item.feature === "translate" && od ? od.text : null) || "—";
              const isMelSpec = item.output_summary?.startsWith("Mel spectrogram");
              const outputText =
                (item.feature === "translate" ? od?.translated_text : null)
                || (item.feature === "live_translation" ? od?.translation : null)
                || (!isMelSpec ? item.output_summary : null)
                || (isMelSpec ? item.input_summary : null)
                || null;
              return (
                <>
                  {inputText}
                  {outputText && (
                    <span style={{ color: "var(--bamboo-400, #8cb856)" }}>{" → "}{outputText}</span>
                  )}
                </>
              );
            })()}
          </div>
        </div>

        {/* Audio controls — output audio (synthesize) or input audio (transcribe) */}
        {(item.audio_url || item.input_url) && (
          <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
            <button
              onClick={(e) => { e.stopPropagation(); onPlay(); }}
              style={{
                background: "var(--surface-subtle)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "6px",
                padding: "4px 6px",
                cursor: "pointer",
                color: isPlaying ? "var(--bamboo-400, #8cb856)" : "var(--gray-400, #888)",
                display: "flex",
                alignItems: "center",
              }}
              title={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <Pause size={12} /> : <Play size={12} />}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDownload(); }}
              style={{
                background: "var(--surface-subtle)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "6px",
                padding: "4px 6px",
                cursor: "pointer",
                color: "var(--gray-400, #888)",
                display: "flex",
                alignItems: "center",
              }}
              title="Download"
            >
              <Download size={12} />
            </button>
          </div>
        )}
        {/* Speak button — translate entries with no audio file */}
        {!item.audio_url && !item.input_url && item.feature === "translate" && onSpeak && (
          <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
            <button
              onClick={(e) => { e.stopPropagation(); onSpeak(); }}
              style={{
                background: isSpeaking ? "rgba(140,184,86,0.12)" : "var(--surface-subtle)",
                border: `1px solid ${isSpeaking ? "rgba(140,184,86,0.3)" : "var(--border-subtle)"}`,
                borderRadius: "6px",
                padding: "4px 6px",
                cursor: "pointer",
                color: isSpeaking ? "var(--bamboo-400, #8cb856)" : "var(--gray-400, #888)",
                display: "flex",
                alignItems: "center",
                gap: "3px",
                fontSize: "10px",
              }}
              title={isSpeaking ? "Stop speaking" : "Listen to translation"}
            >
              <Volume2 size={12} />
            </button>
          </div>
        )}

        <div style={{ flexShrink: 0, color: "var(--gray-500, #666)" }}>
          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </div>

      {/* Expanded details */}
      {isExpanded && (
        <div
          style={{
            padding: "10px 12px 10px 50px",
            fontSize: "12px",
            color: "var(--gray-300, #aaa)",
            lineHeight: "1.6",
            background: "var(--surface-subtle)",
            borderRadius: "0 0 8px 8px",
            marginTop: "-2px",
            borderTop: "1px solid var(--border-subtle)",
          }}
        >
          <div style={{ marginBottom: 6 }}>
            <span style={{ color: "var(--gray-500)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.5px" }}>Input</span>
            <div style={{ marginTop: 2, wordBreak: "break-word" }}>
              {item.input_summary
                || (item.feature === "translate" && item.output_data ? (item.output_data as Record<string, string>).text : null)
                || <span style={{ color: "var(--gray-600)" }}>No input recorded</span>}
            </div>
          </div>
          <div>
            <span style={{ color: "var(--gray-500)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.5px" }}>Output</span>
            <div style={{ marginTop: 2, wordBreak: "break-word", whiteSpace: "pre-wrap" }}>
              {item.output_data ? (
                item.feature === "translate" ? (
                  <div>
                    <div style={{ color: "var(--bamboo-300, #c5e08a)", fontWeight: 500 }}>
                      {(item.output_data as Record<string, string>).translated_text || <span style={{ color: "var(--gray-600)" }}>Empty translation</span>}
                    </div>
                    {(item.output_data as Record<string, string>).src_lang && (
                      <div style={{ fontSize: 10, color: "var(--gray-500)", marginTop: 4 }}>
                        {(item.output_data as Record<string, string>).src_lang} → {(item.output_data as Record<string, string>).tgt_lang}
                      </div>
                    )}
                  </div>
                ) : item.feature === "transcribe" ? (
                  <div style={{ color: "var(--bamboo-300, #c5e08a)" }}>
                    {(item.output_data as Record<string, string>).text}
                  </div>
                ) : item.feature === "classify" ? (
                  <div>
                    <span style={{ color: "var(--bamboo-300)", fontWeight: 600 }}>
                      {(item.output_data as Record<string, unknown>).intent as string}
                    </span>
                    <span style={{ color: "var(--gray-500)", marginLeft: 8 }}>
                      {(((item.output_data as Record<string, unknown>).confidence as number) * 100).toFixed(1)}%
                    </span>
                  </div>
                ) : (
                  item.output_summary
                )
              ) : (
                item.output_summary || "No output data"
              )}
            </div>
          </div>
          {(item.audio_url || item.input_url) && (
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
              {(item.audio_size_bytes || item.input_size_bytes) && (
                <span style={{ fontSize: 10, color: "var(--gray-500)" }}>
                  {item.audio_url ? "Output" : "Input"} audio: {((item.audio_size_bytes || item.input_size_bytes || 0) / 1024).toFixed(1)} KB
                </span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onPlay(); }}
                style={{
                  background: "rgba(140,184,86,0.1)", border: "1px solid rgba(140,184,86,0.25)",
                  borderRadius: "5px", padding: "3px 8px", cursor: "pointer",
                  color: isPlaying ? "var(--bamboo-400)" : "var(--bamboo-500)",
                  display: "flex", alignItems: "center", gap: 4, fontSize: 10,
                }}
              >
                {isPlaying ? <Pause size={10} /> : <Play size={10} />}
                {isPlaying ? "Pause" : "Play"}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDownload(); }}
                style={{
                  background: "var(--surface-subtle)", border: "1px solid var(--border-subtle)",
                  borderRadius: "5px", padding: "3px 8px", cursor: "pointer",
                  color: "var(--gray-400)", display: "flex", alignItems: "center", gap: 4, fontSize: 10,
                }}
              >
                <Download size={10} /> Download
              </button>
            </div>
          )}
          {!item.audio_url && !item.input_url && item.feature === "translate" && onSpeak && (
            <div style={{ marginTop: 8 }}>
              <button
                onClick={(e) => { e.stopPropagation(); onSpeak(); }}
                style={{
                  background: isSpeaking ? "rgba(140,184,86,0.15)" : "rgba(140,184,86,0.08)",
                  border: `1px solid ${isSpeaking ? "rgba(140,184,86,0.35)" : "rgba(140,184,86,0.2)"}`,
                  borderRadius: "5px", padding: "3px 8px", cursor: "pointer",
                  color: isSpeaking ? "var(--bamboo-400)" : "var(--bamboo-500)",
                  display: "flex", alignItems: "center", gap: 4, fontSize: 10,
                }}
              >
                <Volume2 size={10} /> {isSpeaking ? "Stop" : "Listen"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── WAV encoder ─────────────────────────────────────────────────────────────
function audioBufferToWav(buffer: AudioBuffer): Blob {
  const samples = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const arrayBuffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(arrayBuffer);
  const writeStr = (off: number, str: string) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
  writeStr(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE"); writeStr(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  writeStr(36, "data"); view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true); off += 2;
  }
  return new Blob([arrayBuffer], { type: "audio/wav" });
}

// ─── Waveform range selector ──────────────────────────────────────────────────
function WaveformRange({
  wavUrl, start, end, duration, onChange, onDurationLoaded,
}: {
  wavUrl: string; start: number; end: number; duration: number;
  onChange: (s: number, e: number) => void;
  onDurationLoaded: (d: number) => void;
}) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [peaks, setPeaks] = useState<number[]>([]);
  const dragging = useRef<"start" | "end" | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(wavUrl);
        const ab   = await resp.arrayBuffer();
        const ctx  = new AudioContext();
        const buf  = await ctx.decodeAudioData(ab);
        if (cancelled) return;
        onDurationLoaded(buf.duration);
        const data = buf.getChannelData(0);
        const N = 180;
        const step = Math.max(1, Math.floor(data.length / N));
        const p: number[] = [];
        for (let i = 0; i < N; i++) {
          let max = 0;
          for (let j = 0; j < step; j++) { const v = Math.abs(data[i * step + j] || 0); if (v > max) max = v; }
          p.push(max);
        }
        if (!cancelled) setPeaks(p);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [wavUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || peaks.length === 0 || duration <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth, H = canvas.offsetHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    const sx = (start / duration) * W, ex = (end / duration) * W;
    const barW = Math.max(1, W / peaks.length - 0.5);
    peaks.forEach((p, i) => {
      const x = (i / peaks.length) * W;
      const h = Math.max(2, p * H * 0.85);
      ctx.fillStyle = x >= sx && x + barW <= ex ? "#14b8a6" : "rgba(20,184,166,0.18)";
      ctx.fillRect(x, (H - h) / 2, barW, h);
    });
  }, [peaks, start, end, duration]);

  const getTime = (clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || duration <= 0) return 0;
    return Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration));
  };

  const startPct = duration > 0 ? (start / duration) * 100 : 0;
  const endPct   = duration > 0 ? (end   / duration) * 100 : 100;

  const makeHandleProps = (which: "start" | "end") => ({
    onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
      e.stopPropagation(); e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragging.current = which;
    },
    onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
      if (dragging.current !== which) return;
      const t = getTime(e.clientX);
      if (which === "start") onChange(Math.min(t, end - 0.05), end);
      else onChange(start, Math.max(t, start + 0.05));
    },
    onPointerUp()     { dragging.current = null; },
    onPointerCancel() { dragging.current = null; },
  });

  return (
    <div onMouseDown={(e) => e.stopPropagation()} onDragStart={(e) => e.preventDefault()}>
      <div ref={containerRef} style={{ position: "relative", height: 44, userSelect: "none", borderRadius: 6, background: "rgba(20,184,166,0.05)", border: "1px solid rgba(20,184,166,0.15)", marginBottom: 14 }}>
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block", borderRadius: 6 }} />
        <div style={{ position: "absolute", top: 0, bottom: 0, left: `${startPct}%`, right: `${100 - endPct}%`, background: "rgba(20,184,166,0.12)", pointerEvents: "none" }} />
        {/* Start handle */}
        <div {...makeHandleProps("start")} style={{ position: "absolute", top: 0, bottom: 0, left: `${startPct}%`, width: 12, cursor: "ew-resize", transform: "translateX(-6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2 }}>
          <div style={{ width: 4, height: "100%", background: "#14b8a6", borderRadius: 2, position: "relative" }}>
            <div style={{ position: "absolute", bottom: -7, left: "50%", transform: "translateX(-50%)", width: 11, height: 11, background: "#14b8a6", borderRadius: "50%", border: "2px solid var(--card, #fff)" }} />
          </div>
        </div>
        {/* End handle */}
        <div {...makeHandleProps("end")} style={{ position: "absolute", top: 0, bottom: 0, left: `${endPct}%`, width: 12, cursor: "ew-resize", transform: "translateX(-6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2 }}>
          <div style={{ width: 4, height: "100%", background: "#14b8a6", borderRadius: 2, position: "relative" }}>
            <div style={{ position: "absolute", bottom: -7, left: "50%", transform: "translateX(-50%)", width: 11, height: 11, background: "#14b8a6", borderRadius: "50%", border: "2px solid var(--card, #fff)" }} />
          </div>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--gray-500)", marginTop: -8 }}>
        <span>{start.toFixed(2)}s</span>
        <span style={{ color: "#14b8a6" }}>{(end - start).toFixed(2)}s selected</span>
        <span>{end.toFixed(2)}s</span>
      </div>
    </div>
  );
}

// ─── Live Clips Modal ─────────────────────────────────────────────────────────

function LiveClipsModal({
  srcLang, tgtLang, onClose,
}: {
  srcLang: string; tgtLang: string; onClose: () => void;
}) {
  const [clips, setClips]       = useState<ProcessedItem[]>([]);
  const [loading, setLoading]   = useState(true);
  const [merging, setMerging]   = useState(false);
  const [order, setOrder]       = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [ranges, setRanges]     = useState<Record<string, { start: number; end: number }>>({});
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [filename, setFilename] = useState(`lt_${srcLang}_${tgtLang}_merged`);
  const [dragSrcId, setDragSrcId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLoading(true);
    getLiveTranslationClips(0, 200)
      .then((res) => {
        const filtered = res.items.filter((item) => {
          const od = item.output_data as Record<string, string> | null;
          // Include all clips for this lang pair — show play only if audio exists
          return od && od.src_lang === srcLang && od.tgt_lang === tgtLang;
        });
        setClips(filtered);
        // Only select clips that have audio (can actually be merged)
        const withAudio = filtered.filter(c => c.audio_url || c.input_url);
        setOrder(withAudio.map(c => c.id));
        setSelectedIds(new Set(withAudio.map(c => c.id)));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [srcLang, tgtLang]);

  useEffect(() => () => { audioRef.current?.pause(); }, []);

  // Sync indeterminate state on select-all checkbox
  useEffect(() => {
    if (!selectAllRef.current) return;
    const allCount = clips.filter(c => order.includes(c.id)).length;
    selectAllRef.current.indeterminate = selectedIds.size > 0 && selectedIds.size < allCount;
  }, [selectedIds, clips, order]);

  const orderedClips = order.map(id => clips.find(c => c.id === id)).filter(Boolean) as ProcessedItem[];
  const selectedCount = orderedClips.filter(c => selectedIds.has(c.id)).length;
  const hasAnyText = clips.some(c => {
    const d = c.output_data as Record<string, string> | null;
    return d?.transcript?.trim() || d?.translation?.trim();
  });

  const toggleSelect = (id: string) => setSelectedIds(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const toggleAll = () => setSelectedIds(
    selectedIds.size === clips.length ? new Set() : new Set(clips.map(c => c.id))
  );

  // audio_url from MongoDB is a relative path (/cdn/download/...) — prepend gateway base
  const fullUrl = (relUrl: string | null | undefined) =>
    relUrl ? (relUrl.startsWith("http") ? relUrl : AMT_BASE + relUrl) : null;

  const playClip = (item: ProcessedItem) => {
    const url = fullUrl(item.audio_url || item.input_url);
    if (!url) return;
    if (activeId === item.id) {
      if (audioRef.current?.paused) { audioRef.current.play(); setIsPlaying(true); }
      else { audioRef.current?.pause(); setIsPlaying(false); }
      return;
    }
    audioRef.current?.pause();
    setActiveId(item.id);
    const audio = new Audio(url);
    audio.onplay  = () => setIsPlaying(true);
    audio.onpause = () => setIsPlaying(false);
    audio.onended = () => { setActiveId(null); setIsPlaying(false); };
    audio.play(); audioRef.current = audio; setIsPlaying(true);
  };

  const mergeAndDownload = async () => {
    setMerging(true);
    try {
      const ctx = new AudioContext();
      const buffers: AudioBuffer[] = [];
      for (const clip of orderedClips.filter(c => selectedIds.has(c.id))) {
        const url = fullUrl(clip.audio_url || clip.input_url);
        if (!url) continue;
        const resp = await fetch(url);
        const ab   = await resp.arrayBuffer();
        const buf  = await ctx.decodeAudioData(ab);
        const dur  = durations[clip.id] || buf.duration;
        const range = ranges[clip.id] ?? { start: 0, end: dur };
        const s = Math.round((range.start / dur) * buf.length);
        const e = Math.round((range.end   / dur) * buf.length);
        const trimmed = ctx.createBuffer(1, Math.max(1, e - s), buf.sampleRate);
        trimmed.getChannelData(0).set(buf.getChannelData(0).subarray(s, e));
        buffers.push(trimmed);
      }
      if (!buffers.length) return;
      const totalLen = buffers.reduce((a, b) => a + b.length, 0);
      const merged   = ctx.createBuffer(1, totalLen, buffers[0].sampleRate);
      const out      = merged.getChannelData(0);
      let off = 0;
      for (const buf of buffers) { out.set(buf.getChannelData(0), off); off += buf.length; }
      const blob = audioBufferToWav(merged);
      const a    = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${filename || "merged"}.wav`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch { /* silent */ } finally { setMerging(false); }
  };

  const downloadAllText = () => {
    const sections = clips.map((c, i) => {
      const d = c.output_data as Record<string, string> | null;
      const lines = [`── Clip ${i + 1} · ${formatTimestamp(c.created_at)} ──`];
      if (d?.transcript?.trim())  lines.push(`[${srcLang.toUpperCase()}] ${d.transcript}`);
      if (d?.translation?.trim()) lines.push(`[${tgtLang.toUpperCase()}] ${d.translation}`);
      return lines.join("\n");
    });
    const blob = new Blob([sections.join("\n\n")], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `lt_${srcLang}_${tgtLang}_${clips.length}clips.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // Drag-to-reorder
  const onDragStart = (id: string) => (e: React.DragEvent) => { setDragSrcId(id); e.dataTransfer.effectAllowed = "move"; };
  const onDragOver  = (id: string) => (e: React.DragEvent) => { e.preventDefault(); setDragOverId(id); };
  const onDrop      = (id: string) => (e: React.DragEvent) => {
    e.preventDefault();
    if (dragSrcId && dragSrcId !== id) {
      setOrder(prev => {
        const n = [...prev], fi = n.indexOf(dragSrcId), ti = n.indexOf(id);
        n.splice(fi, 1); n.splice(ti, 0, dragSrcId); return n;
      });
    }
    setDragSrcId(null); setDragOverId(null);
  };
  const onDragEnd = () => { setDragSrcId(null); setDragOverId(null); };

  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: 10001, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.8)", backdropFilter: "blur(6px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: "min(820px, calc(100vw - 32px))", maxHeight: "88vh", background: "var(--card, #ffffff)", border: "1px solid var(--border-subtle)", borderRadius: 14, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: "rgba(20,184,166,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Radio size={14} color="#14b8a6" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Live Translation Clips</div>
            <div style={{ fontSize: 11, color: "var(--gray-500)", marginTop: 1 }}>
              {srcLang.toUpperCase()} → {tgtLang.toUpperCase()} · {loading ? "loading…" : `${clips.length} clips`}
            </div>
          </div>
          {!loading && hasAnyText && (
            <button onClick={downloadAllText} style={{ background: "rgba(20,184,166,0.08)", border: "1px solid rgba(20,184,166,0.25)", borderRadius: 6, padding: "5px 10px", cursor: "pointer", color: "#14b8a6", display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 500 }}>
              <Download size={12} /> All Text
            </button>
          )}
          <button onClick={onClose} style={{ background: "var(--surface-subtle)", border: "1px solid var(--border-subtle)", borderRadius: 6, padding: 4, cursor: "pointer", color: "var(--gray-400)", display: "flex" }}>
            <X size={16} />
          </button>
        </div>

        {/* ── Select-all bar ── */}
        {!loading && clips.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 18px", borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-subtle)", flexShrink: 0 }}>
            <input ref={selectAllRef} type="checkbox" checked={selectedIds.size === clips.length} onChange={toggleAll} style={{ cursor: "pointer", accentColor: "#14b8a6" }} />
            <span style={{ fontSize: 11, color: "var(--gray-400)" }}>{selectedCount} of {clips.length} selected · drag to reorder</span>
          </div>
        )}

        {/* ── Clips list ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: "center" }}><div className="vm-spinner" /></div>
          ) : clips.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--gray-500)", fontSize: 13 }}>
              No clips found for {srcLang.toUpperCase()} → {tgtLang.toUpperCase()}
            </div>
          ) : clips.map((clip, idx) => {
            const od        = clip.output_data as Record<string, string> | null;
            const audioUrl  = clip.audio_url || clip.input_url;
            const hasText   = !!(od?.transcript?.trim() || od?.translation?.trim());
            const isActive  = activeId === clip.id;
            const isChecked = selectedIds.has(clip.id);
            const dur       = durations[clip.id] ?? 0;
            const range     = ranges[clip.id] ?? { start: 0, end: dur || 1 };
            const isDragOver = dragOverId === clip.id;

            // Clip has neither audio nor text — render as a compact greyed-out row
            if (!audioUrl && !hasText) {
              return (
                <div key={clip.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 7, border: "1px solid var(--border-subtle)", opacity: 0.4 }}>
                  <span style={{ fontSize: 10, color: "var(--gray-500)" }}>#{idx + 1}</span>
                  <span style={{ fontSize: 10, color: "var(--gray-500)", flex: 1 }}>{formatTimestamp(clip.created_at)}</span>
                  <span style={{ fontSize: 10, color: "var(--gray-600)", fontStyle: "italic" }}>no data</span>
                </div>
              );
            }

            return (
              <div
                key={clip.id}
                draggable={!!audioUrl}
                onDragStart={audioUrl ? onDragStart(clip.id) : undefined}
                onDragOver={audioUrl ? onDragOver(clip.id) : undefined}
                onDrop={audioUrl ? onDrop(clip.id) : undefined}
                onDragEnd={audioUrl ? onDragEnd : undefined}
                style={{
                  background: isChecked ? "rgba(20,184,166,0.05)" : "var(--surface-subtle)",
                  border: `1px solid ${isDragOver ? "#14b8a6" : isChecked ? "rgba(20,184,166,0.3)" : "var(--border-subtle)"}`,
                  borderRadius: 9, padding: "10px 12px", cursor: audioUrl ? "grab" : "default",
                  opacity: dragSrcId === clip.id ? 0.45 : 1,
                  transition: "border-color 0.1s, background 0.1s",
                }}
              >
                {/* Row header: checkbox (only if has audio) + index + timestamp + play */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: hasText ? 6 : 0 }}>
                  {audioUrl
                    ? <input type="checkbox" checked={isChecked} onChange={() => toggleSelect(clip.id)} onClick={e => e.stopPropagation()} style={{ cursor: "pointer", accentColor: "#14b8a6", flexShrink: 0 }} />
                    : <span style={{ width: 14, flexShrink: 0 }} />
                  }
                  <span style={{ fontSize: 10, color: "var(--gray-600)", fontWeight: 600, minWidth: 16 }}>#{idx + 1}</span>
                  <span style={{ fontSize: 10, color: "var(--gray-500)", flex: 1 }}>{formatTimestamp(clip.created_at)}</span>
                  {audioUrl && (
                    <button
                      onClick={(e) => { e.stopPropagation(); playClip(clip); }}
                      style={{ background: isActive ? "rgba(20,184,166,0.15)" : "rgba(20,184,166,0.07)", border: `1px solid ${isActive ? "rgba(20,184,166,0.4)" : "rgba(20,184,166,0.2)"}`, borderRadius: 5, padding: "3px 8px", cursor: "pointer", color: "#14b8a6", display: "flex", alignItems: "center", gap: 4, fontSize: 10 }}
                    >
                      {isActive && isPlaying ? <Pause size={10} /> : <Play size={10} />}
                      {isActive && isPlaying ? "Pause" : "Play"}
                    </button>
                  )}
                  {audioUrl && (
                    <button
                      onClick={(e) => { e.stopPropagation(); const a = document.createElement("a"); a.href = fullUrl(audioUrl) ?? "#"; a.download = `lt_${srcLang}_${tgtLang}_${idx + 1}.wav`; a.click(); }}
                      style={{ background: "var(--surface-subtle)", border: "1px solid var(--border-subtle)", borderRadius: 5, padding: "3px 6px", cursor: "pointer", color: "var(--gray-400)", display: "flex", alignItems: "center", gap: 3, fontSize: 10 }}
                    >
                      <Download size={10} /> wav
                    </button>
                  )}
                  {(od?.transcript?.trim() || od?.translation?.trim()) && (
                    <button
                      onClick={(e) => { e.stopPropagation(); const lines: string[] = []; if (od?.transcript?.trim()) lines.push(`[${srcLang.toUpperCase()}] ${od.transcript}`); if (od?.translation?.trim()) lines.push(`[${tgtLang.toUpperCase()}] ${od.translation}`); lines.push(`[time] ${formatTimestamp(clip.created_at)}`); const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `lt_${srcLang}_${tgtLang}_${idx + 1}.txt`; a.click(); URL.revokeObjectURL(a.href); }}
                      style={{ background: "var(--surface-subtle)", border: "1px solid var(--border-subtle)", borderRadius: 5, padding: "3px 6px", cursor: "pointer", color: "var(--gray-400)", display: "flex", alignItems: "center", gap: 3, fontSize: 10 }}
                    >
                      <Download size={10} /> txt
                    </button>
                  )}
                </div>

                {/* Transcript + Translation */}
                {od?.transcript?.trim() && (
                  <div style={{ fontSize: 11, color: "var(--gray-400)", marginBottom: 3, lineHeight: 1.4 }}>
                    <span style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.4px", color: "var(--gray-600)", marginRight: 5 }}>{srcLang.toUpperCase()}</span>
                    {od.transcript}
                  </div>
                )}
                {od?.translation?.trim() && (
                  <div style={{ fontSize: 12, color: "var(--bamboo-300, #c5e08a)", fontWeight: 500, lineHeight: 1.4, marginBottom: 6 }}>
                    <span style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.4px", color: "var(--gray-600)", marginRight: 5 }}>{tgtLang.toUpperCase()}</span>
                    {od.translation}
                  </div>
                )}

                {/* Waveform range — only when selected + has audio */}
                {isChecked && audioUrl && (
                  <WaveformRange
                    wavUrl={fullUrl(audioUrl)!}
                    start={range.start}
                    end={dur > 0 ? range.end : 1}
                    duration={dur}
                    onChange={(s, e) => setRanges(prev => ({ ...prev, [clip.id]: { start: s, end: e } }))}
                    onDurationLoaded={(d) => {
                      setDurations(prev => ({ ...prev, [clip.id]: d }));
                      setRanges(prev => prev[clip.id] ? prev : { ...prev, [clip.id]: { start: 0, end: d } });
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* ── Merge bottom bar ── */}
        {!loading && clips.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderTop: "1px solid var(--border-subtle)", background: "var(--surface-subtle)", flexShrink: 0 }}>
            <input
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder="merged filename"
              style={{ flex: 1, padding: "5px 9px", fontSize: 12, borderRadius: 6, border: "1px solid var(--border-subtle)", background: "var(--card, #fff)", color: "var(--text-primary)", outline: "none" }}
            />
            <span style={{ fontSize: 11, color: "var(--gray-500)", flexShrink: 0 }}>.wav</span>
            <button
              onClick={mergeAndDownload}
              disabled={merging || selectedCount === 0}
              style={{ background: selectedCount === 0 ? "var(--surface-subtle)" : "rgba(20,184,166,0.12)", border: `1px solid ${selectedCount === 0 ? "var(--border-subtle)" : "rgba(20,184,166,0.35)"}`, borderRadius: 6, padding: "6px 14px", cursor: selectedCount === 0 ? "not-allowed" : "pointer", color: selectedCount === 0 ? "var(--gray-600)" : "#14b8a6", display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, flexShrink: 0, opacity: merging ? 0.6 : 1 }}
            >
              {merging ? <><div className="vm-spinner" style={{ width: 12, height: 12, borderWidth: 2 }} /> Merging…</> : <><Download size={13} /> Merge & Download ({selectedCount})</>}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// ─── View All Modal ──────────────────────────────────────────────────────────

function ViewAllModal({
  onClose,
  playingUrl,
  onPlay,
  onDownload,
  onSpeak,
  speakingId,
}: {
  onClose: () => void;
  playingUrl: string | null;
  onPlay: (url: string) => void;
  onDownload: (url: string, feature: string) => void;
  onSpeak: (text: string, itemId: string, lang?: string) => void;
  speakingId: string | null;
}) {
  const [items, setItems] = useState<ProcessedItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [featureFilter, setFeatureFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(0);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [clipsModal, setClipsModal] = useState<{ src: string; tgt: string } | null>(null);
  const PAGE_SIZE = 10;

  const handleDelete = async (item: ProcessedItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDeleteId !== item.id) {
      setConfirmDeleteId(item.id);
      return;
    }
    setConfirmDeleteId(null);
    setDeletingId(item.id);
    try {
      await deleteHistoryItem(item.id);
      await fetchItems();
    } catch {
      // silent
    } finally {
      setDeletingId(null);
    }
  };

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getHistory(page * PAGE_SIZE, PAGE_SIZE, featureFilter || undefined);
      setItems(res.items);
      setTotal(res.total);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [page, featureFilter]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  // Reset page when filter changes
  useEffect(() => { setPage(0); }, [featureFilter]);

  // Hide entries with no meaningful input
  const meaningful = items.filter((i) => i.input_summary?.trim() || i.output_summary?.trim());

  const filtered = searchQuery
    ? meaningful.filter(
        (i) =>
          i.input_summary.toLowerCase().includes(searchQuery.toLowerCase()) ||
          i.output_summary.toLowerCase().includes(searchQuery.toLowerCase()) ||
          i.feature_label.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : meaningful;

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const portal = createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(6px)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          width: "calc(100vw - 32px)",
          maxWidth: "100vw",
          maxHeight: "85vh",
          background: "var(--card, #ffffff)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "14px",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          animation: "proc-circle-in 0.2s ease",
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "16px 20px",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <BarChart3 size={18} style={{ color: "var(--bamboo-400)" }} />
          <span style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary)", flex: 1 }}>
            All Processed Items
          </span>
          <span style={{ fontSize: "12px", color: "var(--gray-500)" }}>{total} total</span>
          <button
            onClick={onClose}
            style={{
              background: "var(--surface-subtle)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "6px",
              padding: "4px",
              cursor: "pointer",
              color: "var(--gray-400)",
              display: "flex",
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Toolbar: Filter + Search */}
        <div
          style={{
            display: "flex",
            gap: "8px",
            padding: "12px 20px",
            borderBottom: "1px solid var(--border-subtle)",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px", position: "relative" }}>
            <Filter size={13} style={{ color: "var(--gray-500)", position: "absolute", left: 10, pointerEvents: "none" }} />
            <select
              value={featureFilter}
              onChange={(e) => setFeatureFilter(e.target.value)}
              style={{
                background: "var(--surface-subtle)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "6px",
                padding: "6px 10px 6px 28px",
                color: "var(--text-primary)",
                fontSize: "12px",
                outline: "none",
                cursor: "pointer",
                minWidth: 160,
              }}
            >
              {FEATURE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} style={{ background: "var(--card, #fff)" }}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "6px", flex: 1, position: "relative" }}>
            <Search size={13} style={{ color: "var(--gray-500)", position: "absolute", left: 10, pointerEvents: "none" }} />
            <input
              type="text"
              placeholder="Search items..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: "100%",
                background: "var(--surface-subtle)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "6px",
                padding: "6px 10px 6px 28px",
                color: "var(--text-primary)",
                fontSize: "12px",
                outline: "none",
              }}
            />
          </div>
        </div>

        {/* Table Header */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "140px 1fr 1fr 120px 110px",
            gap: "8px",
            padding: "8px 20px",
            fontSize: "10px",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            color: "var(--gray-500)",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <span>Feature</span>
          <span>Input</span>
          <span>Output</span>
          <span>Time</span>
          <span style={{ textAlign: "right" }}>Actions</span>
        </div>

        {/* Table Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 20px" }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: "center" }}>
              <div className="vm-spinner" />
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--gray-500)", fontSize: 13 }}>
              {searchQuery ? "No matches found" : "No processed items yet"}
            </div>
          ) : (
            filtered.map((item, idx) => {
              const Icon = FEATURE_ICONS[item.feature] || Activity;
              const color = FEATURE_COLORS[item.feature] || "#8cb856";
              const isExpanded = expandedIdx === idx;
              const audioUrl = item.audio_url || item.input_url;
              const isPlaying = playingUrl === audioUrl;
              const od = item.output_data as Record<string, string> | null;
              const translatedText =
                item.feature === "translate" ? od?.translated_text
                : item.feature === "live_translation" ? od?.translation
                : undefined;
              const tgtLang =
                item.feature === "translate" || item.feature === "live_translation"
                  ? od?.tgt_lang : undefined;
              // For live_translation: show "en → hi" style in input if no transcript
              const inputDisplay =
                item.feature === "live_translation" && od
                  ? (od.transcript || `${od.src_lang} → ${od.tgt_lang}`)
                  : (item.input_summary || (od?.text) || "—");
              // Output display — trim to avoid empty string being truthy-falsy mismatch
              const isMelSpec = item.output_summary?.startsWith("Mel spectrogram");
              const outputDisplay =
                (translatedText?.trim() || null)
                || (item.feature === "live_translation" && od
                    ? (od.translation?.trim() || od.transcript?.trim() || `Audio clip · ${od.src_lang} → ${od.tgt_lang}`)
                    : null)
                || (!isMelSpec ? (item.output_summary?.trim() || null) : null)
                || (isMelSpec ? item.input_summary : null)
                || "—";

              const isLiveTranslation = item.feature === "live_translation";
              return (
                <div key={idx}>
                  <div
                    onClick={() => {
                      if (isLiveTranslation && od) {
                        setClipsModal({ src: od.src_lang, tgt: od.tgt_lang });
                      } else {
                        setExpandedIdx(isExpanded ? null : idx);
                      }
                    }}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "140px 1fr 1fr 120px 110px",
                      gap: "8px",
                      padding: "10px 0",
                      borderBottom: "1px solid var(--border-subtle)",
                      cursor: "pointer",
                      alignItems: "center",
                      fontSize: "12px",
                      transition: "background 0.1s",
                    }}
                  >
                    {/* Feature */}
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <div
                        style={{
                          width: 24, height: 24, borderRadius: 5,
                          background: `${color}18`, display: "flex",
                          alignItems: "center", justifyContent: "center",
                        }}
                      >
                        <Icon size={12} color={color} />
                      </div>
                      <span style={{ color, fontWeight: 500, fontSize: 11 }}>{item.feature_label}</span>
                    </div>

                    {/* Input */}
                    <div style={{ color: "var(--gray-400)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {inputDisplay}
                    </div>

                    {/* Output */}
                    <div style={{
                      color: isLiveTranslation ? "#14b8a6" : "var(--bamboo-600, #537f28)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      display: "flex", alignItems: "center", gap: 4,
                      textDecoration: isLiveTranslation ? "underline" : "none",
                      textDecorationColor: isLiveTranslation ? "rgba(20,184,166,0.4)" : undefined,
                      textUnderlineOffset: 2,
                    }}>
                      {isLiveTranslation && <Radio size={10} color="#14b8a6" style={{ flexShrink: 0 }} />}
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {outputDisplay}
                      </span>
                    </div>

                    {/* Time */}
                    <div style={{ color: "var(--gray-500)", fontSize: 11 }}>
                      {formatTimestamp(item.created_at)}
                    </div>

                    {/* Actions */}
                    <div style={{ display: "flex", gap: "4px", justifyContent: "flex-end" }}>
                      {audioUrl && (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); onPlay(audioUrl); }}
                            style={{
                              background: "var(--surface-subtle)",
                              border: "1px solid var(--border-subtle)",
                              borderRadius: "5px", padding: "3px 5px", cursor: "pointer",
                              color: isPlaying ? "var(--bamboo-400)" : "var(--gray-400)",
                              display: "flex", alignItems: "center",
                            }}
                            title={isPlaying ? "Pause" : "Play"}
                          >
                            {isPlaying ? <Pause size={11} /> : <Play size={11} />}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); onDownload(audioUrl, item.feature); }}
                            style={{
                              background: "var(--surface-subtle)",
                              border: "1px solid var(--border-subtle)",
                              borderRadius: "5px", padding: "3px 5px", cursor: "pointer",
                              color: "var(--gray-400)", display: "flex", alignItems: "center",
                            }}
                            title="Download"
                          >
                            <Download size={11} />
                          </button>
                        </>
                      )}
                      {!audioUrl && translatedText && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onSpeak(translatedText, item.id, tgtLang); }}
                          style={{
                            background: speakingId === item.id ? "rgba(140,184,86,0.12)" : "var(--surface-subtle)",
                            border: `1px solid ${speakingId === item.id ? "rgba(140,184,86,0.3)" : "var(--border-subtle)"}`,
                            borderRadius: "5px", padding: "3px 5px", cursor: "pointer",
                            color: speakingId === item.id ? "var(--bamboo-400)" : "var(--gray-400)",
                            display: "flex", alignItems: "center",
                          }}
                          title={speakingId === item.id ? "Stop speaking" : "Listen to translation"}
                        >
                          <Volume2 size={11} />
                        </button>
                      )}
                      {confirmDeleteId === item.id ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }} onClick={(e) => e.stopPropagation()}>
                          <span style={{ fontSize: 11, color: "var(--gray-400)" }}>Delete?</span>
                          <button
                            onClick={(e) => handleDelete(item, e)}
                            style={{
                              background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.35)",
                              borderRadius: "5px", padding: "3px 7px", cursor: "pointer",
                              color: "#ef4444", fontSize: 11, fontWeight: 600,
                            }}
                          >Yes</button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                            style={{
                              background: "var(--surface-subtle)", border: "1px solid var(--border-subtle)",
                              borderRadius: "5px", padding: "3px 7px", cursor: "pointer",
                              color: "var(--gray-400)", fontSize: 11,
                            }}
                          >No</button>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => handleDelete(item, e)}
                          disabled={deletingId === item.id}
                          title="Delete"
                          style={{
                            background: "var(--surface-subtle)",
                            border: "1px solid var(--border-subtle)",
                            borderRadius: "5px", padding: "3px 5px", cursor: "pointer",
                            color: deletingId === item.id ? "var(--gray-600)" : "#ef4444",
                            display: "flex", alignItems: "center",
                            opacity: deletingId === item.id ? 0.5 : 1,
                          }}
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                      <div style={{ color: "var(--gray-600)" }}>
                        {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      </div>
                    </div>
                  </div>

                  {/* Expanded detail row */}
                  {isExpanded && (
                    <div
                      style={{
                        padding: "12px 0 12px 30px",
                        fontSize: 12,
                        color: "var(--gray-300)",
                        lineHeight: 1.6,
                        borderBottom: "1px solid var(--border-subtle)",
                        background: "var(--surface-subtle)",
                      }}
                    >
                      {item.input_summary && (
                        <div style={{ marginBottom: 8 }}>
                          <span style={{ color: "var(--gray-500)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 600 }}>Input</span>
                          <div style={{ marginTop: 2, wordBreak: "break-word" }}>{item.input_summary}</div>
                        </div>
                      )}
                      {/* ── Live Translation clip detail ── */}
                      {item.feature === "live_translation" && od ? (
                        <div>
                          {/* Lang pair badge */}
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                            <span style={{
                              fontSize: 10, fontWeight: 600, letterSpacing: "0.04em",
                              background: "rgba(20,184,166,0.12)", color: "#14b8a6",
                              border: "1px solid rgba(20,184,166,0.25)", borderRadius: 4,
                              padding: "2px 7px",
                            }}>
                              {od.src_lang?.toUpperCase()} → {od.tgt_lang?.toUpperCase()}
                            </span>
                            {audioUrl && (
                              <span style={{ fontSize: 10, color: "var(--gray-500)" }}>
                                {item.audio_size_bytes ? `${((item.audio_size_bytes) / 1024).toFixed(0)} KB` : "audio clip"}
                              </span>
                            )}
                          </div>

                          {/* Transcript */}
                          {od.transcript?.trim() && (
                            <div style={{ marginBottom: 8 }}>
                              <div style={{ fontSize: 10, color: "var(--gray-500)", textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 600, marginBottom: 3 }}>
                                Transcript ({od.src_lang})
                              </div>
                              <div style={{ color: "var(--gray-300)", wordBreak: "break-word", lineHeight: 1.5 }}>
                                {od.transcript}
                              </div>
                            </div>
                          )}

                          {/* Translation */}
                          {od.translation?.trim() && (
                            <div style={{ marginBottom: 10 }}>
                              <div style={{ fontSize: 10, color: "var(--gray-500)", textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 600, marginBottom: 3 }}>
                                Translation ({od.tgt_lang})
                              </div>
                              <div style={{ color: "var(--bamboo-300, #c5e08a)", fontWeight: 500, wordBreak: "break-word", lineHeight: 1.5 }}>
                                {od.translation}
                              </div>
                            </div>
                          )}

                          {/* Audio controls */}
                          {audioUrl && (
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                              <button
                                onClick={(e) => { e.stopPropagation(); onPlay(audioUrl); }}
                                style={{
                                  background: isPlaying ? "rgba(20,184,166,0.15)" : "rgba(20,184,166,0.08)",
                                  border: `1px solid ${isPlaying ? "rgba(20,184,166,0.4)" : "rgba(20,184,166,0.2)"}`,
                                  borderRadius: 5, padding: "4px 10px", cursor: "pointer",
                                  color: "#14b8a6", display: "flex", alignItems: "center", gap: 5, fontSize: 11,
                                }}
                              >
                                {isPlaying ? <Pause size={11} /> : <Play size={11} />}
                                {isPlaying ? "Pause" : "Play Clip"}
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); onDownload(audioUrl, item.feature); }}
                                style={{
                                  background: "var(--surface-subtle)", border: "1px solid var(--border-subtle)",
                                  borderRadius: 5, padding: "4px 10px", cursor: "pointer",
                                  color: "var(--gray-400)", display: "flex", alignItems: "center", gap: 5, fontSize: 11,
                                }}
                              >
                                <Download size={11} /> Download
                              </button>
                              {od.translation?.trim() && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); onSpeak(od.translation, item.id, od.tgt_lang); }}
                                  style={{
                                    background: speakingId === item.id ? "rgba(140,184,86,0.15)" : "rgba(140,184,86,0.08)",
                                    border: `1px solid ${speakingId === item.id ? "rgba(140,184,86,0.35)" : "rgba(140,184,86,0.2)"}`,
                                    borderRadius: 5, padding: "4px 10px", cursor: "pointer",
                                    color: speakingId === item.id ? "var(--bamboo-400)" : "var(--bamboo-500)",
                                    display: "flex", alignItems: "center", gap: 5, fontSize: 11,
                                  }}
                                >
                                  <Volume2 size={11} /> {speakingId === item.id ? "Stop" : "Listen"}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        /* ── All other features ── */
                        <div>
                          <span style={{ color: "var(--gray-500)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 600 }}>Output</span>
                          <div style={{ marginTop: 2, wordBreak: "break-word", whiteSpace: "pre-wrap" }}>
                            {item.output_data ? (
                              item.feature === "translate" ? (
                                <div>
                                  <div style={{ color: "var(--bamboo-300, #c5e08a)", fontWeight: 500 }}>
                                    {(item.output_data as Record<string, string>).translated_text}
                                  </div>
                                  <div style={{ fontSize: 10, color: "var(--gray-500)", marginTop: 4 }}>
                                    {(item.output_data as Record<string, string>).src_lang} → {(item.output_data as Record<string, string>).tgt_lang}
                                  </div>
                                </div>
                              ) : item.feature === "transcribe" ? (
                                <div style={{ color: "var(--bamboo-300, #c5e08a)" }}>
                                  {(item.output_data as Record<string, string>).text}
                                </div>
                              ) : item.feature === "classify" ? (
                                <div>
                                  <span style={{ color: "var(--bamboo-300)", fontWeight: 600 }}>
                                    {(item.output_data as Record<string, unknown>).intent as string}
                                  </span>
                                  <span style={{ color: "var(--gray-500)", marginLeft: 8 }}>
                                    {(((item.output_data as Record<string, unknown>).confidence as number) * 100).toFixed(1)}%
                                  </span>
                                </div>
                              ) : (
                                item.output_summary
                              )
                            ) : (
                              item.output_summary || "No output data"
                            )}
                          </div>
                        </div>
                      )}
                      {item.feature !== "live_translation" && (item.audio_url || item.input_url) && (
                        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                          {(item.audio_size_bytes || item.input_size_bytes) && (
                            <span style={{ fontSize: 10, color: "var(--gray-500)" }}>
                              {item.audio_url ? "Output" : "Input"} audio: {((item.audio_size_bytes || item.input_size_bytes || 0) / 1024).toFixed(1)} KB
                            </span>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); onPlay(audioUrl!); }}
                            style={{
                              background: "rgba(140,184,86,0.1)", border: "1px solid rgba(140,184,86,0.25)",
                              borderRadius: "5px", padding: "3px 8px", cursor: "pointer",
                              color: isPlaying ? "var(--bamboo-400)" : "var(--bamboo-500)",
                              display: "flex", alignItems: "center", gap: 4, fontSize: 10,
                            }}
                          >
                            {isPlaying ? <Pause size={10} /> : <Play size={10} />}
                            {isPlaying ? "Pause" : "Play"}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); onDownload(audioUrl!, item.feature); }}
                            style={{
                              background: "var(--surface-subtle)", border: "1px solid var(--border-subtle)",
                              borderRadius: "5px", padding: "3px 8px", cursor: "pointer",
                              color: "var(--gray-400)", display: "flex", alignItems: "center", gap: 4, fontSize: 10,
                            }}
                          >
                            <Download size={10} /> Download
                          </button>
                        </div>
                      )}
                      {item.feature !== "live_translation" && !audioUrl && translatedText && (
                        <div style={{ marginTop: 8 }}>
                          <button
                            onClick={(e) => { e.stopPropagation(); onSpeak(translatedText, item.id, tgtLang); }}
                            style={{
                              background: speakingId === item.id ? "rgba(140,184,86,0.15)" : "rgba(140,184,86,0.08)",
                              border: `1px solid ${speakingId === item.id ? "rgba(140,184,86,0.35)" : "rgba(140,184,86,0.2)"}`,
                              borderRadius: "5px", padding: "3px 8px", cursor: "pointer",
                              color: speakingId === item.id ? "var(--bamboo-400)" : "var(--bamboo-500)",
                              display: "flex", alignItems: "center", gap: 4, fontSize: 10,
                            }}
                          >
                            <Volume2 size={10} /> {speakingId === item.id ? "Stop" : "Listen"}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              padding: "12px 20px",
              borderTop: "1px solid var(--border-subtle)",
              fontSize: "12px",
              color: "var(--gray-400)",
            }}
          >
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              style={{
                background: "var(--surface-subtle)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "6px",
                padding: "4px 12px",
                cursor: page === 0 ? "not-allowed" : "pointer",
                color: page === 0 ? "var(--gray-600)" : "var(--gray-300)",
                fontSize: 12,
              }}
            >
              Prev
            </button>
            <span>
              Page {page + 1} of {totalPages}
            </span>
            <button
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              style={{
                background: "var(--surface-subtle)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "6px",
                padding: "4px 12px",
                cursor: page >= totalPages - 1 ? "not-allowed" : "pointer",
                color: page >= totalPages - 1 ? "var(--gray-600)" : "var(--gray-300)",
                fontSize: 12,
              }}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );

  // Render the LiveClipsModal on top when a live_translation row was clicked
  return (
    <>
      {portal}
      {clipsModal && (
        <LiveClipsModal
          srcLang={clipsModal.src}
          tgtLang={clipsModal.tgt}
          onClose={() => setClipsModal(null)}
        />
      )}
    </>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function AnalyticsWidget() {
  const { usageInfo } = useAuth();
  const [stats, setStats] = useState<HistoryStats | null>(null);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([getHistoryStats(), getHistory(0, 10)]);
      setStats(s);
      setHistory(h);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handlePlay = useCallback((url: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (playingUrl === url) {
      setPlayingUrl(null);
      return;
    }
    const audio = new Audio(AMT_BASE + url);
    audio.onended = () => setPlayingUrl(null);
    audio.play();
    audioRef.current = audio;
    setPlayingUrl(url);
  }, [playingUrl]);

  const handleDownload = useCallback((url: string, feature: string) => {
    const a = document.createElement("a");
    a.href = AMT_BASE + url;
    a.download = `${feature}-output.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  const handleSpeak = useCallback((text: string, itemId: string, lang?: string) => {
    if (speakingId === itemId) {
      window.speechSynthesis.cancel();
      setSpeakingId(null);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    if (lang) utterance.lang = lang;
    utterance.onend = () => setSpeakingId(null);
    utterance.onerror = () => setSpeakingId(null);
    window.speechSynthesis.speak(utterance);
    setSpeakingId(itemId);
  }, [speakingId]);

  const textQuota = usageInfo?.quotas?.text_chars ?? 500_000;
  const voiceQuota = usageInfo?.quotas?.voice_minutes ?? 60;

  const maxFeatureCount = stats
    ? Math.max(...Object.values(stats.feature_counts), 1)
    : 1;

  // ─── Loading ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="vm-card vm-card-full">
        <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "20px" }}>
          <div style={{ ...skeletonPulse, width: "24px", height: "24px", borderRadius: "6px" }} />
          <div style={{ ...skeletonPulse, width: "140px", height: "18px" }} />
        </div>
        <div style={{ display: "flex", gap: "12px", marginBottom: "20px" }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} style={{ ...skeletonPulse, ...glassCard, height: "80px" }} />
          ))}
        </div>
        <div style={{ display: "flex", gap: "16px" }}>
          <div style={{ ...skeletonPulse, flex: "1", height: "120px", borderRadius: "8px" }} />
          <div style={{ ...skeletonPulse, flex: "2", height: "120px", borderRadius: "8px" }} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="vm-card vm-card-full">
        <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--gray-400)" }}>
          <BarChart3 size={18} />
          <span style={{ fontSize: "14px", fontWeight: 600 }}>Voice Analytics</span>
        </div>
        <p style={{ color: "var(--gray-500)", fontSize: "13px", marginTop: "12px" }}>{error}</p>
      </div>
    );
  }

  if (!stats || !history) return null;

  return (
    <div className="vm-card vm-card-full">
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "20px" }}>
        <BarChart3 size={18} style={{ color: "var(--bamboo-400, #8cb856)" }} />
        <span style={{ fontSize: "15px", fontWeight: 600, color: "var(--white, #fff)" }}>
          Voice Analytics
        </span>
        <span style={{ fontSize: "11px", color: "var(--gray-500, #666)", marginLeft: "auto" }}>
          {stats.period}
        </span>
      </div>

      {/* Stats Row */}
      <div style={{ display: "flex", gap: "12px", marginBottom: "24px", flexWrap: "wrap" }}>
        <div style={glassCard}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
            <Activity size={13} style={{ color: "var(--bamboo-400)" }} />
            <span style={{ fontSize: "11px", color: "var(--gray-400)", fontWeight: 500 }}>Total Processed</span>
          </div>
          <div style={{ fontSize: "24px", fontWeight: 700, color: "var(--text-primary)" }}>
            {formatNumber(stats.total_processed)}
          </div>
        </div>

        <div style={glassCard}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
            <Hash size={13} style={{ color: "var(--bamboo-400)" }} />
            <span style={{ fontSize: "11px", color: "var(--gray-400)", fontWeight: 500 }}>Features Used</span>
          </div>
          <div style={{ fontSize: "24px", fontWeight: 700, color: "var(--text-primary)" }}>
            {stats.features_used}<span style={{ fontSize: "13px", fontWeight: 400, color: "var(--gray-500)" }}> / 6</span>
          </div>
        </div>

        <div style={glassCard}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
            <FileText size={13} style={{ color: "var(--bamboo-400)" }} />
            <span style={{ fontSize: "11px", color: "var(--gray-400)", fontWeight: 500 }}>Text Usage</span>
          </div>
          <div style={{ fontSize: "24px", fontWeight: 700, color: "var(--text-primary)" }}>{formatNumber(stats.text_chars_used)}</div>
          <div style={{ marginTop: "8px" }}>
            <div style={{ width: "100%", height: "4px", background: "var(--surface-hover)", borderRadius: "2px", overflow: "hidden" }}>
              <div style={{ width: `${Math.min((stats.text_chars_used / textQuota) * 100, 100)}%`, height: "100%", background: "var(--bamboo-400)", borderRadius: "2px", transition: "width 0.3s" }} />
            </div>
            <div style={{ fontSize: "10px", color: "var(--gray-500)", marginTop: "4px" }}>
              {formatNumber(stats.text_chars_used)} / {formatNumber(textQuota)} chars
            </div>
          </div>
        </div>

        <div style={glassCard}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
            <Clock size={13} style={{ color: "var(--bamboo-400)" }} />
            <span style={{ fontSize: "11px", color: "var(--gray-400)", fontWeight: 500 }}>Voice Usage</span>
          </div>
          <div style={{ fontSize: "24px", fontWeight: 700, color: "var(--text-primary)" }}>
            {stats.voice_minutes_used.toFixed(1)}<span style={{ fontSize: "12px", fontWeight: 400, color: "var(--gray-500)" }}> min</span>
          </div>
          <div style={{ marginTop: "8px" }}>
            <div style={{ width: "100%", height: "4px", background: "var(--surface-hover)", borderRadius: "2px", overflow: "hidden" }}>
              <div style={{ width: `${Math.min((stats.voice_minutes_used / voiceQuota) * 100, 100)}%`, height: "100%", background: "var(--bamboo-400)", borderRadius: "2px", transition: "width 0.3s" }} />
            </div>
            <div style={{ fontSize: "10px", color: "var(--gray-500)", marginTop: "4px" }}>
              {stats.voice_minutes_used.toFixed(1)} / {voiceQuota} min
            </div>
          </div>
        </div>
      </div>

      {/* Bottom: Feature Breakdown + Recent Items */}
      <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
        {/* Feature Breakdown */}
        <div style={{ flex: "1 1 240px", minWidth: "240px" }}>
          <div style={sectionTitle}>Feature Breakdown</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {Object.entries(stats.feature_counts)
              .sort(([, a], [, b]) => b - a)
              .map(([feature, count]) => (
                <div key={feature} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "12px", color: "var(--gray-300)", width: "72px", textTransform: "capitalize" }}>{feature}</span>
                  <div style={{ flex: 1, height: "6px", background: "var(--surface-subtle)", borderRadius: "3px", overflow: "hidden" }}>
                    <div style={{ width: `${(count / maxFeatureCount) * 100}%`, height: "100%", background: FEATURE_COLORS[feature] || "var(--bamboo-400)", borderRadius: "3px", transition: "width 0.3s" }} />
                  </div>
                  <span style={{ fontSize: "11px", color: "var(--gray-500)", width: "32px", textAlign: "right" }}>{count}</span>
                </div>
              ))}
          </div>
        </div>

        {/* Recent Items */}
        <div style={{ flex: "2 1 400px", minWidth: "300px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={sectionTitle}>Recent Items</div>
            <button
              onClick={() => setShowModal(true)}
              style={{
                background: "rgba(109,159,55,0.08)",
                border: "1px solid rgba(109,159,55,0.25)",
                borderRadius: "6px",
                padding: "4px 10px",
                cursor: "pointer",
                color: "var(--bamboo-400)",
                fontSize: "11px",
                fontWeight: 500,
                display: "flex",
                alignItems: "center",
                gap: "4px",
                transition: "background 0.15s",
              }}
            >
              View All <ExternalLink size={10} />
            </button>
          </div>
          {(() => {
            const meaningful = history.items.filter((i) => i.input_summary?.trim() || i.output_summary?.trim()).slice(0, 10);
            return meaningful.length === 0 ? (
              <p style={{ fontSize: "13px", color: "var(--gray-500)" }}>
                No processed items yet. Start using voice features to see activity here.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                {meaningful.map((item, idx) => {
                  const audioUrl = item.audio_url || item.input_url;
                  const od = item.output_data as Record<string, string> | null;
                  const translatedText =
                    item.feature === "translate" ? od?.translated_text
                    : item.feature === "live_translation" ? od?.translation
                    : undefined;
                  const tgtLang =
                    (item.feature === "translate" || item.feature === "live_translation") && od
                      ? od.tgt_lang : undefined;
                  return (
                    <ItemRow
                      key={idx}
                      item={item}
                      isExpanded={expandedIdx === idx}
                      isPlaying={playingUrl === audioUrl}
                      onToggle={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
                      onPlay={() => audioUrl && handlePlay(audioUrl)}
                      onDownload={() => audioUrl && handleDownload(audioUrl, item.feature)}
                      onSpeak={translatedText ? () => handleSpeak(translatedText, item.id, tgtLang) : undefined}
                      isSpeaking={speakingId === item.id}
                    />
                  );
                })}
              </div>
            );
          })()}
        </div>
      </div>

      {/* View All Modal */}
      {showModal && (
        <ViewAllModal
          onClose={() => setShowModal(false)}
          playingUrl={playingUrl}
          onPlay={handlePlay}
          onDownload={handleDownload}
          onSpeak={handleSpeak}
          speakingId={speakingId}
        />
      )}
    </div>
  );
}
