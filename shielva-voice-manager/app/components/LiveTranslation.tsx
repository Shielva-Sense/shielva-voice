"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { Mic, MicOff, Radio, Square, Volume2, FolderOpen, X, Download, Play, Pause, ChevronRight, RefreshCw } from "lucide-react";
import { notify } from "../lib/toast";
import { transcribe, translate, synthesizeSpeech, saveLiveTranslationClip, getLiveTranslationClips } from "../lib/amt-api";
import { recordMic } from "../lib/audio-utils";
import { useProcessing } from "../context/ProcessingContext";
import { useAuth } from "../context/AuthContext";
import UsageIndicator from "./UsageIndicator";
import {
  saveClipIDB,
  loadAllClipsIDB,
  updateClipCloud,
  bufferToUrl,
  type StoredClip,
} from "../lib/live-translation-store";

const CHUNK_SEC = 5;
const CHUNK_MS  = CHUNK_SEC * 1000;

const LANG_NAMES: Record<string, string> = {
  en: "English", hi: "Hindi", es: "Spanish", fr: "French", de: "German",
  ja: "Japanese", zh: "Chinese", ar: "Arabic", pt: "Portuguese", ru: "Russian",
  ko: "Korean", it: "Italian", nl: "Dutch", tr: "Turkish", pl: "Polish",
  sv: "Swedish", ta: "Tamil", te: "Telugu", bn: "Bengali", mr: "Marathi",
  gu: "Gujarati", kn: "Kannada", ml: "Malayalam", pa: "Punjabi", ur: "Urdu",
  vi: "Vietnamese", th: "Thai", id: "Indonesian", ms: "Malay",
};

const LIVE_STAGES = [
  { label: "Recording audio...",        percent: 10 },
  { label: "Transcribing with faster-whisper...", percent: 30 },
  { label: "Translating...",            percent: 50 },
  { label: "Synthesizing speech...",    percent: 75 },
  { label: "Playing translation...",    percent: 95 },
];

interface LiveClip {
  id: string;
  langPair: string;
  srcLang: string;
  tgtLang: string;
  transcript: string;
  translation: string;
  detectedLang?: string;
  blobUrl: string;           // active object URL (revoked on unmount)
  cloudUrl?: string;         // R2 URL (set after backend save completes)
  localPath?: string;        // Gateway-local file path
  timestamp: number;
}

interface PipelineState {
  recording: boolean;
  processing: number;
  playing: boolean;
}

