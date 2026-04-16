"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  Mic, Square, Upload, Trash2, Play, Pause,
  CheckCircle, Loader2, GraduationCap,
  Volume2, Clock, Globe,
} from "lucide-react";
import { notify } from "../lib/toast";
import { submitVoiceTraining } from "../lib/amt-api";
import { recordMic, decodeAudioBlob, trimToWav } from "../lib/audio-utils";
import { useAuth } from "../context/AuthContext";
import { useVoiceDispatch } from "../context/VoiceContext";
import { useInvalidateVoices } from "../hooks/useVoices";
import WaveformRangeSelector from "./WaveformRangeSelector";

interface AudioClip {
  id: string;
  blob: Blob;
  filename: string;
  durationSec: number;
  objectUrl: string;
  lang: string;
}



const genVoiceId = (name: string) => {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const uid = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `${slug}_${uid}`;
};
const MAX_CLIPS = 10;
const RECOMMENDED_TOTAL_SEC = 60;

const SUPPORTED_LANGS = [
  { code: "auto", label: "Auto-detect" },
  { code: "en",   label: "English" },
  { code: "hi",   label: "Hindi" },
  { code: "ta",   label: "Tamil" },
  { code: "te",   label: "Telugu" },
  { code: "kn",   label: "Kannada" },
  { code: "ml",   label: "Malayalam" },
  { code: "mr",   label: "Marathi" },
  { code: "bn",   label: "Bengali" },
  { code: "gu",   label: "Gujarati" },
  { code: "pa",   label: "Punjabi" },
  { code: "es",   label: "Spanish" },
  { code: "fr",   label: "French" },
  { code: "de",   label: "German" },
  { code: "pt",   label: "Portuguese" },
  { code: "ko",   label: "Korean" },
  { code: "ja",   label: "Japanese" },
  { code: "ar",   label: "Arabic" },
  { code: "zh",   label: "Chinese" },
];

function detectLangFromFilename(name: string): string {
  const lower = name.toLowerCase();
  if (/[\u0900-\u097F]/.test(name)) return "hi";
  if (/hindi|hi[-_]/.test(lower)) return "hi";
  if (/spanish|es[-_]/.test(lower)) return "es";
  if (/french|fr[-_]/.test(lower)) return "fr";
  if (/german|de[-_]/.test(lower)) return "de";
  return "en";
}

