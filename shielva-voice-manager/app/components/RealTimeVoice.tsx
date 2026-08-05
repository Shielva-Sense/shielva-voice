"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Radio, Mic, Square, Play, Pause, Download, FolderOpen, X, ChevronRight, RefreshCw, Merge, Trash2 } from "lucide-react";
import { openRealtimeSession, saveLiveTranslationClip, getLiveTranslationClips, deleteHistoryItem, CHATTERBOX_TTS_LANGS, ORPHEUS_TTS_LANGS, type RealtimeEvent, type TranslateEngine, type TtsEngine } from "../lib/amt-api";
import { saveClipIDB, loadAllClipsIDB, updateClipCloud, deleteClipIDB, bufferToUrl, type StoredClip } from "../lib/live-translation-store";
import { useAuth } from "../context/AuthContext";
import { useVoice } from "../context/VoiceContext";
import { useVoices } from "../hooks/useVoices";
import { useStorage } from "../context/StorageContext";
import LanguageSelect, { type LangOption } from "./LanguageSelect";
import EngineToggle from "./EngineToggle";

// ─── Language map ─────────────────────────────────────────────────────────────
// Chatterbox renders both Indian and international scripts zero-shot; the grouping
// below is purely for the language picker's ordering.
const LANGUAGES: Record<string, { name: string; flag: string; group: "indian" | "international" }> = {
  // Indian
  hi: { name: "Hindi",      flag: "🇮🇳", group: "indian" },
  ta: { name: "Tamil",      flag: "🇮🇳", group: "indian" },
  te: { name: "Telugu",     flag: "🇮🇳", group: "indian" },
  kn: { name: "Kannada",    flag: "🇮🇳", group: "indian" },
  ml: { name: "Malayalam",  flag: "🇮🇳", group: "indian" },
  mr: { name: "Marathi",    flag: "🇮🇳", group: "indian" },
  bn: { name: "Bengali",    flag: "🇮🇳", group: "indian" },
  gu: { name: "Gujarati",   flag: "🇮🇳", group: "indian" },
  pa: { name: "Punjabi",    flag: "🇮🇳", group: "indian" },
  or: { name: "Odia",       flag: "🇮🇳", group: "indian" },
  as: { name: "Assamese",   flag: "🇮🇳", group: "indian" },
  ur: { name: "Urdu",       flag: "🇵🇰", group: "indian" },
  // International
  en: { name: "English",    flag: "🇺🇸", group: "international" },
  es: { name: "Spanish",    flag: "🇪🇸", group: "international" },
  fr: { name: "French",     flag: "🇫🇷", group: "international" },
  de: { name: "German",     flag: "🇩🇪", group: "international" },
  ja: { name: "Japanese",   flag: "🇯🇵", group: "international" },
  zh: { name: "Chinese",    flag: "🇨🇳", group: "international" },
  ar: { name: "Arabic",     flag: "🇸🇦", group: "international" },
  pt: { name: "Portuguese", flag: "🇧🇷", group: "international" },
  ru: { name: "Russian",    flag: "🇷🇺", group: "international" },
  ko: { name: "Korean",     flag: "🇰🇷", group: "international" },
  it: { name: "Italian",    flag: "🇮🇹", group: "international" },
  nl: { name: "Dutch",      flag: "🇳🇱", group: "international" },
  tr: { name: "Turkish",    flag: "🇹🇷", group: "international" },
  pl: { name: "Polish",     flag: "🇵🇱", group: "international" },
};

const SAMPLE_RATE    = 16000;   // 16 kHz mono — Silero VAD requirement
const CHUNK_SAMPLES  = 1024;    // 64 ms @ 16 kHz — good balance of latency vs network overhead
const WORKLET_PATH   = "/worklets/audio-capture-processor.js";

// Selectable TTS (voice) engines — mirrors the Text-to-Speech card. Orpheus is English-only
// and cannot clone; Chatterbox clones a chosen voice and speaks all 30 languages.
const TTS_ENGINE_OPTIONS: { id: TtsEngine; name: string; hint: string }[] = [
  { id: "chatterbox", name: "Chatterbox", hint: "Voice cloning · 30 languages" },
  { id: "orpheus", name: "Orpheus", hint: "Fast English streaming" },
];

// The realtime pipeline transcribes in-process with a fixed faster-whisper model
// (ASR_WHISPER_MODEL_SIZE on the TTS router, default large-v3-turbo). It is not
// switchable per session, so the card shows it read-only instead of a picker.
const REALTIME_STT_MODEL = "Whisper Large-v3-turbo · CUDA";

interface AudioMessage {
  id: string;
  wavUrl: string;
  transcript?: string;
  translation?: string;
  timestamp: number;
  langPair?: string;
  srcLang?: string;
  tgtLang?: string;
  cloudId?: string;   // MongoDB _id — needed to delete the cloud copy
}

function langLabel(pair: string, langs: typeof LANGUAGES): string {
  const [src, tgt] = pair.split("_");
  const srcName = langs[src]?.name ?? src;
  const tgtName = langs[tgt]?.name ?? tgt;
  const srcFlag = langs[src]?.flag ?? "";
  const tgtFlag = langs[tgt]?.flag ?? "";
  return `${srcFlag} ${srcName} → ${tgtFlag} ${tgtName}`;
}

// ── WAV encoder helper ────────────────────────────────────────────────────────
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