function langLabel(pair: string): string {
  const [src, tgt] = pair.split("_");
  return `${LANG_NAMES[src] ?? src} → ${LANG_NAMES[tgt] ?? tgt}`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ── Simple clip row (no own audio element — driven by parent) ─────────────────
function ClipRow({
  clip, isActive, progress,
  onPlay, onDownload,
}: {
  clip:       LiveClip;
  isActive:   boolean;
  progress:   number;
  onPlay:     () => void;
  onDownload: () => void;
}) {
  return (
    <div style={{
      background: isActive ? "rgba(109,159,55,0.06)" : "var(--surface-subtle)",
      border: `1px solid ${isActive ? "rgba(109,159,55,0.3)" : "var(--border-subtle)"}`,
      borderRadius: 8, padding: "10px 12px", marginBottom: 8,
      transition: "background 0.15s, border 0.15s",
    }}>
      {/* Top row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 10, color: "var(--gray-500)", flex: 1 }}>
          {formatTime(clip.timestamp)}
          {clip.detectedLang && clip.detectedLang !== clip.srcLang && (
            <span style={{ marginLeft: 6, color: "var(--bamboo-500)" }}>
              (detected: {LANG_NAMES[clip.detectedLang] ?? clip.detectedLang})
            </span>
          )}
          {clip.cloudUrl && <span style={{ marginLeft: 6, color: "var(--gray-600)" }}>· cloud</span>}
          {clip.localPath && <span style={{ marginLeft: 4, color: "var(--bamboo-700)" }}>· local</span>}
        </span>
        <button onClick={onPlay} style={{
          background: isActive ? "var(--bamboo-600, #5d8f25)" : "var(--bamboo-700, #4d7a18)",
          border: "none", borderRadius: 4,
          color: "var(--bamboo-200)", padding: "4px 8px", cursor: "pointer",
          display: "flex", alignItems: "center", gap: 4, fontSize: 11,
        }}>
          {isActive ? <Pause size={11} /> : <Play size={11} />}
          {isActive ? "Pause" : "Play"}
        </button>
        <button onClick={onDownload} title="Download WAV" style={{
          background: "transparent", border: "1px solid var(--border-subtle)",
          borderRadius: 4, color: "var(--gray-400)", padding: "4px 6px",
          cursor: "pointer", display: "flex", alignItems: "center",
        }}>
          <Download size={11} />
        </button>
      </div>
      {/* Progress bar — only shown for active clip */}
      <div style={{ height: 3, background: "var(--border-subtle)", borderRadius: 2, marginBottom: 6 }}>
        <div style={{
          height: "100%", width: `${isActive ? progress * 100 : 0}%`,
          background: "var(--bamboo-500, #8ab83a)", borderRadius: 2,
          transition: "width 0.1s linear",
        }} />
      </div>
      <div style={{ fontSize: 11, color: "var(--gray-400, #888)", marginBottom: 2 }}>
        <MicOff size={9} style={{ display: "inline", marginRight: 4 }} />
        {clip.transcript}
      </div>
      <div style={{ fontSize: 12, color: "var(--bamboo-300, #c5e08a)", fontWeight: 500 }}>
        {clip.translation}
      </div>
    </div>
  );
}

// ── Folder collection modal ───────────────────────────────────────────────────
function CollectionModal({
  langPair, clips, onClose,
}: {
  langPair: string;
  clips: LiveClip[];
  onClose: () => void;
}) {
  // Single shared audio element — only ONE clip plays at a time
  const audioRef    = useRef<HTMLAudioElement | null>(null);
  const [activeId,  setActiveId]  = useState<string | null>(null);
  const [progress,  setProgress]  = useState(0);

  // Stop playback when modal closes
  useEffect(() => {
    return () => { audioRef.current?.pause(); };
  }, []);

  const playClip = (clip: LiveClip) => {
    const a = audioRef.current;
    if (!a) return;
    const src = clip.blobUrl || clip.cloudUrl || "";
    if (!src) return;

    if (activeId === clip.id) {
      // Toggle: same clip clicked — pause/resume
      a.paused ? a.play() : a.pause();
      return;
    }

    // Different clip — swap src and start fresh
    a.pause();
    a.src = src;
    a.currentTime = 0;
    setProgress(0);
    setActiveId(clip.id);
    a.play().catch(() => {});
  };

  const download = (clip: LiveClip) => {
    const a   = document.createElement("a");
    a.href    = clip.blobUrl || clip.cloudUrl || "";
    a.download = `${clip.langPair}_${clip.id.slice(0, 8)}.wav`;
    a.click();
  };

  // Render into document.body so it's never clipped by a parent card's overflow/z-index
  return createPortal(
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)",
        zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--card, #ffffff)", border: "1px solid var(--border-subtle)",
          borderRadius: 12, width: "100%", maxWidth: 540, maxHeight: "80vh",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Single hidden audio element shared by all clips */}
        <audio
          ref={audioRef}
          onPause={() => setActiveId((id) => id)}   // keep id so row stays highlighted
          onEnded={() => { setActiveId(null); setProgress(0); }}
          onTimeUpdate={(e) => {
            const el = e.currentTarget;
            if (el.duration) setProgress(el.currentTime / el.duration);
          }}
        />

        <div style={{
          display: "flex", alignItems: "center", padding: "14px 16px",
          borderBottom: "1px solid var(--border-subtle)", gap: 10,
        }}>
          <FolderOpen size={16} style={{ color: "var(--bamboo-400)" }} />
          <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{langLabel(langPair)}</span>
          <span style={{ fontSize: 11, color: "var(--gray-500)", marginRight: 8 }}>
            {clips.length} clip{clips.length !== 1 ? "s" : ""}
          </span>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "var(--gray-400)", cursor: "pointer", padding: 2 }}>
            <X size={16} />
          </button>
        </div>
        <div style={{ overflowY: "auto", padding: "12px 16px", flex: 1 }}>
          {clips.map((clip) => (
            <ClipRow
              key={clip.id}
              clip={clip}
              isActive={activeId === clip.id && !(audioRef.current?.paused)}
              progress={activeId === clip.id ? progress : 0}
              onPlay={() => playClip(clip)}
              onDownload={() => download(clip)}
            />
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Blob URL registry — track URLs to revoke on unmount ──────────────────────
const blobUrlRegistry = new Set<string>();
function trackBlob(url: string) { blobUrlRegistry.add(url); return url; }
function revokeBlobUrl(url: string) { URL.revokeObjectURL(url); blobUrlRegistry.delete(url); }

// ── Main component ────────────────────────────────────────────────────────────
export default function LiveTranslation() {
  const [srcLang, setSrcLang]     = useState("en");
  const [tgtLang, setTgtLang]     = useState("hi");
  const [running, setRunning]     = useState(false);
  const [pipeState, setPipeState] = useState<PipelineState>({ recording: false, processing: 0, playing: false });
  const [level, setLevel]         = useState(0);
  const [elapsed, setElapsed]     = useState(0);
  const [history, setHistory]     = useState<{ id: number; transcript: string; translation: string; detectedLang?: string }[]>([]);
  const [chunkCount, setChunkCount] = useState(0);
  // Persistent collections — keyed by langPair
  const [clips, setClips]         = useState<Record<string, LiveClip[]>>({});
  const [openFolder, setOpenFolder] = useState<string | null>(null);
  const [syncing, setSyncing]     = useState(false);

  const stopRef     = useRef<(() => void) | null>(null);
  const cancelledRef = useRef(false);
  const audioRef    = useRef<HTMLAudioElement | null>(null);
  const playQueueRef = useRef<{ blob: Blob; id: number }[]>([]);
  const playingRef  = useRef(false);
  const chunkIdRef  = useRef(0);
  const proc        = useProcessing();
  const { isAuthenticated, refreshUsage } = useAuth();

  // ── On mount: restore clips from IndexedDB ────────────────────────────────
  useEffect(() => {
    loadAllClipsIDB().then((grouped) => {
      if (Object.keys(grouped).length === 0) return;
      const rehydrated: Record<string, LiveClip[]> = {};
      for (const [pair, storedClips] of Object.entries(grouped)) {
        rehydrated[pair] = storedClips.map((sc) => ({
          id:          sc.id,
          langPair:    sc.langPair,
          srcLang:     sc.srcLang,
          tgtLang:     sc.tgtLang,
          transcript:  sc.transcript,
          translation: sc.translation,
          blobUrl:     trackBlob(bufferToUrl(sc.audioBuffer)),
          cloudUrl:    sc.cloudUrl,
          localPath:   sc.localPath,
          timestamp:   sc.timestamp,
        }));
      }
      setClips(rehydrated);
    }).catch(() => {});
    // Revoke all tracked blob URLs on unmount
    return () => { blobUrlRegistry.forEach(revokeBlobUrl); };
  }, []);

  // ── Sync from cloud (R2) ──────────────────────────────────────────────────
  const syncFromCloud = useCallback(async () => {
    if (!isAuthenticated || syncing) return;
    setSyncing(true);
    try {
      const res = await getLiveTranslationClips(0, 200);
      if (!res.items.length) { notify.info?.("No cloud clips found"); setSyncing(false); return; }

      const rehydrated: Record<string, LiveClip[]> = {};
      for (const item of res.items) {
        const d     = (item.output_data ?? {}) as Record<string, string | number>;
        const src   = String(d.src_lang   ?? "");
        const tgt   = String(d.tgt_lang   ?? "");
        const pair  = src && tgt ? `${src}_${tgt}` : "unknown";
        const clip: LiveClip = {
          id:          item.id,
          langPair:    pair,
          srcLang:     src,
          tgtLang:     tgt,
          transcript:  String(d.transcript  ?? item.input_summary ?? ""),
          translation: String(d.translation ?? item.output_summary ?? ""),
          blobUrl:     item.audio_url ?? "",   // play via R2 URL if no local blob
          cloudUrl:    item.audio_url ?? undefined,
          localPath:   String(d.local_path ?? "") || undefined,
          timestamp:   item.created_at ? new Date(item.created_at).getTime() : 0,
        };
        rehydrated[pair] = [clip, ...(rehydrated[pair] ?? [])];
      }
      setClips(rehydrated);
      notify.success?.(`Synced ${res.items.length} clip${res.items.length !== 1 ? "s" : ""} from cloud`);
    } catch (e) {
      notify.error("Sync failed", String(e));
    } finally {
      setSyncing(false);
    }
  }, [isAuthenticated, syncing]);

  // ── Playback queue ────────────────────────────────────────────────────────
  const drainPlayQueue = useCallback(async () => {
    if (playingRef.current) return;
    playingRef.current = true;
    setPipeState((s) => ({ ...s, playing: true }));

    while (playQueueRef.current.length > 0 && !cancelledRef.current) {
      const item = playQueueRef.current.shift()!;
      const url  = URL.createObjectURL(item.blob);
      const audio = new Audio(url);
      audioRef.current = audio;

      await new Promise<void>((res) => {
        audio.onended = () => res();
        audio.onerror = () => res();
        audio.play().catch(() => res());
      });
      URL.revokeObjectURL(url);
    }

    audioRef.current = null;
    playingRef.current = false;
    setPipeState((s) => ({ ...s, playing: false }));
  }, []);

  // ── Process one chunk ─────────────────────────────────────────────────────
  const processChunk = useCallback(async (
    audioBlob: Blob, chunkId: number, src: string, tgt: string,
  ): Promise<boolean> => {
    if (cancelledRef.current) return false;
    setPipeState((s) => ({ ...s, processing: s.processing + 1 }));

    try {
      // 1. Transcribe — auto-detect spoken language (no X-Language hint)
      let transcript  = "";
      let detectedLang: string = src;
      try {
        const r = await transcribe(audioBlob);
        transcript   = r.text?.trim() || "";
        if (r.detected_lang) detectedLang = r.detected_lang;
      } catch (err: any) {
        if (err?.quota) { notify.quotaExceeded(err.quota); return false; }
        notify.serviceOffline("faster-whisper ASR");
        return false;
      }

      if (cancelledRef.current || !transcript) return !cancelledRef.current;

      // 2. Translate — use detected language as source
      let translatedText = "";
      try {
        const effectiveSrc = detectedLang !== tgt ? detectedLang : src;
        const r = await translate(transcript, effectiveSrc, tgt);
        translatedText = r.translated_text;
      } catch (err: any) {
        if (err?.quota) { notify.quotaExceeded(err.quota); return false; }
        notify.serviceOffline("Qwen Translator");
        return false;
      }

      if (cancelledRef.current) return false;

      setHistory((prev) => [
        { id: chunkId, transcript, translation: translatedText, detectedLang: detectedLang !== src ? detectedLang : undefined },
        ...prev,
      ].slice(0, 20));

      // 3. Synthesize the translated text with IndicF5 (zero-shot). IndicF5 renders
      //    the target-language script directly, so the translated text is handed to
      //    it as-is using the default reference voice.
      let wavBlob: Blob;
      try {
        wavBlob = await synthesizeSpeech({ text: translatedText });
      } catch (err: any) {
        if (err?.quota) { notify.quotaExceeded(err.quota); return false; }
        notify.serviceOffline("IndicF5 TTS");
        return !cancelledRef.current;
      }

      if (cancelledRef.current) return false;

      // 4. Save locally (IndexedDB) + cloud (R2) — both non-blocking
      const clipId    = crypto.randomUUID();
      const now       = Date.now();
      const langPair  = `${detectedLang}_${tgt}`;
      const blobUrl   = trackBlob(URL.createObjectURL(wavBlob));

      const newClip: LiveClip = {
        id: clipId, langPair, srcLang: detectedLang, tgtLang: tgt,
        transcript, translation: translatedText,
        detectedLang: detectedLang !== src ? detectedLang : undefined,
        blobUrl, timestamp: now,
      };

      setClips((prev) => ({
        ...prev,
        [langPair]: [newClip, ...(prev[langPair] ?? [])],
      }));

      // IndexedDB save (local browser persistence)
      wavBlob.arrayBuffer().then((buf) => {
        const stored: StoredClip = {
          id: clipId, langPair, srcLang: detectedLang, tgtLang: tgt,
          transcript, translation: translatedText, timestamp: now,
          audioBuffer: buf,
        };
        return saveClipIDB(stored);
      }).catch(() => {});

      // Cloud save — fire-and-forget; update clip with cloudUrl when done
      if (isAuthenticated) {
        saveLiveTranslationClip(wavBlob, {
          srcLang: detectedLang, tgtLang: tgt, transcript,
          translation: translatedText, timestamp: now,
        }).then((result) => {
          // Update in-memory clip with cloud URL
          setClips((prev) => {
            const list = prev[langPair] ?? [];
            return {
              ...prev,
              [langPair]: list.map((c) =>
                c.id === clipId
                  ? { ...c, cloudUrl: result.cloud_url, localPath: result.local_path }
                  : c,
              ),
            };
          });
          // Update IndexedDB with cloud metadata
          if (result.cloud_url) {
            updateClipCloud(clipId, result.cloud_url, result.id, result.local_path ?? undefined);
          }
        }).catch(() => {});
      }

      // 5. Enqueue for live playback
      playQueueRef.current.push({ blob: wavBlob, id: chunkId });
      drainPlayQueue();
      if (isAuthenticated) refreshUsage();

      return true;
    } finally {
      setPipeState((s) => ({ ...s, processing: Math.max(0, s.processing - 1) }));
    }
  }, [drainPlayQueue, refreshUsage, isAuthenticated]);

  // ── Record one chunk ──────────────────────────────────────────────────────
  const recordChunk = useCallback((): { promise: Promise<Blob | null>; stop: () => void } => {
    const { promise, stop } = recordMic(CHUNK_MS, (ms) => setElapsed(ms), (lvl) => setLevel(lvl));
    const wrappedPromise = promise.catch((err: any) => {
      if (err?.quota) { notify.quotaExceeded(err.quota); }
      else {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.toLowerCase().includes("permission") || msg.toLowerCase().includes("notallowed")) notify.micDenied();
        else notify.error("Recording failed", msg);
      }
      return null;
    });
    return { promise: wrappedPromise as Promise<Blob | null>, stop };
  }, []);

  // ── Main loop ─────────────────────────────────────────────────────────────
  const start = useCallback(async () => {
    cancelledRef.current = false;
    chunkIdRef.current   = 0;
    playQueueRef.current = [];
    setRunning(true);
    setHistory([]);
    setChunkCount(0);
    proc.startProcessing(LIVE_STAGES);

    try {
      while (!cancelledRef.current) {
        setPipeState((s) => ({ ...s, recording: true }));
        setElapsed(0); setLevel(0);

        const chunkId = ++chunkIdRef.current;
        const { promise, stop } = recordChunk();
        stopRef.current = stop;

        const audioBlob = await promise;
        stopRef.current = null;
        setPipeState((s) => ({ ...s, recording: false }));
        if (!audioBlob || cancelledRef.current) break;

        setChunkCount((c) => c + 1);
        const src = srcLang;
        const tgt = tgtLang;
        processChunk(audioBlob, chunkId, src, tgt).catch(() => {});
        proc.nextStage(`Chunk ${chunkId} recorded, processing...`);
      }
    } finally {
      setRunning(false);
      setPipeState({ recording: false, processing: 0, playing: false });
      setLevel(0); setElapsed(0);
      proc.complete("Live translation stopped");
    }
  }, [srcLang, tgtLang, proc, recordChunk, processChunk]);

  const stop = useCallback(() => {
    cancelledRef.current = true;
    stopRef.current?.();
    audioRef.current?.pause();
    playQueueRef.current = [];
    proc.cancel();
    setRunning(false);
    setPipeState({ recording: false, processing: 0, playing: false });
    setLevel(0); setElapsed(0);
  }, [proc]);

  const statusParts: string[] = [];
  if (pipeState.recording) statusParts.push(`Recording ${(elapsed / 1000).toFixed(1)}s`);
  if (pipeState.processing > 0) statusParts.push(`Processing ${pipeState.processing} chunk${pipeState.processing > 1 ? "s" : ""}`);
  if (pipeState.playing)   statusParts.push("Playing");
  const statusText = statusParts.join(" · ") || "Starting...";

  const folderKeys = Object.keys(clips);

  return (
    <div className="vm-card">
      <div className="vm-card-header">
        <div className="vm-card-icon"><Radio size={18} strokeWidth={2} /></div>
        <div>
          <div className="vm-card-title">Live Voice Translation</div>
          <div className="vm-card-subtitle">faster-whisper (auto-detect) → Qwen → IndicF5 · {CHUNK_SEC}s chunks</div>
        </div>
        <UsageIndicator resource="both" />
      </div>

      {/* Language selectors */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <div className="vm-label">Speak in (hint)</div>
          <select className="vm-select" value={srcLang} onChange={(e) => setSrcLang(e.target.value)} disabled={running}>
            {Object.entries(LANG_NAMES).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <div className="vm-label">Output in</div>
          <select className="vm-select" value={tgtLang} onChange={(e) => setTgtLang(e.target.value)} disabled={running}>
            {Object.entries(LANG_NAMES).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
        </div>
      </div>

      {/* Mic level */}
      {running && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ height: 4, background: "var(--border-subtle)", borderRadius: 2, overflow: "hidden" }}>
            <div style={{
              height: "100%", width: `${level * 100}%`,
              background: level > 0.6 ? "var(--bamboo-500)" : "var(--bamboo-700)",
              transition: "width 0.1s ease", borderRadius: 2,
            }} />
          </div>
        </div>
      )}

      {/* Start / Stop */}
      {!running ? (
        <button className="vm-btn vm-btn-primary" style={{ width: "100%" }} onClick={start}>
          <Mic size={14} strokeWidth={2.5} /> Start Live Translation
        </button>
      ) : (
        <button className="vm-btn" style={{ width: "100%", border: "1px solid var(--bamboo-600)", color: "var(--bamboo-400)" }} onClick={stop}>
          <Square size={14} strokeWidth={2.5} /> Stop
        </button>
      )}

      {/* Pipeline status */}
      {running && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            {[
              { icon: <Mic size={12} />, active: pipeState.recording, label: pipeState.recording ? `${(elapsed / 1000).toFixed(1)}s` : "Idle" },
              { icon: <Radio size={12} />, active: pipeState.processing > 0, label: pipeState.processing > 0 ? `${pipeState.processing} in pipeline` : "Idle" },
              { icon: <Volume2 size={12} />, active: pipeState.playing, label: pipeState.playing ? "Playing" : "Idle" },
            ].map((p, i) => (
              <div key={i} style={{
                flex: 1, padding: "6px 10px", borderRadius: 6,
                border: `1px solid ${p.active ? "rgba(109,159,55,0.4)" : "var(--border-subtle)"}`,
                background: p.active ? "rgba(109,159,55,0.08)" : "transparent",
                fontSize: 11, color: p.active ? "var(--bamboo-400)" : "var(--gray-500)",
                display: "flex", alignItems: "center", gap: 6, transition: "all 0.2s",
              }}>
                {p.icon} <span>{p.label}</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: "var(--gray-400, #888)", textAlign: "center" }}>
            {statusText} · {chunkCount} chunk{chunkCount !== 1 ? "s" : ""} recorded
          </div>
        </div>
      )}

      {/* Live history (current session only) */}
      {history.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="vm-label">Live translations</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 220, overflowY: "auto" }}>
            {history.map((item) => (
              <div key={item.id} className="vm-fade-in" style={{
                padding: "8px 10px", background: "var(--surface-subtle)",
                borderRadius: 6, border: "1px solid var(--border-subtle)", fontSize: 13,
              }}>
                <div style={{ color: "var(--gray-400, #888)", marginBottom: 2, display: "flex", alignItems: "center", gap: 4 }}>
                  <MicOff size={10} />
                  <span style={{ fontSize: 10, color: "var(--gray-500)" }}>#{item.id}</span>
                  {item.detectedLang && (
                    <span style={{ fontSize: 10, color: "var(--bamboo-500)", marginLeft: 2 }}>
                      [{LANG_NAMES[item.detectedLang] ?? item.detectedLang} detected]
                    </span>
                  )}
                  {item.transcript}
                </div>
                <div style={{ color: "var(--bamboo-300, #c5e08a)" }}>{item.translation}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Collections — persisted across refreshes */}
      <div style={{ marginTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
          <span className="vm-label" style={{ flex: 1 }}>Collections</span>
          {isAuthenticated && (
            <button
              onClick={syncFromCloud}
              disabled={syncing}
              title="Sync clips from cloud (R2)"
              style={{
                background: "transparent", border: "1px solid var(--border-subtle)",
                borderRadius: 5, color: "var(--gray-400)", padding: "3px 8px",
                cursor: syncing ? "default" : "pointer",
                display: "flex", alignItems: "center", gap: 4, fontSize: 11,
                opacity: syncing ? 0.5 : 1,
              }}
            >
              <RefreshCw size={11} style={{ animation: syncing ? "spin 1s linear infinite" : "none" }} />
              {syncing ? "Syncing…" : "Sync from cloud"}
            </button>
          )}
        </div>

        {folderKeys.length === 0 ? (
          <div style={{
            padding: "16px 12px", borderRadius: 8,
            border: "1px dashed var(--border-subtle)",
            textAlign: "center",
          }}>
            <div style={{ fontSize: 12, color: "var(--gray-500)", marginBottom: 10 }}>
              No clips yet. Start a session to generate clips, or sync from cloud.
            </div>
            {isAuthenticated && (
              <button
                onClick={syncFromCloud}
                disabled={syncing}
                className="vm-btn"
                style={{ margin: "0 auto", display: "flex", alignItems: "center", gap: 6 }}
              >
                <RefreshCw size={13} style={{ animation: syncing ? "spin 1s linear infinite" : "none" }} />
                {syncing ? "Syncing…" : "Sync from Cloud"}
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {folderKeys.map((pair) => {
              const count = clips[pair].length;
              const hasCloud = clips[pair].some((c) => !!c.cloudUrl);
              return (
                <button
                  key={pair}
                  onClick={() => setOpenFolder(pair)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "9px 12px",
                    background: "var(--surface-subtle)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 8, cursor: "pointer", textAlign: "left",
                    color: "inherit", transition: "border-color 0.15s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--bamboo-600)")}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border-subtle)")}
                >
                  <FolderOpen size={14} style={{ color: "var(--bamboo-500)", flexShrink: 0 }} />
                  <span style={{ fontSize: 13, flex: 1, fontWeight: 500 }}>{langLabel(pair)}</span>
                  {hasCloud && <span style={{ fontSize: 10, color: "var(--gray-600)" }}>cloud</span>}
                  <span style={{ fontSize: 11, color: "var(--gray-500)" }}>
                    {count} clip{count !== 1 ? "s" : ""}
                  </span>
                  <ChevronRight size={13} style={{ color: "var(--gray-600)" }} />
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="vm-info" style={{ marginTop: 12 }}>
        faster-whisper auto-detects the spoken language. IndicF5 renders translations natively in the target
        language. Clips persist in browser storage — use "Sync from cloud" on a new device.
      </div>

      {/* Collection modal */}
      {openFolder && clips[openFolder] && (
        <CollectionModal langPair={openFolder} clips={clips[openFolder]} onClose={() => setOpenFolder(null)} />
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