const fmtSec = (s: number) => s < 60 ? `${Math.round(s)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;

export default function VoiceTraining() {
  const { user, isAuthenticated } = useAuth();
  const { trainingStarted, trainingOptimistic, updateTrainingProgress, voiceTrained } = useVoiceDispatch();
  const invalidateVoices = useInvalidateVoices();
  const [mode, setMode]           = useState<"upload" | "record">("upload");
  const [clips, setClips]         = useState<AudioClip[]>([]);
  const [voiceName, setVoiceName] = useState("");
  const [language, setLanguage]   = useState("en");
  const [dragging, setDragging]   = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<"idle"|"uploading"|"polling"|"done"|"failed">("idle");
  const [pollMessage, setPollMessage]   = useState("");
  const [pollProgress, setPollProgress] = useState(0);
  const [doneVoiceName, setDoneVoiceName] = useState("");
  const [showProgressModal, setShowProgressModal] = useState(false);
  // Track individual training steps for progress modal
  const [stepsDone, setStepsDone] = useState<Set<string>>(new Set());
  const [recording, setRecording] = useState(false);
  const [recordSec, setRecordSec] = useState(0);
  // Pending clip — staged for waveform trimming before being added to clips list
  const [pendingBlob, setPendingBlob] = useState<Blob | null>(null);
  const [pendingFilename, setPendingFilename] = useState("");
  const [waveformSamples, setWaveformSamples] = useState<Float32Array | null>(null);
  const [waveformSampleRate, setWaveformSampleRate] = useState(16000);
  const [waveformDuration, setWaveformDuration] = useState(0);
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(0);
  const [waveformLoading, setWaveformLoading] = useState(false);

  const fileInputRef  = useRef<HTMLInputElement>(null);
  const audioRefs     = useRef<Record<string, HTMLAudioElement | null>>({});
  const recordingRef  = useRef<{ stop: () => void } | null>(null);
  const pollTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  const totalDurationSec = clips.reduce((s, c) => s + c.durationSec, 0);
  const progressPct      = Math.min(100, (totalDurationSec / RECOMMENDED_TOTAL_SEC) * 100);
  const canSubmit        = clips.length > 0 && voiceName.trim().length > 0 && !submitting;

  useEffect(() => () => { clips.forEach((c) => URL.revokeObjectURL(c.objectUrl)); }, []);

  const clearPending = () => {
    setPendingBlob(null);
    setPendingFilename("");
    setWaveformSamples(null);
    setWaveformDuration(0);
    setRangeStart(0);
    setRangeEnd(0);
  };

  const stagePendingBlob = async (blob: Blob, filename: string) => {
    setWaveformLoading(true);
    setPendingBlob(blob);
    setPendingFilename(filename);
    try {
      const decoded = await decodeAudioBlob(blob);
      setWaveformSamples(decoded.samples);
      setWaveformSampleRate(decoded.sampleRate);
      setWaveformDuration(decoded.duration);
      setRangeStart(0);
      setRangeEnd(decoded.duration);
    } catch {
      notify.error("Could not decode audio", "Try a different file format.");
      clearPending();
    } finally {
      setWaveformLoading(false);
    }
  };

  const confirmPending = async () => {
    if (!pendingBlob) return;
    const needsTrim = rangeEnd > rangeStart && (rangeStart > 0 || rangeEnd < waveformDuration);
    const finalBlob = needsTrim && waveformSamples
      ? trimToWav(waveformSamples, waveformSampleRate, rangeStart, rangeEnd)
      : pendingBlob;
    // Always send as .wav — trimToWav always produces WAV; for untrimmed non-WAV files,
    // convert via the decoded samples so the server always receives valid WAV.
    const finalWavBlob = needsTrim || pendingBlob.type === "audio/wav"
      ? finalBlob
      : waveformSamples
        ? trimToWav(waveformSamples, waveformSampleRate, 0, waveformDuration)
        : finalBlob;
    const baseName = pendingFilename.replace(/\.[^.]+$/, "");
    const finalFilename = `${baseName}.wav`;
    const objectUrl = URL.createObjectURL(finalWavBlob);
    let durationSec = 0;
    try { const d = await decodeAudioBlob(finalWavBlob); durationSec = d.duration; } catch {}
    setClips((prev) => [...prev, { id: crypto.randomUUID(), blob: finalWavBlob, filename: finalFilename, durationSec, objectUrl, lang: language }]);
    clearPending();
  };

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files);
    const remaining = MAX_CLIPS - clips.length;
    if (remaining <= 0) { notify.warning(`Maximum ${MAX_CLIPS} clips allowed.`); return; }
    // Single file: stage through waveform trimmer first
    if (arr.length === 1) {
      await stagePendingBlob(arr[0], arr[0].name);
      return;
    }
    // Multiple files: convert all to WAV before adding (server requires WAV)
    const newClips: AudioClip[] = [];
    for (const file of arr.slice(0, remaining)) {
      let wavBlob: Blob = file;
      let durationSec = 0;
      try {
        const decoded = await decodeAudioBlob(file);
        durationSec = decoded.duration;
        if (!file.type.includes("wav")) {
          wavBlob = trimToWav(decoded.samples, decoded.sampleRate, 0, decoded.duration);
        }
      } catch {}
      const baseName = file.name.replace(/\.[^.]+$/, "");
      const objectUrl = URL.createObjectURL(wavBlob);
      newClips.push({ id: crypto.randomUUID(), blob: wavBlob, filename: `${baseName}.wav`, durationSec, objectUrl, lang: detectLangFromFilename(file.name) });
    }
    setClips((prev) => [...prev, ...newClips]);
  }, [clips.length]);

  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); };
  const removeClip = (id: string) => { setClips((prev) => { const c = prev.find((x) => x.id === id); if (c) URL.revokeObjectURL(c.objectUrl); return prev.filter((x) => x.id !== id); }); };

  const togglePlay = (id: string) => {
    const audio = audioRefs.current[id];
    if (!audio) return;
    if (playingId === id) { audio.pause(); setPlayingId(null); }
    else {
      Object.entries(audioRefs.current).forEach(([oid, a]) => { if (oid !== id && a) a.pause(); });
      audio.play(); setPlayingId(id); audio.onended = () => setPlayingId(null);
    }
  };

  const startRecording = async () => {
    if (clips.length >= MAX_CLIPS) { notify.warning(`Maximum ${MAX_CLIPS} clips.`); return; }
    setRecording(true); setRecordSec(0);
    const ticker = setInterval(() => setRecordSec((s) => s + 1), 1000);
    const { promise, stop } = recordMic(60_000);
    recordingRef.current = { stop };
    try {
      const blob = await promise;
      clearInterval(ticker); setRecording(false); setRecordSec(0); recordingRef.current = null;
      await stagePendingBlob(blob, `Recording ${clips.length + 1}.wav`);
    } catch { clearInterval(ticker); setRecording(false); setRecordSec(0); recordingRef.current = null; notify.error("Recording failed. Check mic permissions."); }
  };

  const [trainingResult, setTrainingResult] = useState<{
    duration_sec?: number;
    engines_ready?: string[];
    rvc_uploaded?: boolean;
    r2_uploaded?: boolean;
    encoder_registered?: boolean;
  } | null>(null);

  const handleSubmit = async () => {
    if (!voiceName.trim() || clips.length === 0) return;
    setSubmitting(true); setSubmitStatus("uploading"); setPollProgress(0); setPollMessage("Uploading audio clips…");
    setStepsDone(new Set());
    const trimmedName = voiceName.trim();
    const voiceId = genVoiceId(trimmedName);
    const lang = language === "auto" ? "en" : language;

    // Immediately push into Voice Library as a "training" voice
    trainingOptimistic(voiceId, trimmedName, lang);
    trainingStarted(voiceId);

    let localSteps = new Set<string>();

    try {
      const result = await submitVoiceTraining(
        voiceId, trimmedName, lang,
        clips.map((c) => ({ blob: c.blob, filename: c.filename })),
        (evt) => {
          const pct = evt.progress ?? 0;
          const msg = evt.message || evt.status || "";
          const msgLower = msg.toLowerCase();

          // Update local modal state
          setPollProgress(pct);
          setPollMessage(msg);
          if (pct > 15) setSubmitStatus("polling");

          // Track step completions
          const next = new Set(localSteps);
          if (pct >= 20) next.add("audio");
          if (pct >= 90 || msgLower.includes("registered") || msgLower.includes("voice library")) next.add("encoder");
          if (evt.r2_uploaded === true || msgLower.includes("cloud backup complete")) next.add("r2");
          if (evt.status === "complete") { next.add("audio"); next.add("encoder"); next.add("r2"); next.add("done"); }
          localSteps = next;
          setStepsDone(next);

          // Push progress to Voice Library via context so the inline bar updates
          updateTrainingProgress(voiceId, pct, msg, next);
        },
      );
      setTrainingResult({
        duration_sec: result.duration_sec,
        engines_ready: result.engines_ready,
        rvc_uploaded: result.rvc_uploaded,
        r2_uploaded: result.r2_uploaded,
        encoder_registered: result.encoder_registered,
      });
      setSubmitStatus("done"); setDoneVoiceName(trimmedName);
      notify.success(`Voice "${trimmedName}" added to library — click Train to build voice model`);
      // Do NOT call voiceTrained() here — registration done ≠ RVC trained.
      // voiceTrained() fires from VoiceLibrary when the RVC training SSE returns "complete".
      invalidateVoices(); // trigger refetch so voice appears in library with "training" status
      setSubmitting(false);
    } catch (err) {
      setSubmitStatus("failed");
      notify.error(err instanceof Error ? err.message : "Submission failed.");
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    clips.forEach((c) => URL.revokeObjectURL(c.objectUrl));
    setClips([]); setVoiceName(""); setLanguage("en"); setSubmitStatus("idle");
    setPollProgress(0); setPollMessage(""); setDoneVoiceName(""); setSubmitting(false);
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
  };

  // ── Training steps for the progress modal ──────────────────────────────
  const TRAINING_STEPS = [
    { key: "audio",   label: "Audio processed" },
    { key: "encoder", label: "Voice registered" },
    { key: "r2",      label: "Cloud backup" },
    { key: "done",    label: "Ready — click Train to build voice model" },
  ];

  // ── Progress modal (clickable from progress bar) ───────────────────────
  const progressModal = showProgressModal && (submitStatus === "uploading" || submitStatus === "polling" || submitStatus === "done") ? (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.72)", backdropFilter: "blur(10px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={() => setShowProgressModal(false)}
    >
      <div
        style={{
          background: "var(--bg-secondary, #161b22)",
          border: "1px solid var(--border-primary, rgba(255,255,255,0.14))",
          borderRadius: 14, padding: "22px 24px", width: "100%", maxWidth: 400,
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary, #e8e8e8)" }}>Training Progress</div>
            {pollMessage && (
              <div style={{ fontSize: 11, color: "var(--text-secondary, rgba(232,232,232,0.6))", marginTop: 2 }}>{pollMessage}</div>
            )}
          </div>
          <button onClick={() => setShowProgressModal(false)} style={{ background: "none", border: "none", color: "var(--text-secondary, rgba(232,232,232,0.6))", cursor: "pointer", fontSize: 13, padding: "2px 6px" }}>Close</button>
        </div>

        {/* Overall bar */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
            <span style={{ fontSize: 11, color: "var(--text-secondary, rgba(232,232,232,0.6))" }}>Overall</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary, #e8e8e8)", fontVariantNumeric: "tabular-nums" }}>{pollProgress}%</span>
          </div>
          <div style={{ height: 5, borderRadius: 3, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pollProgress}%`, background: "#4ade80", borderRadius: 3, transition: "width 0.4s ease" }} />
          </div>
        </div>

        {/* Steps */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {TRAINING_STEPS.map((step) => {
            const done = stepsDone.has(step.key);
            return (
              <div key={step.key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {done
                  ? <span style={{ width: 18, height: 18, borderRadius: "50%", background: "rgba(74,222,128,0.18)", border: "1.5px solid #4ade80", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 10, color: "#4ade80" }}>✓</span>
                  : <span style={{ width: 18, height: 18, borderRadius: "50%", border: "1.5px solid rgba(255,255,255,0.2)", display: "inline-flex", flexShrink: 0 }} />
                }
                <span style={{ fontSize: 13, fontWeight: done ? 500 : 400, color: done ? "var(--text-primary, #e8e8e8)" : "var(--text-secondary, rgba(232,232,232,0.55))", transition: "color 0.3s" }}>
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Done banner */}
        {submitStatus === "done" && (
          <div style={{ marginTop: 16, padding: "10px 14px", borderRadius: 8, background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.25)", fontSize: 12, color: "#4ade80", textAlign: "center" }}>
            ✓ Voice training complete — ready for cloned TTS
          </div>
        )}
      </div>
    </div>
  ) : null;

  // ── Training in progress state ────────────────────────────────────────────
  if (submitStatus === "uploading" || submitStatus === "polling") {
    return (
      <div className="vm-card vt-card" style={{ height: "100%" }}>
        <div className="vt-done-state">
          <div className="vt-done-ring" style={{ color: "#fbbf24", border: "1.5px solid rgba(251,191,36,0.25)" }}>
            <Loader2 size={28} strokeWidth={2} className="vt-spin" />
          </div>
          <h3 className="vt-done-title">Training &ldquo;{voiceName.trim()}&rdquo;</h3>
          <p className="vt-done-sub">
            {pollMessage || "Processing audio clips…"}
            {pollProgress > 0 && <span style={{ marginLeft: 6, opacity: 0.5 }}>{pollProgress}%</span>}
          </p>
          <p style={{ fontSize: 11, color: "var(--text-faint,rgba(255,255,255,0.25))", marginTop: 8 }}>
            Track progress in Voice Library
          </p>
        </div>
        {progressModal}
        <STYLES />
      </div>
    );
  }

  // ── Done state ────────────────────────────────────────────────────────────
  if (submitStatus === "done") {
    return (
      <div className="vm-card vt-card" style={{ height: "100%" }}>
        <div className="vt-done-state">
          <div className="vt-done-ring">
            <CheckCircle size={32} strokeWidth={2} />
          </div>
          <h3 className="vt-done-title">&ldquo;{doneVoiceName}&rdquo; is ready</h3>
          <p className="vt-done-sub">Your voice profile is live in the Voice Library.</p>
          <button className="vt-submit-btn" onClick={handleReset} style={{ marginTop: 20, opacity: 0.85 }}>
            Train another voice
          </button>
        </div>
        {progressModal}
        <STYLES />
      </div>
    );
  }

  return (
    <div className="vm-card vt-card">
      {/* ── Header ── */}
      <div className="vt-header">
        <div className="vt-header-icon">
          <GraduationCap size={17} strokeWidth={2} />
        </div>
        <div>
          <div className="vt-title">Train Your Voice</div>
          <div className="vt-subtitle">Upload clips or record to create a reusable voice profile</div>
        </div>
      </div>

      {/* ── Mode toggle ── */}
      <div className="vt-mode-toggle">
        <div className="vt-mode-pill" style={{ left: mode === "upload" ? 3 : "calc(50% + 1px)" }} />
        <button className={`vt-mode-btn${mode === "upload" ? " vt-mode-btn--active" : ""}`} onClick={() => setMode("upload")}>
          <Upload size={13} strokeWidth={2} /> Upload Files
        </button>
        <button className={`vt-mode-btn${mode === "record" ? " vt-mode-btn--active" : ""}`} onClick={() => setMode("record")}>
          <Mic size={13} strokeWidth={2} /> Record Clips
        </button>
      </div>

      {/* ── Upload zone ── */}
      {mode === "upload" && (
        <div
          className={`vt-drop-zone${dragging ? " vt-drop-zone--active" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="vt-drop-icon-wrap">
            <Upload size={22} strokeWidth={1.5} />
          </div>
          <p className="vt-drop-title">
            {dragging ? "Release to add clips" : "Drop audio files here"}
          </p>
          <p className="vt-drop-hint">WAV · MP3 · M4A · OGG · WebM &nbsp;·&nbsp; up to {MAX_CLIPS} clips</p>
          {clips.length > 0 && (
            <div className="vt-clip-badge">
              <Volume2 size={10} /> {clips.length} clip{clips.length !== 1 ? "s" : ""} added
            </div>
          )}
          <input ref={fileInputRef} type="file" multiple accept=".wav,.mp3,.m4a,.ogg,.webm,audio/*" style={{ display: "none" }} onChange={(e) => e.target.files && addFiles(e.target.files)} />
        </div>
      )}

      {/* ── Record zone ── */}
      {mode === "record" && (
        <div className="vt-record-zone">
          {recording ? (
            <div className="vt-recording-active">
              <div className="vt-mic-ring vt-mic-ring--recording">
                <div className="vt-rec-dot" />
              </div>
              <div className="vt-rec-label">
                <span className="vt-rec-time">{fmtSec(recordSec)}</span>
                <span className="vt-rec-hint">Recording — click to stop</span>
              </div>
              <button className="vt-stop-btn" onClick={() => recordingRef.current?.stop()}>
                <Square size={12} strokeWidth={2.5} /> Stop
              </button>
            </div>
          ) : (
            <div className="vt-record-idle">
              <button className="vt-mic-ring vt-mic-ring--idle" onClick={startRecording} disabled={clips.length >= MAX_CLIPS}>
                <Mic size={20} strokeWidth={1.5} />
              </button>
              <div>
                <p className="vt-rec-cta">Click to record clip {clips.length + 1}</p>
                <p className="vt-rec-hint-sub">{clips.length}/{MAX_CLIPS} clips · max 60s each</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Waveform trimmer — shows after single upload or recording ── */}
      {waveformLoading && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--gray-400)", margin: "12px 0" }}>
          <div className="vm-spinner" style={{ width: 12, height: 12 }} />
          Decoding audio…
        </div>
      )}
      {!waveformLoading && pendingBlob && waveformSamples && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: "var(--gray-400)", marginBottom: 6 }}>
            Trim audio — drag handles to select range
          </div>
          <WaveformRangeSelector
            samples={waveformSamples}
            sampleRate={waveformSampleRate}
            duration={waveformDuration}
            onRangeChange={(start, end) => { setRangeStart(start); setRangeEnd(end); }}
            minRangeSec={1}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button
              className="vm-btn vm-btn-primary vm-btn-sm"
              style={{ flex: 1 }}
              onClick={confirmPending}
            >
              {rangeStart > 0 || rangeEnd < waveformDuration
                ? `Add trimmed clip (${rangeStart.toFixed(1)}s – ${rangeEnd.toFixed(1)}s)`
                : "Add full clip"}
            </button>
            <button className="vm-btn vm-btn-sm" onClick={clearPending}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Clips list ── */}
      {clips.length > 0 && (
        <div className="vt-clips-list">
          {clips.map((clip, i) => (
            <div key={clip.id} className="vt-clip-row">
              <button className={`vt-play-btn${playingId === clip.id ? " vt-play-btn--active" : ""}`} onClick={() => togglePlay(clip.id)}>
                {playingId === clip.id ? <Pause size={11} strokeWidth={2.5} /> : <Play size={11} strokeWidth={2.5} />}
              </button>
              <div className="vt-clip-meta">
                <span className="vt-clip-idx">#{i + 1}</span>
                <span className="vt-clip-name" title={clip.filename}>{clip.filename}</span>
                {clip.durationSec > 0 && (
                  <span className="vt-clip-dur"><Clock size={9} />{fmtSec(clip.durationSec)}</span>
                )}
              </div>
              <select className="vt-lang-pill" value={clip.lang} onChange={(e) => setClips((prev) => prev.map((c) => c.id === clip.id ? { ...c, lang: e.target.value } : c))}>
                {SUPPORTED_LANGS.filter((l) => l.code !== "auto").map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
              <button className="vt-remove-btn" onClick={() => removeClip(clip.id)} title="Remove">
                <Trash2 size={12} strokeWidth={2} />
              </button>
              <audio ref={(el) => { audioRefs.current[clip.id] = el; }} src={clip.objectUrl} preload="metadata" style={{ display: "none" }} />
            </div>
          ))}
        </div>
      )}

      {/* ── Duration progress ── */}
      {clips.length > 0 && (
        <div className="vt-progress-section">
          <div className="vt-progress-labels">
            <span><Volume2 size={10} /> {fmtSec(totalDurationSec)} recorded</span>
            <span style={{ color: progressPct >= 100 ? "var(--bamboo-400)" : undefined }}>
              {progressPct >= 100 ? "✓ Recommended length reached" : `${fmtSec(RECOMMENDED_TOTAL_SEC)} recommended`}
            </span>
          </div>
          <div className="vt-bar-track">
            <div className="vt-bar-fill" style={{ width: `${progressPct}%`, background: progressPct >= 100 ? "linear-gradient(90deg,#6db94a,#a3c96e)" : "linear-gradient(90deg,#4a7a28,#6db94a)" }} />
          </div>
        </div>
      )}

      {/* ── Info tip ── */}
      <div className="vt-tip">
        <span className="vt-tip-dot" />
        <span>For best results, upload 3–10 clips of 5–30 seconds each in a quiet environment.</span>
      </div>

      {/* ── Name + language ── */}
      <div className="vt-form-row">
        <div className="vt-input-wrap" style={{ flex: 1 }}>
          <input
            className="vt-name-input"
            placeholder="Voice profile name (required)"
            value={voiceName}
            onChange={(e) => setVoiceName(e.target.value)}
            maxLength={64}
          />
        </div>
        <div className="vt-select-wrap">
          <Globe size={12} className="vt-select-icon" />
          <select className="vt-lang-select-main" value={language} onChange={(e) => setLanguage(e.target.value)}>
            {SUPPORTED_LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </div>
      </div>

      {/* ── Submit ── */}
      <button className="vt-submit-btn" onClick={handleSubmit} disabled={!canSubmit}>
        {submitting ? (
          <>
            <Loader2 size={14} className="vt-spin" />
            {pollMessage || (submitStatus === "uploading" ? "Uploading…" : `Training… ${pollProgress}%`)}
          </>
        ) : (
          <>
            Create Voice Profile
          </>
        )}
      </button>

      {submitStatus === "failed" && (
        <div className="vt-error-row">
          Submission failed.{" "}
          <button className="vt-retry-btn" onClick={handleReset}>Try again</button>
        </div>
      )}

      {progressModal}
      <STYLES />
    </div>
  );
}

function STYLES() {
  return (
    <style>{`
      /* ── Card shell ─────────────────────────────────────────────────────── */
      .vt-card { padding: 20px; display: flex; flex-direction: column; }
      .vt-card--centered { justify-content: center; align-items: center; flex: 1; min-height: 0; }

      /* ── Header ─────────────────────────────────────────────────────────── */
      .vt-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 18px;
      }
      .vt-header-icon {
        width: 34px; height: 34px;
        border-radius: 10px;
        display: flex; align-items: center; justify-content: center;
        background: rgba(109,159,55,0.12);
        border: 1px solid rgba(109,159,55,0.22);
        color: var(--bamboo-400, #a3c96e);
        flex-shrink: 0;
      }
      .vt-title { font-size: 14px; font-weight: 600; color: var(--text-primary, #e8e8e8); letter-spacing: -0.01em; }
      .vt-subtitle { font-size: 11px; color: var(--text-muted); margin-top: 1px; }

      /* ── Mode toggle ─────────────────────────────────────────────────────── */
      .vt-mode-toggle {
        position: relative;
        display: flex;
        background: var(--surface-subtle);
        border: 1px solid var(--border-subtle);
        border-radius: 10px;
        padding: 3px;
        margin-bottom: 14px;
        gap: 2px;
      }
      .vt-mode-pill {
        position: absolute;
        top: 3px; bottom: 3px;
        width: calc(50% - 4px);
        background: rgba(109,159,55,0.18);
        border: 1px solid rgba(109,159,55,0.3);
        border-radius: 7px;
        transition: left 0.22s cubic-bezier(0.4,0,0.2,1);
        pointer-events: none;
      }
      .vt-mode-btn {
        position: relative;
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 8px 0;
        font-size: 12px;
        font-weight: 500;
        border: none;
        background: transparent;
        cursor: pointer;
        border-radius: 7px;
        color: var(--text-muted);
        transition: color 0.18s;
        letter-spacing: 0.01em;
        z-index: 1;
      }
      .vt-mode-btn--active { color: var(--bamboo-300, #c5e08a); }

      /* ── Drop zone ───────────────────────────────────────────────────────── */
      .vt-drop-zone {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        padding: 28px 20px;
        border: 1.5px dashed rgba(109,159,55,0.25);
        border-radius: 12px;
        cursor: pointer;
        transition: border-color 0.2s, background 0.2s;
        background: rgba(109,159,55,0.02);
        margin-bottom: 12px;
        text-align: center;
      }
      .vt-drop-zone:hover,
      .vt-drop-zone--active {
        border-color: rgba(109,159,55,0.55);
        background: rgba(109,159,55,0.06);
      }
      .vt-drop-icon-wrap {
        width: 44px; height: 44px;
        border-radius: 12px;
        background: rgba(109,159,55,0.1);
        border: 1px solid rgba(109,159,55,0.2);
        display: flex; align-items: center; justify-content: center;
        color: var(--bamboo-400, #a3c96e);
        margin-bottom: 4px;
      }
      .vt-drop-title {
        font-size: 13px;
        font-weight: 500;
        color: var(--text-secondary);
        margin: 0;
      }
      .vt-drop-hint {
        font-size: 11px;
        color: var(--text-faint);
        margin: 0;
      }
      .vt-clip-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        margin-top: 6px;
        padding: 3px 10px;
        border-radius: 20px;
        background: rgba(109,159,55,0.15);
        border: 1px solid rgba(109,159,55,0.3);
        font-size: 11px;
        font-weight: 500;
        color: var(--bamboo-400, #a3c96e);
        letter-spacing: 0.02em;
      }

      /* ── Record zone ─────────────────────────────────────────────────────── */
      .vt-record-zone {
        border: 1px solid var(--border-subtle);
        border-radius: 12px;
        padding: 18px;
        margin-bottom: 12px;
        background: rgba(0,0,0,0.12);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .vt-record-idle {
        display: flex;
        align-items: center;
        gap: 16px;
      }
      .vt-recording-active {
        display: flex;
        align-items: center;
        gap: 14px;
        width: 100%;
      }
      .vt-mic-ring--idle {
        width: 52px; height: 52px;
        border-radius: 50%;
        border: 1.5px solid rgba(109,159,55,0.4);
        background: rgba(109,159,55,0.08);
        color: var(--bamboo-400, #a3c96e);
        cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        transition: background 0.2s, transform 0.15s, border-color 0.2s;
        flex-shrink: 0;
      }
      .vt-mic-ring--idle:hover:not(:disabled) {
        background: rgba(109,159,55,0.18);
        border-color: rgba(109,159,55,0.7);
        transform: scale(1.06);
      }
      .vt-mic-ring--idle:disabled { opacity: 0.35; cursor: default; }
      .vt-mic-ring--recording {
        width: 42px; height: 42px;
        border-radius: 50%;
        border: 2px solid rgba(248,113,113,0.5);
        background: rgba(239,68,68,0.1);
        display: flex; align-items: center; justify-content: center;
        animation: vt-ring-pulse 1.4s ease-in-out infinite;
        flex-shrink: 0;
      }
      @keyframes vt-ring-pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.3); }
        50% { box-shadow: 0 0 0 8px rgba(239,68,68,0); }
      }
      .vt-rec-dot {
        width: 12px; height: 12px;
        border-radius: 50%;
        background: #f87171;
        animation: vt-dot-pulse 1s ease-in-out infinite;
      }
      @keyframes vt-dot-pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.6; transform: scale(0.85); }
      }
      .vt-rec-label { flex: 1; }
      .vt-rec-time { display: block; font-size: 20px; font-weight: 600; color: #f87171; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
      .vt-rec-hint { font-size: 11px; color: var(--text-faint); }
      .vt-rec-cta { font-size: 13px; font-weight: 500; color: var(--text-secondary); margin: 0 0 2px; }
      .vt-rec-hint-sub { font-size: 11px; color: var(--text-faint); margin: 0; }
      .vt-stop-btn {
        display: flex; align-items: center; gap: 5px;
        padding: 6px 14px;
        border-radius: 8px;
        border: 1px solid rgba(248,113,113,0.3);
        background: rgba(239,68,68,0.08);
        color: #f87171;
        font-size: 12px; font-weight: 500;
        cursor: pointer;
        transition: background 0.15s;
      }
      .vt-stop-btn:hover { background: rgba(239,68,68,0.16); }

      /* ── Clips list ───────────────────────────────────────────────────────── */
      .vt-clips-list {
        display: flex;
        flex-direction: column;
        gap: 5px;
        margin-bottom: 12px;
        max-height: 230px;
        overflow-y: auto;
        padding-right: 2px;
      }
      .vt-clips-list::-webkit-scrollbar { width: 3px; }
      .vt-clips-list::-webkit-scrollbar-track { background: transparent; }
      .vt-clips-list::-webkit-scrollbar-thumb { background: var(--border-subtle); border-radius: 2px; }

      .vt-clip-row {
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 7px 10px;
        border-radius: 9px;
        border: 1px solid var(--border-subtle);
        background: var(--surface-subtle);
        transition: background 0.15s, border-color 0.15s;
      }
      .vt-clip-row:hover {
        background: var(--surface-hover);
        border-color: rgba(109,159,55,0.2);
      }
      .vt-play-btn {
        width: 26px; height: 26px;
        border-radius: 50%;
        border: 1px solid var(--border-subtle);
        background: transparent;
        color: var(--text-muted);
        cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0;
        transition: background 0.15s, color 0.15s, border-color 0.15s;
      }
      .vt-play-btn:hover { background: rgba(109,159,55,0.12); color: var(--bamboo-400); border-color: rgba(109,159,55,0.3); }
      .vt-play-btn--active { background: rgba(109,159,55,0.18); color: var(--bamboo-400); border-color: rgba(109,159,55,0.4); }

      .vt-clip-meta {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 7px;
        min-width: 0;
        overflow: hidden;
      }
      .vt-clip-idx { font-size: 10px; font-weight: 600; color: var(--text-faint); flex-shrink: 0; font-variant-numeric: tabular-nums; }
      .vt-clip-name {
        font-size: 12px;
        color: var(--text-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .vt-clip-dur {
        display: inline-flex; align-items: center; gap: 3px;
        font-size: 10px;
        color: var(--text-faint);
        flex-shrink: 0;
        font-variant-numeric: tabular-nums;
      }
      .vt-lang-pill {
        background: var(--surface-hover);
        border: 1px solid var(--border-subtle);
        border-radius: 6px;
        color: var(--text-muted);
        font-size: 11px;
        padding: 3px 6px;
        cursor: pointer;
        flex-shrink: 0;
        outline: none;
      }
      .vt-remove-btn {
        background: transparent;
        border: none;
        color: var(--text-faint);
        cursor: pointer;
        padding: 4px;
        border-radius: 5px;
        display: flex; align-items: center;
        transition: color 0.15s, background 0.15s;
        flex-shrink: 0;
      }
      .vt-remove-btn:hover { color: #f87171; background: rgba(239,68,68,0.1); }

      /* ── Duration progress ───────────────────────────────────────────────── */
      .vt-progress-section { margin-bottom: 12px; }
      .vt-progress-labels {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 11px;
        color: var(--text-faint);
        margin-bottom: 6px;
        gap: 8px;
      }
      .vt-progress-labels span { display: flex; align-items: center; gap: 4px; }
      .vt-bar-track {
        height: 5px;
        background: var(--surface-subtle);
        border-radius: 3px;
        overflow: hidden;
      }
      .vt-bar-fill {
        height: 100%;
        border-radius: 3px;
        transition: width 0.4s ease, background 0.3s;
      }
      .vt-bar-fill--animated { background: linear-gradient(90deg, var(--bamboo-600,#4a7a28), var(--bamboo-400,#a3c96e)); transition: width 0.5s ease; }

      /* ── Tip ─────────────────────────────────────────────────────────────── */
      .vt-tip {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 10px 13px;
        border-radius: 9px;
        background: rgba(109,159,55,0.05);
        border: 1px solid rgba(109,159,55,0.12);
        font-size: 11.5px;
        color: var(--text-faint);
        line-height: 1.55;
        margin-bottom: 14px;
      }
      .vt-tip-dot {
        width: 5px; height: 5px;
        border-radius: 50%;
        background: var(--bamboo-500, #6db94a);
        flex-shrink: 0;
        margin-top: 5px;
      }

      /* ── Form row ────────────────────────────────────────────────────────── */
      .vt-form-row { display: flex; gap: 8px; margin-bottom: 10px; }
      .vt-input-wrap { position: relative; }
      .vt-name-input {
        width: 100%;
        background: var(--surface-subtle);
        border: 1px solid var(--border-subtle);
        border-radius: 9px;
        padding: 9px 13px;
        font-size: 13px;
        color: var(--text-primary);
        outline: none;
        transition: border-color 0.15s, background 0.15s;
        box-sizing: border-box;
      }
      .vt-name-input::placeholder { color: var(--text-faint); }
      .vt-name-input:focus { border-color: rgba(109,159,55,0.5); background: rgba(109,159,55,0.04); }

      .vt-select-wrap { position: relative; display: flex; align-items: center; }
      .vt-select-icon { position: absolute; left: 10px; color: var(--text-faint); pointer-events: none; }
      .vt-lang-select-main {
        background: var(--surface-subtle);
        border: 1px solid var(--border-subtle);
        border-radius: 9px;
        padding: 9px 10px 9px 28px;
        font-size: 12px;
        color: var(--text-secondary);
        cursor: pointer;
        outline: none;
        white-space: nowrap;
        transition: border-color 0.15s;
      }
      .vt-lang-select-main:focus { border-color: rgba(109,159,55,0.5); }

      /* ── Submit button ───────────────────────────────────────────────────── */
      .vt-submit-btn {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        padding: 11px 0;
        border-radius: 10px;
        border: none;
        background: linear-gradient(135deg, #4a7a28 0%, #6db94a 60%, #a3c96e 100%);
        color: var(--text-primary);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        letter-spacing: 0.01em;
        transition: opacity 0.15s, transform 0.12s, box-shadow 0.2s;
        box-shadow: 0 2px 16px rgba(109,159,55,0.25);
      }
      .vt-submit-btn:hover:not(:disabled) {
        opacity: 0.92;
        transform: translateY(-1px);
        box-shadow: 0 4px 22px rgba(109,159,55,0.38);
      }
      .vt-submit-btn:active:not(:disabled) { transform: translateY(0); }
      .vt-submit-btn:disabled {
        background: var(--surface-subtle);
        color: var(--text-faint);
        cursor: default;
        box-shadow: none;
      }

      /* ── Poll card ───────────────────────────────────────────────────────── */
      .vt-poll-card {
        margin-top: 10px;
        padding: 12px 14px;
        border-radius: 9px;
        border: 1px solid rgba(109,159,55,0.18);
        background: rgba(109,159,55,0.04);
      }
      .vt-poll-label { font-size: 11.5px; color: var(--text-muted); text-align: center; margin: 7px 0 0; }

      /* ── Error / retry ───────────────────────────────────────────────────── */
      .vt-error-row { font-size: 12px; color: #f87171; text-align: center; margin-top: 10px; }
      .vt-retry-btn { background: none; border: none; color: var(--bamboo-400,#a3c96e); cursor: pointer; font-size: 12px; text-decoration: underline; }

      /* ── Done state ──────────────────────────────────────────────────────── */
      .vt-done-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        flex: 1;
        padding: 0;
        text-align: center;
      }
      .vt-done-ring {
        width: 62px; height: 62px;
        border-radius: 50%;
        background: rgba(109,159,55,0.12);
        border: 1.5px solid rgba(109,159,55,0.35);
        display: flex; align-items: center; justify-content: center;
        color: var(--bamboo-400, #a3c96e);
        margin-bottom: 16px;
      }
      .vt-done-title { font-size: 15px; font-weight: 600; color: var(--text-primary); margin: 0 0 6px; }
      .vt-done-sub { font-size: 12px; color: var(--text-faint); margin: 0; }

      /* ── Spinner ─────────────────────────────────────────────────────────── */
      .vt-spin { animation: vt-spin-anim 0.9s linear infinite; }
      @keyframes vt-spin-anim { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    `}</style>
  );
}