// ── Waveform range selector ───────────────────────────────────────────────────
function WaveformRange({
  wavUrl, start, end, duration, onChange, onDurationLoaded,
}: {
  wavUrl: string; start: number; end: number; duration: number;
  onChange: (s: number, e: number) => void;
  onDurationLoaded: (d: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [peaks, setPeaks] = useState<number[]>([]);
  const dragging = useRef<"start" | "end" | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(wavUrl);
        const ab = await resp.arrayBuffer();
        const ctx = new AudioContext();
        const buf = await ctx.decodeAudioData(ab);
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
  }, [wavUrl]);

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
      ctx.fillStyle = x >= sx && x + barW <= ex ? "#6d9f37" : "rgba(109,159,55,0.2)";
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

  // Shared pointer handlers — attached to each handle so pointer capture works correctly
  const makeHandleProps = (which: "start" | "end") => ({
    onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
      e.stopPropagation();            // prevent row drag-and-drop from firing
      e.preventDefault();             // prevent browser native drag
      e.currentTarget.setPointerCapture(e.pointerId);
      dragging.current = which;
    },
    onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
      if (dragging.current !== which) return;
      const t = getTime(e.clientX);
      if (which === "start") onChange(Math.min(t, end - 0.05), end);
      else onChange(start, Math.max(t, start + 0.05));
    },
    onPointerUp() { dragging.current = null; },
    onPointerCancel() { dragging.current = null; },
  });

  return (
    // onMouseDown stop-propagation so the outer draggable row never starts a drag
    // when the user interacts with the waveform area
    <div onMouseDown={(e) => e.stopPropagation()} onDragStart={(e) => e.preventDefault()}>
      <div
        ref={containerRef}
        style={{ position: "relative", height: 44, userSelect: "none", borderRadius: 6, background: "rgba(109,159,55,0.05)", border: "1px solid rgba(109,159,55,0.12)", marginBottom: 16 }}
      >
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block", borderRadius: 6 }} />
        {/* Selected-range overlay */}
        <div style={{ position: "absolute", top: 0, bottom: 0, left: `${startPct}%`, right: `${100 - endPct}%`, background: "rgba(109,159,55,0.13)", pointerEvents: "none" }} />
        {/* Start handle — captures all pointer events itself */}
        <div
          {...makeHandleProps("start")}
          style={{ position: "absolute", top: 0, bottom: 0, left: `${startPct}%`, width: 12, cursor: "ew-resize", transform: "translateX(-6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2 }}
        >
          <div style={{ width: 4, height: "100%", background: "#6d9f37", borderRadius: 2, position: "relative" }}>
            <div style={{ position: "absolute", bottom: -7, left: "50%", transform: "translateX(-50%)", width: 11, height: 11, background: "#6d9f37", borderRadius: "50%", border: "2px solid var(--card, #fff)" }} />
          </div>
        </div>
        {/* End handle */}
        <div
          {...makeHandleProps("end")}
          style={{ position: "absolute", top: 0, bottom: 0, left: `${endPct}%`, width: 12, cursor: "ew-resize", transform: "translateX(-6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2 }}
        >
          <div style={{ width: 4, height: "100%", background: "#6d9f37", borderRadius: 2, position: "relative" }}>
            <div style={{ position: "absolute", bottom: -7, left: "50%", transform: "translateX(-50%)", width: 11, height: 11, background: "#6d9f37", borderRadius: "50%", border: "2px solid var(--card, #fff)" }} />
          </div>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--bamboo-500)", marginTop: -10 }}>
        <span>{start.toFixed(2)}s</span>
        <span style={{ color: "var(--gray-500)" }}>{(end - start).toFixed(2)}s selected</span>
        <span>{end.toFixed(2)}s</span>
      </div>
    </div>
  );
}

// ── Collection folder modal ────────────────────────────────────────────────────
function CollectionModal({
  langPair, clips, onClose, onDeleteClip, onDeleteCollection,
}: {
  langPair: string;
  clips: AudioMessage[];
  onClose: () => void;
  onDeleteClip: (id: string) => void;
  onDeleteCollection: () => void;
}) {
  const audioRef  = useRef<HTMLAudioElement | null>(null);
  const [activeId, setActiveId]     = useState<string | null>(null);
  const [isPlaying, setIsPlaying]   = useState(false);
  const [merging, setMerging]       = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);   // two-step confirm for delete-all
  const [order, setOrder]           = useState<string[]>(() => clips.map(c => c.id));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(clips.map(c => c.id)));
  const [ranges, setRanges]         = useState<Record<string, { start: number; end: number }>>({});
  const [durations, setDurations]   = useState<Record<string, number>>({});
  const [filename, setFilename]     = useState(`${langPair}_merged`);
  const [dragSrcId, setDragSrcId]   = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const orderedClips = order.map(id => clips.find(c => c.id === id)).filter(Boolean) as AudioMessage[];
  const selectedCount = orderedClips.filter(c => selectedIds.has(c.id)).length;

  const toggleSelect = (id: string) => setSelectedIds(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const toggleAll = () => setSelectedIds(
    selectedIds.size === clips.length ? new Set() : new Set(clips.map(c => c.id))
  );

  const playClip = (msg: AudioMessage) => {
    if (activeId === msg.id) {
      if (audioRef.current?.paused) { audioRef.current.play(); setIsPlaying(true); }
      else { audioRef.current?.pause(); setIsPlaying(false); }
      return;
    }
    audioRef.current?.pause();
    setActiveId(msg.id);
    const audio = new Audio(msg.wavUrl);
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
        const resp = await fetch(clip.wavUrl);
        const ab = await resp.arrayBuffer();
        const buf = await ctx.decodeAudioData(ab);
        const dur = durations[clip.id] || buf.duration;
        const range = ranges[clip.id] ?? { start: 0, end: dur };
        const s = Math.round((range.start / dur) * buf.length);
        const e = Math.round((range.end   / dur) * buf.length);
        const trimmed = ctx.createBuffer(1, Math.max(1, e - s), buf.sampleRate);
        trimmed.getChannelData(0).set(buf.getChannelData(0).subarray(s, e));
        buffers.push(trimmed);
      }
      if (!buffers.length) return;
      const totalLen = buffers.reduce((a, b) => a + b.length, 0);
      const merged = ctx.createBuffer(1, totalLen, buffers[0].sampleRate);
      const out = merged.getChannelData(0);
      let off = 0;
      for (const buf of buffers) { out.set(buf.getChannelData(0), off); off += buf.length; }
      const blob = audioBufferToWav(merged);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${filename || "merged"}.wav`; a.click();
      URL.revokeObjectURL(url);
    } catch { /* silent */ } finally { setMerging(false); }
  };

  // Drag-to-reorder handlers
  const onDragStart = (id: string) => (e: React.DragEvent) => { setDragSrcId(id); e.dataTransfer.effectAllowed = "move"; };
  const onDragOver  = (id: string) => (e: React.DragEvent) => { e.preventDefault(); setDragOverId(id); };
  const onDrop      = (id: string) => (e: React.DragEvent) => {
    e.preventDefault();
    if (dragSrcId && dragSrcId !== id) {
      setOrder(prev => {
        const n = [...prev];
        const fi = n.indexOf(dragSrcId), ti = n.indexOf(id);
        n.splice(fi, 1); n.splice(ti, 0, dragSrcId);
        return n;
      });
    }
    setDragSrcId(null); setDragOverId(null);
  };
  const onDragEnd = () => { setDragSrcId(null); setDragOverId(null); };

  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={onClose}
    >
      <div
        style={{ background: "var(--card, #ffffff)", border: "1px solid var(--border-subtle)", borderRadius: 12, width: "calc(100vw - 32px)", maxWidth: "100vw", maxHeight: "88vh", display: "flex", flexDirection: "column", overflow: "hidden" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", padding: "14px 20px", borderBottom: "1px solid var(--border-subtle)", gap: 10 }}>
          <FolderOpen size={15} style={{ color: "var(--bamboo-400)", flexShrink: 0 }} />
          <span style={{ fontWeight: 600, fontSize: 14, flex: 1, color: "var(--text-primary)" }}>
            {langLabel(langPair, LANGUAGES)}
          </span>
          <span style={{ fontSize: 11, color: "var(--gray-500)" }}>{clips.length} clip{clips.length !== 1 ? "s" : ""}</span>
          {/* Delete whole collection — two-step confirm (destructive: removes all clips + cloud copies). */}
          {confirmDeleteAll ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 11, color: "#f87171" }}>Delete all {clips.length}?</span>
              <button onClick={() => setConfirmDeleteAll(false)} style={{ background: "var(--surface-subtle)", border: "1px solid var(--border-subtle)", borderRadius: 5, color: "var(--text-muted)", padding: "3px 9px", cursor: "pointer", fontSize: 11 }}>Cancel</button>
              <button onClick={() => { onDeleteCollection(); onClose(); }} style={{ background: "rgba(239,68,68,0.14)", border: "1px solid rgba(239,68,68,0.5)", borderRadius: 5, color: "#f87171", padding: "3px 9px", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>Delete</button>
            </div>
          ) : (
            <button onClick={() => setConfirmDeleteAll(true)} title="Delete this collection" style={{ background: "transparent", border: "1px solid var(--border-subtle)", borderRadius: 5, color: "#f87171", padding: "3px 8px", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
              <Trash2 size={12} /> Delete all
            </button>
          )}
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "var(--gray-400)", cursor: "pointer", padding: 4, marginLeft: 8, display: "flex" }}>
            <X size={16} />
          </button>
        </div>

        {/* Clip list */}
        <div style={{ overflowY: "auto", flex: 1, padding: "12px 20px" }}>
          {/* Select-all row */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, paddingBottom: 8, borderBottom: "1px solid var(--border-subtle)" }}>
            <input
              type="checkbox"
              checked={selectedIds.size === clips.length}
              ref={(el) => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < clips.length; }}
              onChange={toggleAll}
              style={{ accentColor: "#6d9f37", cursor: "pointer" }}
            />
            <span style={{ fontSize: 11, color: "var(--gray-400)" }}>
              {selectedCount} of {clips.length} selected
            </span>
            <span style={{ fontSize: 10, color: "var(--gray-600)", marginLeft: 4 }}>· drag rows to reorder</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {orderedClips.map((msg) => {
              const selected  = selectedIds.has(msg.id);
              const active    = activeId === msg.id;
              const playing   = active && isPlaying;
              const isDragOver = dragOverId === msg.id && dragSrcId !== msg.id;
              const flag = LANGUAGES[msg.tgtLang ?? langPair.split("_")[1] ?? ""]?.flag ?? "";
              const dur  = durations[msg.id] || 0;
              const range = ranges[msg.id] ?? { start: 0, end: dur };

              return (
                <div
                  key={msg.id}
                  draggable
                  onDragStart={onDragStart(msg.id)}
                  onDragOver={onDragOver(msg.id)}
                  onDrop={onDrop(msg.id)}
                  onDragEnd={onDragEnd}
                  style={{
                    background: selected ? "rgba(109,159,55,0.05)" : "var(--surface-subtle)",
                    border: `2px solid ${isDragOver ? "var(--bamboo-400)" : selected ? "rgba(109,159,55,0.28)" : "var(--border-subtle)"}`,
                    borderRadius: 8, overflow: "hidden",
                    opacity: dragSrcId === msg.id ? 0.35 : 1,
                    transition: "border-color 0.1s, opacity 0.1s",
                  }}
                >
                  {/* Row */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px" }}>
                    {/* Drag handle */}
                    <div style={{ cursor: "grab", color: "var(--gray-600)", flexShrink: 0, display: "flex", flexDirection: "column", gap: 2.5, padding: "0 2px" }}>
                      {[0,1,2].map(i => <div key={i} style={{ width: 13, height: 1.5, background: "currentColor", borderRadius: 1 }} />)}
                    </div>
                    {/* Checkbox */}
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleSelect(msg.id)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ accentColor: "#6d9f37", cursor: "pointer", flexShrink: 0 }}
                    />
                    {/* Clip info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: "var(--gray-400)" }}>
                        {flag} {new Date(msg.timestamp).toLocaleTimeString()}
                        {dur > 0 && <span style={{ marginLeft: 6, color: "var(--gray-600)", fontSize: 10 }}>{dur.toFixed(1)}s</span>}
                      </div>
                      {msg.translation && (
                        <div style={{ fontSize: 12, color: "var(--bamboo-400)", fontWeight: 500, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {msg.translation}
                        </div>
                      )}
                    </div>
                    {/* Play */}
                    <button
                      onClick={() => playClip(msg)}
                      style={{ background: active ? "rgba(109,159,55,0.15)" : "var(--surface-hover, rgba(0,0,0,0.04))", border: `1px solid ${active ? "rgba(109,159,55,0.4)" : "var(--border-subtle)"}`, borderRadius: 5, color: active ? "var(--bamboo-400)" : "var(--gray-400)", padding: "4px 9px", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 11, flexShrink: 0 }}
                    >
                      {playing ? <Pause size={11} /> : <Play size={11} />}
                    </button>
                    {/* Download single */}
                    <button
                      onClick={() => { const a = document.createElement("a"); a.href = msg.wavUrl; a.download = `clip_${msg.id}.wav`; a.click(); }}
                      title="Download this clip"
                      style={{ background: "transparent", border: "1px solid var(--border-subtle)", borderRadius: 5, color: "var(--gray-400)", padding: "4px 7px", cursor: "pointer", display: "flex", alignItems: "center", flexShrink: 0 }}
                    >
                      <Download size={11} />
                    </button>
                    {/* Delete single */}
                    <button
                      onClick={(e) => { e.stopPropagation(); onDeleteClip(msg.id); }}
                      title="Delete this clip"
                      aria-label="Delete this clip"
                      style={{ background: "transparent", border: "1px solid var(--border-subtle)", borderRadius: 5, color: "#f87171", padding: "4px 7px", cursor: "pointer", display: "flex", alignItems: "center", flexShrink: 0 }}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>

                  {/* Waveform range — only when selected */}
                  {selected && (
                    <div style={{ padding: "2px 14px 14px 14px" }}>
                      <WaveformRange
                        wavUrl={msg.wavUrl}
                        start={range.start}
                        end={range.end > 0 ? range.end : (dur || 1)}
                        duration={dur || 1}
                        onDurationLoaded={(d) => {
                          setDurations(prev => ({ ...prev, [msg.id]: d }));
                          setRanges(prev => prev[msg.id] ? prev : { ...prev, [msg.id]: { start: 0, end: d } });
                        }}
                        onChange={(s, e) => setRanges(prev => ({ ...prev, [msg.id]: { start: s, end: e } }))}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Bottom bar — filename + merge */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 20px", borderTop: "1px solid var(--border-subtle)", background: "var(--card, #ffffff)" }}>
          <span style={{ fontSize: 11, color: "var(--gray-500)", flexShrink: 0 }}>Filename:</span>
          <input
            type="text"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            placeholder="merged"
            style={{ flex: 1, minWidth: 0, background: "var(--surface-subtle)", border: "1px solid var(--border-subtle)", borderRadius: 6, padding: "6px 10px", color: "var(--text-primary)", fontSize: 12, outline: "none" }}
          />
          <span style={{ fontSize: 11, color: "var(--gray-600)", flexShrink: 0 }}>.wav</span>
          <button
            onClick={mergeAndDownload}
            disabled={merging || selectedCount === 0}
            style={{
              background: selectedCount === 0 ? "var(--surface-subtle)" : "rgba(109,159,55,0.14)",
              border: `1px solid ${selectedCount === 0 ? "var(--border-subtle)" : "rgba(109,159,55,0.4)"}`,
              borderRadius: 7, padding: "7px 18px",
              color: selectedCount === 0 ? "var(--gray-600)" : "var(--bamboo-400)",
              fontSize: 12, fontWeight: 600, cursor: selectedCount === 0 || merging ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
              opacity: selectedCount === 0 ? 0.5 : 1,
            }}
          >
            <Merge size={13} /> {merging ? "Merging…" : `Merge & Download${selectedCount > 0 ? ` (${selectedCount})` : ""}`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Simple audio clip player (replaces SoapBubblePlayer) ─────────────────────
function RealtimeClip({ msg, tgtLang, flag, autoPlay, onDelete }: { msg: AudioMessage; tgtLang: string; flag: string; autoPlay?: boolean; onDelete?: () => void }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); } else { a.play(); }
  };

  const download = () => {
    const a = document.createElement("a");
    a.href = msg.wavUrl;
    a.download = `translation_${tgtLang}_${msg.id}.wav`;
    a.click();
  };

  return (
    <div
      className="vm-fade-in"
      style={{
        background: "var(--surface-subtle)",
        border: "1px solid var(--border-subtle)",
        borderRadius: 8,
        padding: "8px 10px",
      }}
    >
      <audio
        ref={audioRef}
        src={msg.wavUrl}
        autoPlay={autoPlay}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setProgress(0); }}
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          if (el.duration) setProgress(el.currentTime / el.duration);
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
        <span style={{ fontSize: 11, flex: 1, color: "var(--text-muted)" }}>
          {flag} {new Date(msg.timestamp).toLocaleTimeString()}
        </span>
        <button
          onClick={toggle}
          style={{
            background: "rgba(109,159,55,0.15)", border: "1px solid rgba(109,159,55,0.3)", borderRadius: 4,
            color: "var(--bamboo-400)", padding: "3px 8px", cursor: "pointer",
            display: "flex", alignItems: "center", gap: 4, fontSize: 11,
          }}
        >
          {playing ? <Pause size={11} /> : <Play size={11} />}
          {playing ? "Pause" : "Play"}
        </button>
        <button
          onClick={download}
          title="Download WAV"
          style={{
            background: "transparent", border: "1px solid var(--border-subtle)",
            borderRadius: 4, color: "var(--gray-400)", padding: "3px 6px",
            cursor: "pointer", display: "flex", alignItems: "center",
          }}
        >
          <Download size={11} />
        </button>
        {onDelete && (
          <button
            onClick={onDelete}
            title="Delete clip"
            aria-label="Delete clip"
            style={{
              background: "transparent", border: "1px solid var(--border-subtle)",
              borderRadius: 4, color: "#f87171", padding: "3px 6px",
              cursor: "pointer", display: "flex", alignItems: "center",
            }}
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>
      {/* Progress bar */}
      <div style={{ height: 3, background: "var(--border-subtle)", borderRadius: 2 }}>
        <div style={{
          height: "100%", width: `${progress * 100}%`,
          background: "var(--bamboo-500, #8ab83a)", borderRadius: 2,
          transition: "width 0.1s linear",
        }} />
      </div>
      {msg.transcript && (
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 5 }}>{msg.transcript}</div>
      )}
      {msg.translation && (
        <div style={{ fontSize: 12, color: "var(--bamboo-300, #c5e08a)", fontWeight: 500, marginTop: 2 }}>{msg.translation}</div>
      )}
    </div>
  );
}

export default function RealTimeVoice() {
  const [voiceId, setVoiceId]     = useState("");
  const [srcLang, setSrcLang]     = useState("en");
  const [tgtLang, setTgtLang]     = useState("hi");
  const [engine, setEngine]       = useState<TranslateEngine>("qwen");   // translation engine
  // TTS (voice) engine follows the OUTPUT language: English → Orpheus (fast) is available and
  // default; every other language is Chatterbox-only. Voice cloning is a Chatterbox capability.
  const [ttsEngine, setTtsEngine] = useState<TtsEngine>("chatterbox");
  const orpheusAvailable = ORPHEUS_TTS_LANGS.includes(tgtLang);   // English only
  const canSelectVoice   = ttsEngine === "chatterbox";            // clone only on Chatterbox
  const [active, setActive]       = useState(false);
  const [status, setStatus]       = useState<"idle" | "connecting" | "ready" | "error">("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [messages, setMessages]   = useState<AudioMessage[]>([]);
  const [collections, setCollections] = useState<Record<string, AudioMessage[]>>({});
  const [openFolder, setOpenFolder]   = useState<string | null>(null);
  const [syncing, setSyncing]         = useState(false);
  const [vadLevel, setVadLevel]   = useState(0);
  const [useWorklet, setUseWorklet] = useState(true); // AudioWorklet vs ScriptProcessorNode fallback

  const wsRef        = useRef<ReturnType<typeof openRealtimeSession> | null>(null);
  const streamRef    = useRef<MediaStream | null>(null);
  const contextRef   = useRef<AudioContext | null>(null);
  // AudioWorklet node
  const workletRef   = useRef<AudioWorkletNode | null>(null);
  // ScriptProcessorNode fallback
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const energyRef    = useRef<number>(0);
  const vadTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  // Plays each translated clip aloud the moment it arrives, so the user HEARS the
  // translation live without clicking Play. Kept on a ref so a new clip stops the previous.
  const livePlayerRef = useRef<HTMLAudioElement | null>(null);
  const { user, isAuthenticated } = useAuth();
  const { voices } = useVoices();
  const { defaultVoiceId } = useVoice();
  const { canUseFeature, openModal: openStorageModal } = useStorage();
  const storageAccess = canUseFeature("voice");
  // Apply the user's default cloned voice once, without fighting later manual picks.
  const defaultAppliedRef = useRef(false);

  // voices now come from useVoices() hook (TanStack Query shared cache)

  // Pre-select the user's default cloned voice once it is available (authed only).
  useEffect(() => {
    if (!isAuthenticated) { defaultAppliedRef.current = false; return; }
    if (defaultAppliedRef.current) return;
    if (defaultVoiceId && voices.some((v) => v.voice_id === defaultVoiceId)) {
      setVoiceId(defaultVoiceId);
      defaultAppliedRef.current = true;
    }
  }, [isAuthenticated, defaultVoiceId, voices]);

  // The output language drives the voice engine: English defaults to Orpheus (fast streaming,
  // Chatterbox still selectable); any other language snaps to Chatterbox (Orpheus is English-only).
  useEffect(() => {
    setTtsEngine(orpheusAvailable ? "orpheus" : "chatterbox");
     
  }, [tgtLang]);

  // ── Restore collections from IndexedDB on mount ──
  useEffect(() => {
    loadAllClipsIDB().then((grouped) => {
      if (!Object.keys(grouped).length) return;
      const rehydrated: Record<string, AudioMessage[]> = {};
      for (const [pair, stored] of Object.entries(grouped)) {
        rehydrated[pair] = stored.map((sc) => ({
          id:          sc.id,
          wavUrl:      sc.cloudUrl ?? bufferToUrl(sc.audioBuffer),
          transcript:  sc.transcript,
          translation: sc.translation,
          timestamp:   sc.timestamp,
          langPair:    sc.langPair,
          srcLang:     sc.srcLang,
          tgtLang:     sc.tgtLang,
          cloudId:     sc.cloudId,
        }));
      }
      setCollections(rehydrated);
    }).catch(() => {});
  }, []);

  // ── Sync from cloud ──
  const syncFromCloud = useCallback(async () => {
    if (!isAuthenticated || syncing) return;
    setSyncing(true);
    try {
      const res = await getLiveTranslationClips(0, 200);
      if (!res.items.length) { setSyncing(false); return; }
      const rehydrated: Record<string, AudioMessage[]> = {};
      for (const item of res.items) {
        const d = (item.output_data ?? {}) as Record<string, string>;
        const pair = d.src_lang && d.tgt_lang ? `${d.src_lang}_${d.tgt_lang}` : "unknown";
        rehydrated[pair] = [
          {
            id:          item.id,
            wavUrl:      item.audio_url ?? "",
            transcript:  String(d.transcript  ?? item.input_summary  ?? ""),
            translation: String(d.translation ?? item.output_summary ?? ""),
            timestamp:   item.created_at ? new Date(item.created_at).getTime() : 0,
            langPair:    pair,
            srcLang:     d.src_lang,
            tgtLang:     d.tgt_lang,
            cloudId:     item.id,   // cloud-synced clips are keyed by their MongoDB id
          },
          ...(rehydrated[pair] ?? []),
        ];
      }
      setCollections(rehydrated);
    } catch { /* silent */ } finally { setSyncing(false); }
  }, [isAuthenticated, syncing]);

  // ── Delete: single clip + whole collection (IndexedDB + cloud, both best-effort) ──
  const removeClip = useCallback(async (pair: string, clip: AudioMessage) => {
    // Optimistic UI removal first so it feels instant.
    setCollections((prev) => {
      const list = (prev[pair] ?? []).filter((c) => c.id !== clip.id);
      const next = { ...prev };
      if (list.length) next[pair] = list; else delete next[pair];
      return next;
    });
    setMessages((prev) => prev.filter((m) => m.id !== clip.id));
    try { await deleteClipIDB(clip.id); } catch { /* best-effort local delete */ }
    if (isAuthenticated && clip.cloudId) {
      try { await deleteHistoryItem(clip.cloudId); } catch { /* best-effort cloud delete */ }
    }
  }, [isAuthenticated]);

  const removeCollection = useCallback(async (pair: string) => {
    const clips = collections[pair] ?? [];
    setCollections((prev) => { const next = { ...prev }; delete next[pair]; return next; });
    setMessages((prev) => prev.filter((m) => m.langPair !== pair));
    for (const c of clips) {
      try { await deleteClipIDB(c.id); } catch { /* best-effort */ }
      if (isAuthenticated && c.cloudId) {
        try { await deleteHistoryItem(c.cloudId); } catch { /* best-effort */ }
      }
    }
  }, [collections, isAuthenticated]);

  // VAD energy bar — smooth mic energy for display
  useEffect(() => {
    if (!active) return;
    vadTimerRef.current = setInterval(() => {
      setVadLevel((prev) => prev * 0.7 + energyRef.current * 0.3);
      energyRef.current *= 0.85; // decay
    }, 80);
    return () => { if (vadTimerRef.current) clearInterval(vadTimerRef.current); };
  }, [active]);

  // Computed options for LanguageSelect. Input (SPEAK IN) can be any language the
  // recognizer handles; OUTPUT is restricted to languages a TTS engine can speak
  // (Chatterbox: 23 global + 8 Indian languages) — the engine is
  // then auto-chosen from the output language server-side.
  const rtLangOptions: LangOption[] = Object.entries(LANGUAGES).map(([k, v]) => ({
    value: k, label: v.name, flag: v.flag, group: v.group,
  }));
  const rtOutputLangOptions: LangOption[] = rtLangOptions.filter((o) => CHATTERBOX_TTS_LANGS.includes(o.value));

  // Handle WebSocket events
  const handleEvent = useCallback((event: RealtimeEvent) => {
    if (event.type === "ready") {
      setStatus("ready");
      setStatusMsg(`Live — ${LANGUAGES[tgtLang]?.flag ?? ""} ${LANGUAGES[tgtLang]?.name ?? tgtLang}`);
    } else if (event.type === "audio" && event.wav_b64) {
      const bytes = Uint8Array.from(atob(event.wav_b64), (c) => c.charCodeAt(0));
      const blob  = new Blob([bytes], { type: "audio/wav" });
      const url   = URL.createObjectURL(blob);
      const pair  = `${srcLang}_${tgtLang}`;
      const clipId = crypto.randomUUID();
      const now    = Date.now();
      const msg: AudioMessage = {
        id: clipId, wavUrl: url, timestamp: now,
        langPair: pair, srcLang, tgtLang,
      };
      // Play the translated utterance aloud immediately so the user HEARS it live
      // (the Start-button gesture unlocked audio, so this plays without a click).
      try {
        livePlayerRef.current?.pause();
        const player = new Audio(url);
        livePlayerRef.current = player;
        void player.play().catch(() => {});
      } catch { /* autoplay can be blocked before a user gesture — Play button still works */ }
      // Keep last clip visible in live area
      setMessages((prev) => [msg, ...prev.slice(0, 0)]);
      // Persist in collections
      setCollections((prev) => ({ ...prev, [pair]: [msg, ...(prev[pair] ?? [])] }));

      // IndexedDB save
      blob.arrayBuffer().then((buf) => {
        const sc: StoredClip = {
          id: clipId, langPair: pair, srcLang, tgtLang,
          transcript: "", translation: "", timestamp: now, audioBuffer: buf,
        };
        return saveClipIDB(sc);
      }).catch(() => {});

      // Cloud save (fire-and-forget)
      if (isAuthenticated) {
        saveLiveTranslationClip(blob, { srcLang, tgtLang, transcript: "", translation: "", timestamp: now })
          .then((result) => {
            // Record the cloud id (result.id) so this clip can be deleted from the cloud later.
            updateClipCloud(clipId, result.cloud_url ?? "", result.id, result.local_path ?? undefined);
            setCollections((prev) => {
              const list = prev[pair] ?? [];
              return { ...prev, [pair]: list.map((c) => c.id === clipId ? { ...c, cloudId: result.id, wavUrl: result.cloud_url ?? c.wavUrl } : c) };
            });
          }).catch(() => {});
      }
    } else if (event.type === "error") {
      setStatus("error");
      setStatusMsg(event.message || "Unknown error");
    }
  }, [srcLang, tgtLang]);

  // Convert float32 chunk → int16 PCM and send over WebSocket
  const sendFloat32Chunk = useCallback((samples: Float32Array, session: ReturnType<typeof openRealtimeSession>) => {
    const pcm16 = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      pcm16[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767)));
    }
    session.sendChunk(pcm16.buffer);
  }, []);

  const startSession = useCallback(async () => {
    if (active || status === "connecting") return;
    setStatus("connecting");
    setStatusMsg("Connecting…");
    setMessages([]);

    // 1. Mic access
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch {
      setStatus("error");
      setStatusMsg("Microphone access denied");
      return;
    }
    streamRef.current = stream;

    // 2. WebSocket session — Chatterbox clones from the selected voice (or the default
    //    reference when none is chosen); Orpheus uses a fixed preset voice, so no voiceId.
    const session = openRealtimeSession(
      {
        srcLang,
        tgtLang,
        voiceId: canSelectVoice ? (voiceId || "") : "",
        sampleRate: SAMPLE_RATE,
        engine,
        ttsEngine,
      },
      handleEvent,
      isAuthenticated ? user?.tenants?.[0] : undefined,
    );
    wsRef.current = session;

    // 3. AudioContext
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    contextRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);

    // ── Try AudioWorklet first (dedicated audio thread, no main-thread jank) ──
    let workletOk = false;
    if (useWorklet) {
      try {
        await ctx.audioWorklet.addModule(WORKLET_PATH);
        const node = new AudioWorkletNode(ctx, "audio-capture-processor");
        workletRef.current = node;

        node.port.onmessage = (e) => {
          if (e.data?.type === "chunk") {
            energyRef.current = Math.min(1, (e.data.rms ?? 0) * 6);
            sendFloat32Chunk(e.data.samples as Float32Array, session);
          }
        };

        source.connect(node);
        node.connect(ctx.destination);
        workletOk = true;
      } catch (err) {
        console.warn("[RealTimeVoice] AudioWorklet unavailable, falling back to ScriptProcessorNode:", err);
        setUseWorklet(false);
        workletRef.current?.disconnect();
        workletRef.current = null;
      }
    }

    // ── ScriptProcessorNode fallback (deprecated but universally supported) ──
    if (!workletOk) {
      const processor = ctx.createScriptProcessor(CHUNK_SAMPLES, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        const rms = Math.sqrt(input.reduce((s, v) => s + v * v, 0) / input.length);
        energyRef.current = Math.min(1, rms * 6);
        sendFloat32Chunk(input, session);
      };

      source.connect(processor);
      processor.connect(ctx.destination);
    }

    setActive(true);
  }, [active, srcLang, tgtLang, voiceId, engine, ttsEngine, canSelectVoice, handleEvent, isAuthenticated, user, useWorklet, sendFloat32Chunk]);

  const stopSession = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    workletRef.current?.port.postMessage({ type: "stop" });
    workletRef.current?.disconnect();
    workletRef.current = null;

    processorRef.current?.disconnect();
    processorRef.current = null;

    livePlayerRef.current?.pause();
    livePlayerRef.current = null;

    contextRef.current?.close().catch(() => {});
    contextRef.current = null;

    setActive(false);
    setStatus("idle");
    setStatusMsg("");
    setVadLevel(0);
  }, []);

  useEffect(() => () => stopSession(), []);

  return (
    <div className="vm-card">
      {!storageAccess.allowed && (
        <div className="vm-storage-gate-banner">
          <span>Storage not configured.</span>
          <button className="vm-storage-gate-link" onClick={openStorageModal}>Configure storage</button>
        </div>
      )}
      <div className={!storageAccess.allowed ? "vm-card-gated" : undefined}>
      {/* Header */}
      <div className="vm-card-header">
        <div className="vm-card-icon" style={active ? { background: "rgba(239,68,68,0.15)", color: "#ef4444" } : {}}>
          <Radio size={18} strokeWidth={2} />
        </div>
        <div>
          <div className="vm-card-title">Real-Time Voice Translation</div>
          <div className="vm-card-subtitle">VAD → faster-whisper → {engine === "qwen" ? "Qwen" : "NLLB"} → {ttsEngine === "orpheus" ? "Orpheus" : "Chatterbox"}</div>
        </div>
        {active && (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{
              width: 8, height: 8, borderRadius: "50%",
              background: "#ef4444", boxShadow: "0 0 6px #ef4444",
              animation: "pulse 1s ease-in-out infinite",
            }} />
            <span style={{ fontSize: 11, color: "#ef4444", fontWeight: 600, letterSpacing: "0.05em" }}>LIVE</span>
          </div>
        )}
      </div>

      {/* Language selectors */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 110 }}>
          <div className="vm-label" style={{ fontSize: 10, marginBottom: 3 }}>Speak in</div>
          <LanguageSelect
            value={srcLang}
            onChange={setSrcLang}
            options={rtLangOptions}
            disabled={active}
            placeholder="Source language"
          />
        </div>
        <div style={{ flex: 1, minWidth: 110 }}>
          <div className="vm-label" style={{ fontSize: 10, marginBottom: 3 }}>Output in</div>
          <LanguageSelect
            value={tgtLang}
            onChange={setTgtLang}
            options={rtOutputLangOptions}
            disabled={active}
            placeholder="Target language"
          />
        </div>
      </div>

      {/* Voice engine — Orpheus only appears for English output; other languages are Chatterbox */}
      <div style={{ marginBottom: 10 }}>
        <div className="vm-label" style={{ fontSize: 10, marginBottom: 3 }}>Voice engine</div>
        <div role="group" aria-label="Voice engine" style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
          {TTS_ENGINE_OPTIONS.filter((e) => e.id === "chatterbox" || orpheusAvailable).map((e) => {
            const activeEngine = ttsEngine === e.id;
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => setTtsEngine(e.id)}
                disabled={active}
                aria-pressed={activeEngine}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2,
                  padding: "5px 10px", borderRadius: 8, cursor: active ? "not-allowed" : "pointer", textAlign: "left",
                  border: `1px solid ${activeEngine ? "var(--bamboo-500, #6d9f37)" : "var(--border-subtle)"}`,
                  background: activeEngine ? "rgba(109,159,55,0.10)" : "var(--surface-subtle)",
                  opacity: active ? 0.6 : 1, fontSize: 11,
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600, color: "var(--text-primary)" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: activeEngine ? "var(--bamboo-500, #6d9f37)" : "var(--border-strong, #ccc)" }} />
                  {e.name}
                </span>
                <span style={{ color: "var(--text-muted)", fontSize: 9 }}>{e.hint}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Voice selector — Chatterbox only. Orpheus is a fixed-voice English engine (no cloning). */}
      {canSelectVoice && (
        <div style={{ marginBottom: 10 }}>
          <div className="vm-label" style={{ fontSize: 10, marginBottom: 3 }}>Voice</div>
          <select className="vm-select" value={voiceId} onChange={(e) => setVoiceId(e.target.value)} disabled={active} style={{ fontSize: 12 }}>
            <option value="">Default Chatterbox voice</option>
            {/* Cloned voices are account-scoped — only offered to signed-in users. */}
            {isAuthenticated && voices.map((v) => (
              <option key={v.voice_id} value={v.voice_id}>
                {v.name || v.voice_id}{v.language ? ` (${v.language.toUpperCase()})` : ""}
              </option>
            ))}
          </select>
          <div style={{ fontSize: 9, color: "var(--text-faint)", marginTop: 3, paddingLeft: 2 }}>
            {voiceId
              ? "Zero-shot clone of your reference — no training needed."
              : "Built-in Chatterbox reference. Pick a Voice Library entry to clone your own."}
          </div>
        </div>
      )}

      {/* Translation engine */}
      <div style={{ marginBottom: 10 }}>
        <div className="vm-label" style={{ fontSize: 10, marginBottom: 3 }}>Translation engine</div>
        <EngineToggle value={engine} onChange={setEngine} disabled={active} />
      </div>

      {/* Mic energy bar */}
      {active && (
        <div style={{ marginBottom: 10, height: 4, borderRadius: 2, background: "var(--surface-subtle)", overflow: "hidden" }}>
          <div style={{
            height: "100%",
            width: `${Math.round(vadLevel * 100)}%`,
            background: vadLevel > 0.5 ? "#4ade80" : vadLevel > 0.15 ? "#fbbf24" : "#3f3f3f",
            transition: "width 0.08s linear, background 0.1s",
            borderRadius: 2,
          }} />
        </div>
      )}

      {/* Transcription model — the realtime pipeline runs a fixed in-process faster-whisper
          model on the router (not switchable per session), so this is a read-only indicator. */}
      {!active && status !== "connecting" && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: "var(--gray-400)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>
            Transcription
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
            borderRadius: 8, background: "var(--surface-subtle)", border: "1px solid var(--border-subtle)",
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ade80", flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{REALTIME_STT_MODEL}</span>
            <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: "auto" }}>fixed · highest accuracy</span>
          </div>
        </div>
      )}

      {/* Start / Stop */}
      <button
        className={`vm-btn ${active || status === "connecting" ? "vm-btn-danger" : "vm-btn-primary"}`}
        style={{ width: "100%", gap: 8 }}
        onClick={active || status === "connecting" ? stopSession : startSession}
      >
        {status === "connecting" ? (
          <><div className="vm-spinner" /><span>Connecting… (click to cancel)</span></>
        ) : active ? (
          <><Square size={14} strokeWidth={2.5} /><span>Stop</span></>
        ) : (
          <><Mic size={14} strokeWidth={2.5} /><span>Start Live Translation</span></>
        )}
      </button>

      {/* Status */}
      {statusMsg && (
        <div style={{
          marginTop: 8, textAlign: "center", fontSize: 11,
          color: status === "error" ? "#f87171" : "var(--text-muted)",
        }}>
          {statusMsg}
        </div>
      )}

      {/* Latest incoming clip — auto-plays, shows while session is live */}
      {messages.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 10, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
            Latest
          </div>
          <RealtimeClip
            msg={messages[0]}
            tgtLang={tgtLang}
            flag={LANGUAGES[tgtLang]?.flag ?? ""}
            onDelete={() => removeClip(messages[0].langPair ?? `${srcLang}_${tgtLang}`, messages[0])}
          />
        </div>
      )}

      {/* Collections — language-pair folders (always visible) */}
      <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 10, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.08em", flex: 1 }}>Collections</span>
            {isAuthenticated && Object.keys(collections).length > 0 && (
              <button onClick={syncFromCloud} disabled={syncing} style={{
                background: "transparent", border: "1px solid var(--border-subtle)",
                borderRadius: 4, color: "var(--text-faint)", padding: "2px 7px",
                cursor: syncing ? "default" : "pointer",
                display: "flex", alignItems: "center", gap: 3, fontSize: 10,
                opacity: syncing ? 0.5 : 1,
              }}>
                <RefreshCw size={10} style={{ animation: syncing ? "spin 1s linear infinite" : "none" }} />
                {syncing ? "Syncing…" : "Sync"}
              </button>
            )}
          </div>
          {Object.keys(collections).length === 0 ? (
            <div style={{
              padding: "14px 12px", borderRadius: 8, textAlign: "center",
              border: "1px dashed var(--border-subtle)",
            }}>
              <div style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 10 }}>
                No clips yet — start a session or sync from cloud.
              </div>
              {isAuthenticated && (
                <button onClick={syncFromCloud} disabled={syncing} className="vm-btn"
                  style={{ margin: "0 auto", display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                  <RefreshCw size={12} style={{ animation: syncing ? "spin 1s linear infinite" : "none" }} />
                  {syncing ? "Syncing…" : "Sync from Cloud"}
                </button>
              )}
            </div>
          ) : null}
          {Object.keys(collections).length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {Object.entries(collections).map(([pair, clips]) => (
                <button
                  key={pair}
                  onClick={() => setOpenFolder(pair)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "9px 12px",
                    background: "var(--surface-subtle)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 8, cursor: "pointer",
                    textAlign: "left", color: "inherit", transition: "border-color 0.15s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--bamboo-600)")}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border-subtle)")}
                >
                  <FolderOpen size={14} style={{ color: "var(--bamboo-500)", flexShrink: 0 }} />
                  <span style={{ fontSize: 13, flex: 1, fontWeight: 500 }}>
                    {langLabel(pair, LANGUAGES)}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--gray-500)" }}>
                    {clips.length} clip{clips.length !== 1 ? "s" : ""}
                  </span>
                  <ChevronRight size={13} style={{ color: "var(--gray-600)" }} />
                </button>
              ))}
            </div>
          )}
        </div>

      {/* Collection modal */}
      {openFolder && collections[openFolder] && (
        <CollectionModal
          langPair={openFolder}
          clips={collections[openFolder]}
          onClose={() => setOpenFolder(null)}
          onDeleteClip={(id) => {
            const clip = collections[openFolder]?.find((c) => c.id === id);
            if (clip) void removeClip(openFolder, clip);
          }}
          onDeleteCollection={() => void removeCollection(openFolder)}
        />
      )}

      {/* Info footer */}
      <div className="vm-info" style={{ marginTop: 10 }}>
        Silero VAD → faster-whisper → translate → <strong>{ttsEngine === "orpheus" ? "Orpheus streaming" : "Chatterbox zero-shot"}</strong>.
        {" "}AudioWorklet runs in a dedicated thread for glitch-free capture.
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.3; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        .vm-btn-danger {
          background: rgba(239,68,68,0.12);
          border-color: rgba(239,68,68,0.35);
          color: #f87171;
        }
        .vm-btn-danger:hover:not(:disabled) {
          background: rgba(239,68,68,0.2);
          border-color: rgba(239,68,68,0.6);
        }
      `}</style>
      </div> {/* end vm-card-gated wrapper */}
    </div>
  );
}
