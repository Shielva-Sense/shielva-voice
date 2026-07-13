"use client";

import { useState, useRef, useEffect, useId } from "react";
import { Mic, Square, Upload, Trash2, Play, Pause, Sparkles, Globe, Clock, ShieldCheck } from "lucide-react";
import { notify } from "../lib/toast";
import { enrollVoice } from "../lib/amt-api";
import { recordMic, decodeAudioBlob, trimToWav } from "../lib/audio-utils";
import { useInvalidateVoices, useUpsertVoice } from "../hooks/useVoices";

interface Clip {
  blob: Blob;
  filename: string;
  durationSec: number;
  objectUrl: string;
}

const genVoiceId = (name: string): string => {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const uid = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `${slug || "voice"}_${uid}`;
};

const MAX_RECORD_MS = 20_000; // ~10s recommended, 20s hard cap

const SUPPORTED_LANGS = [
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "kn", label: "Kannada" },
  { code: "ml", label: "Malayalam" },
  { code: "mr", label: "Marathi" },
  { code: "bn", label: "Bengali" },
  { code: "gu", label: "Gujarati" },
  { code: "pa", label: "Punjabi" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "ko", label: "Korean" },
  { code: "ja", label: "Japanese" },
  { code: "ar", label: "Arabic" },
  { code: "zh", label: "Chinese" },
] as const;

const fmtSec = (s: number): string => (s < 60 ? `${Math.round(s)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`);

export default function VoiceTraining() {
  const invalidateVoices = useInvalidateVoices();
  const upsertVoice = useUpsertVoice();

  const nameId = useId();
  const langId = useId();
  const transcriptId = useId();
  const consentId = useId();

  const [mode, setMode] = useState<"upload" | "record">("record");
  const [clip, setClip] = useState<Clip | null>(null);
  const [voiceName, setVoiceName] = useState("");
  const [language, setLanguage] = useState("en");
  const [refText, setRefText] = useState("");
  const [consent, setConsent] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSec, setRecordSec] = useState(0);
  const [decoding, setDecoding] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recordingRef = useRef<{ stop: () => void } | null>(null);

  // Revoke the object URL when the clip changes or the component unmounts.
  useEffect(() => {
    return () => { if (clip) URL.revokeObjectURL(clip.objectUrl); };
  }, [clip]);

  const canSubmit = !!clip && voiceName.trim().length > 0 && consent && !submitting;

  const setClipFromBlob = async (raw: Blob, filename: string) => {
    setDecoding(true);
    try {
      // Always normalise to 16 kHz mono WAV — the backend concatenates clips.
      const decoded = await decodeAudioBlob(raw);
      const wavBlob = trimToWav(decoded.samples, decoded.sampleRate, 0, decoded.duration);
      const objectUrl = URL.createObjectURL(wavBlob);
      setClip((prev) => {
        if (prev) URL.revokeObjectURL(prev.objectUrl);
        return { blob: wavBlob, filename: `${filename.replace(/\.[^.]+$/, "")}.wav`, durationSec: decoded.duration, objectUrl };
      });
    } catch {
      notify.error("Could not read audio", "Try a different file or record instead.");
    } finally {
      setDecoding(false);
    }
  };

  const addFile = async (files: FileList | File[]) => {
    const file = Array.from(files)[0];
    if (file) await setClipFromBlob(file, file.name);
  };

  const removeClip = () => {
    if (audioRef.current) { audioRef.current.pause(); }
    setPlaying(false);
    setClip((prev) => { if (prev) URL.revokeObjectURL(prev.objectUrl); return null; });
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) { audio.pause(); setPlaying(false); }
    else { audio.play().catch(() => setPlaying(false)); setPlaying(true); }
  };

  const startRecording = async () => {
    setRecording(true);
    setRecordSec(0);
    const ticker = setInterval(() => setRecordSec((s) => s + 1), 1000);
    const { promise, stop } = recordMic(MAX_RECORD_MS);
    recordingRef.current = { stop };
    try {
      const blob = await promise;
      clearInterval(ticker);
      setRecording(false);
      setRecordSec(0);
      recordingRef.current = null;
      await setClipFromBlob(blob, "Recording.wav");
    } catch {
      clearInterval(ticker);
      setRecording(false);
      setRecordSec(0);
      recordingRef.current = null;
      notify.micDenied();
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit || !clip) return;
    setSubmitting(true);
    const trimmedName = voiceName.trim();
    const voiceId = genVoiceId(trimmedName);
    try {
      const voice = await enrollVoice({
        voiceId,
        name: trimmedName,
        language,
        refText: refText.trim() || undefined,
        clips: [clip.blob],
      });
      upsertVoice({
        ...voice,
        voice_id: voice.voice_id || voiceId,
        name: voice.name || trimmedName,
        language: voice.language || language,
      });
      invalidateVoices();
      notify.success(`Voice "${trimmedName}" cloned`, "Ready to use in Text to Speech.");
      // Reset the form for the next voice.
      removeClip();
      setVoiceName("");
      setRefText("");
      setConsent(false);
    } catch (err) {
      const quota = (err as { quota?: unknown })?.quota;
      if (quota) notify.quotaExceeded(quota as Parameters<typeof notify.quotaExceeded>[0]);
      else notify.error("Cloning failed", err instanceof Error ? err.message : "Could not enroll the voice.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="vm-card vt-card">
      {/* Header */}
      <div className="vt-header">
        <div className="vt-header-icon">
          <Sparkles size={17} strokeWidth={2} />
        </div>
        <div>
          <div className="vt-title">Clone a voice</div>
          <div className="vt-subtitle">Clone your voice from a ~10-second sample — no training, ready immediately.</div>
        </div>
      </div>

      {/* Mode toggle */}
      <div className="vt-mode-toggle" role="tablist" aria-label="Sample source">
        <div className="vt-mode-pill" style={{ left: mode === "record" ? 3 : "calc(50% + 1px)" }} />
        <button
          type="button"
          role="tab"
          aria-selected={mode === "record"}
          className={`vt-mode-btn${mode === "record" ? " vt-mode-btn--active" : ""}`}
          onClick={() => setMode("record")}
        >
          <Mic size={13} strokeWidth={2} /> Record
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "upload"}
          className={`vt-mode-btn${mode === "upload" ? " vt-mode-btn--active" : ""}`}
          onClick={() => setMode("upload")}
        >
          <Upload size={13} strokeWidth={2} /> Upload
        </button>
      </div>

      {/* Capture zone — hidden once a clip is staged */}
      {!clip && mode === "upload" && (
        <div
          className={`vt-drop-zone${dragging ? " vt-drop-zone--active" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) addFile(e.dataTransfer.files); }}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="vt-drop-icon-wrap">
            <Upload size={22} strokeWidth={1.5} />
          </div>
          <p className="vt-drop-title">{dragging ? "Release to add clip" : "Drop an audio clip here"}</p>
          <p className="vt-drop-hint">WAV · MP3 · M4A · OGG · WebM &nbsp;·&nbsp; ~10 seconds</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".wav,.mp3,.m4a,.ogg,.webm,audio/*"
            aria-label="Upload a voice sample"
            style={{ display: "none" }}
            onChange={(e) => e.target.files && addFile(e.target.files)}
          />
        </div>
      )}

      {!clip && mode === "record" && (
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
              <button type="button" className="vt-stop-btn" onClick={() => recordingRef.current?.stop()}>
                <Square size={12} strokeWidth={2.5} /> Stop
              </button>
            </div>
          ) : (
            <div className="vt-record-idle">
              <button type="button" className="vt-mic-ring vt-mic-ring--idle" onClick={startRecording} aria-label="Start recording a voice sample">
                <Mic size={20} strokeWidth={1.5} />
              </button>
              <div>
                <p className="vt-rec-cta">Click to record your sample</p>
                <p className="vt-rec-hint-sub">Speak naturally for ~10 seconds in a quiet room</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Decoding indicator */}
      {decoding && (
        <div className="vt-decoding">
          <div className="vm-spinner" style={{ width: 12, height: 12 }} />
          Processing audio…
        </div>
      )}

      {/* Staged clip */}
      {clip && (
        <div className="vt-clip-row">
          <button
            type="button"
            className={`vt-play-btn${playing ? " vt-play-btn--active" : ""}`}
            onClick={togglePlay}
            aria-label={playing ? "Pause sample" : "Play sample"}
          >
            {playing ? <Pause size={12} strokeWidth={2.5} /> : <Play size={12} strokeWidth={2.5} />}
          </button>
          <div className="vt-clip-meta">
            <span className="vt-clip-name" title={clip.filename}>{clip.filename}</span>
            {clip.durationSec > 0 && (
              <span className="vt-clip-dur"><Clock size={9} />{fmtSec(clip.durationSec)}</span>
            )}
          </div>
          <button type="button" className="vt-remove-btn" onClick={removeClip} aria-label="Remove clip" title="Remove clip">
            <Trash2 size={13} strokeWidth={2} />
          </button>
          <audio
            ref={audioRef}
            src={clip.objectUrl}
            preload="metadata"
            onEnded={() => setPlaying(false)}
            style={{ display: "none" }}
          />
        </div>
      )}

      {/* Name + language */}
      <div className="vt-form-row">
        <div className="vt-input-wrap" style={{ flex: 1 }}>
          <label htmlFor={nameId} className="vm-visually-hidden">Voice name</label>
          <input
            id={nameId}
            className="vt-name-input"
            placeholder="Voice name (required)"
            value={voiceName}
            onChange={(e) => setVoiceName(e.target.value)}
            maxLength={64}
          />
        </div>
        <div className="vt-select-wrap">
          <Globe size={12} className="vt-select-icon" aria-hidden="true" />
          <label htmlFor={langId} className="vm-visually-hidden">Sample language</label>
          <select id={langId} className="vt-lang-select" value={language} onChange={(e) => setLanguage(e.target.value)}>
            {SUPPORTED_LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </div>
      </div>

      {/* Transcript (ref_text) */}
      <div className="vt-transcript">
        <label htmlFor={transcriptId} className="vt-field-label">Transcript (optional)</label>
        <textarea
          id={transcriptId}
          className="vt-transcript-input"
          placeholder="What you said in the clip"
          value={refText}
          onChange={(e) => setRefText(e.target.value)}
          rows={2}
          maxLength={500}
        />
        <div className="vt-field-help">What you said in the clip — speeds up synthesis.</div>
      </div>

      {/* Consent (required) */}
      <label htmlFor={consentId} className="vt-consent">
        <input
          id={consentId}
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="vt-consent-box"
        />
        <ShieldCheck size={14} strokeWidth={2} className="vt-consent-icon" aria-hidden="true" />
        <span>I confirm this is my own voice, or I have permission to clone it.</span>
      </label>

      {/* Submit */}
      <button type="button" className="vt-submit-btn" onClick={handleSubmit} disabled={!canSubmit}>
        {submitting ? (
          <>
            <div className="vm-spinner" style={{ width: 14, height: 14 }} />
            Cloning voice…
          </>
        ) : (
          <>
            <Sparkles size={14} strokeWidth={2} />
            Clone voice
          </>
        )}
      </button>

      <STYLES />
    </div>
  );
}

function STYLES() {
  return (
    <style>{`
      .vt-card { padding: 20px; display: flex; flex-direction: column; }

      .vt-header { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
      .vt-header-icon {
        width: 34px; height: 34px; border-radius: 10px;
        display: flex; align-items: center; justify-content: center;
        background: rgba(109,159,55,0.12); border: 1px solid rgba(109,159,55,0.22);
        color: var(--bamboo-400); flex-shrink: 0;
      }
      .vt-title { font-size: 14px; font-weight: 600; color: var(--text-primary); letter-spacing: -0.01em; }
      .vt-subtitle { font-size: 11px; color: var(--text-muted); margin-top: 1px; line-height: 1.4; }

      .vt-mode-toggle {
        position: relative; display: flex; gap: 2px; padding: 3px; margin-bottom: 14px;
        background: var(--surface-subtle); border: 1px solid var(--border-subtle); border-radius: 10px;
      }
      .vt-mode-pill {
        position: absolute; top: 3px; bottom: 3px; width: calc(50% - 4px);
        background: rgba(109,159,55,0.18); border: 1px solid rgba(109,159,55,0.3);
        border-radius: 7px; transition: left 0.22s cubic-bezier(0.4,0,0.2,1); pointer-events: none;
      }
      .vt-mode-btn {
        position: relative; flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px;
        padding: 8px 0; font-size: 12px; font-weight: 500; border: none; background: transparent;
        cursor: pointer; border-radius: 7px; color: var(--text-muted); transition: color 0.18s; z-index: 1;
      }
      .vt-mode-btn--active { color: var(--bamboo-300); }

      .vt-drop-zone {
        display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 28px 20px;
        border: 1.5px dashed rgba(109,159,55,0.25); border-radius: 12px; cursor: pointer;
        transition: border-color 0.2s, background 0.2s; background: rgba(109,159,55,0.02);
        margin-bottom: 12px; text-align: center;
      }
      .vt-drop-zone:hover, .vt-drop-zone--active { border-color: rgba(109,159,55,0.55); background: rgba(109,159,55,0.06); }
      .vt-drop-icon-wrap {
        width: 44px; height: 44px; border-radius: 12px; background: rgba(109,159,55,0.1);
        border: 1px solid rgba(109,159,55,0.2); display: flex; align-items: center; justify-content: center;
        color: var(--bamboo-400); margin-bottom: 4px;
      }
      .vt-drop-title { font-size: 13px; font-weight: 500; color: var(--text-secondary); margin: 0; }
      .vt-drop-hint { font-size: 11px; color: var(--text-faint); margin: 0; }

      .vt-record-zone {
        border: 1px solid var(--border-subtle); border-radius: 12px; padding: 18px; margin-bottom: 12px;
        background: rgba(0,0,0,0.12); display: flex; align-items: center; justify-content: center;
      }
      .vt-record-idle { display: flex; align-items: center; gap: 16px; }
      .vt-recording-active { display: flex; align-items: center; gap: 14px; width: 100%; }
      .vt-mic-ring--idle {
        width: 52px; height: 52px; border-radius: 50%; border: 1.5px solid rgba(109,159,55,0.4);
        background: rgba(109,159,55,0.08); color: var(--bamboo-400); cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        transition: background 0.2s, transform 0.15s, border-color 0.2s; flex-shrink: 0;
      }
      .vt-mic-ring--idle:hover { background: rgba(109,159,55,0.18); border-color: rgba(109,159,55,0.7); transform: scale(1.06); }
      .vt-mic-ring--recording {
        width: 42px; height: 42px; border-radius: 50%; border: 2px solid rgba(248,113,113,0.5);
        background: rgba(239,68,68,0.1); display: flex; align-items: center; justify-content: center;
        animation: vt-ring-pulse 1.4s ease-in-out infinite; flex-shrink: 0;
      }
      @keyframes vt-ring-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.3); } 50% { box-shadow: 0 0 0 8px rgba(239,68,68,0); } }
      .vt-rec-dot { width: 12px; height: 12px; border-radius: 50%; background: #f87171; animation: vt-dot-pulse 1s ease-in-out infinite; }
      @keyframes vt-dot-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.6; transform: scale(0.85); } }
      .vt-rec-label { flex: 1; }
      .vt-rec-time { display: block; font-size: 20px; font-weight: 600; color: #f87171; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
      .vt-rec-hint { font-size: 11px; color: var(--text-faint); }
      .vt-rec-cta { font-size: 13px; font-weight: 500; color: var(--text-secondary); margin: 0 0 2px; }
      .vt-rec-hint-sub { font-size: 11px; color: var(--text-faint); margin: 0; }
      .vt-stop-btn {
        display: flex; align-items: center; gap: 5px; padding: 6px 14px; border-radius: 8px;
        border: 1px solid rgba(248,113,113,0.3); background: rgba(239,68,68,0.08); color: #f87171;
        font-size: 12px; font-weight: 500; cursor: pointer; transition: background 0.15s;
      }
      .vt-stop-btn:hover { background: rgba(239,68,68,0.16); }

      .vt-decoding { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-muted); margin: 4px 0 12px; }

      .vt-clip-row {
        display: flex; align-items: center; gap: 8px; padding: 9px 12px; border-radius: 10px;
        border: 1px solid var(--border-subtle); background: var(--surface-subtle); margin-bottom: 12px;
      }
      .vt-play-btn {
        width: 28px; height: 28px; border-radius: 50%; border: 1px solid var(--border-subtle);
        background: transparent; color: var(--text-muted); cursor: pointer;
        display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        transition: background 0.15s, color 0.15s, border-color 0.15s;
      }
      .vt-play-btn:hover, .vt-play-btn--active { background: rgba(109,159,55,0.15); color: var(--bamboo-400); border-color: rgba(109,159,55,0.4); }
      .vt-clip-meta { flex: 1; display: flex; align-items: center; gap: 8px; min-width: 0; }
      .vt-clip-name { font-size: 12px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .vt-clip-dur { display: inline-flex; align-items: center; gap: 3px; font-size: 10px; color: var(--text-faint); flex-shrink: 0; font-variant-numeric: tabular-nums; }
      .vt-remove-btn {
        background: transparent; border: none; color: var(--text-faint); cursor: pointer; padding: 4px;
        border-radius: 5px; display: flex; align-items: center; transition: color 0.15s, background 0.15s; flex-shrink: 0;
      }
      .vt-remove-btn:hover { color: #f87171; background: rgba(239,68,68,0.1); }

      .vt-form-row { display: flex; gap: 8px; margin-bottom: 10px; }
      .vt-input-wrap { position: relative; }
      .vt-name-input {
        width: 100%; background: var(--surface-subtle); border: 1px solid var(--border-subtle);
        border-radius: 9px; padding: 9px 13px; font-size: 13px; color: var(--text-primary);
        outline: none; transition: border-color 0.15s, background 0.15s; box-sizing: border-box;
      }
      .vt-name-input::placeholder { color: var(--text-faint); }
      .vt-name-input:focus { border-color: rgba(109,159,55,0.5); background: rgba(109,159,55,0.04); }
      .vt-select-wrap { position: relative; display: flex; align-items: center; }
      .vt-select-icon { position: absolute; left: 10px; color: var(--text-faint); pointer-events: none; }
      .vt-lang-select {
        background: var(--surface-subtle); border: 1px solid var(--border-subtle); border-radius: 9px;
        padding: 9px 10px 9px 28px; font-size: 12px; color: var(--text-secondary); cursor: pointer;
        outline: none; white-space: nowrap; transition: border-color 0.15s;
      }
      .vt-lang-select:focus { border-color: rgba(109,159,55,0.5); }

      .vt-transcript { margin-bottom: 12px; }
      .vt-field-label { display: block; font-size: 11px; font-weight: 600; color: var(--text-muted); margin-bottom: 5px; }
      .vt-transcript-input {
        width: 100%; box-sizing: border-box; background: var(--surface-subtle); border: 1px solid var(--border-subtle);
        border-radius: 9px; padding: 9px 13px; font-size: 12px; color: var(--text-primary); outline: none;
        resize: vertical; font-family: inherit; transition: border-color 0.15s, background 0.15s;
      }
      .vt-transcript-input::placeholder { color: var(--text-faint); }
      .vt-transcript-input:focus { border-color: rgba(109,159,55,0.5); background: rgba(109,159,55,0.04); }
      .vt-field-help { font-size: 10.5px; color: var(--text-faint); margin-top: 4px; }

      .vt-consent {
        display: flex; align-items: flex-start; gap: 9px; padding: 11px 13px; margin-bottom: 14px;
        border-radius: 10px; background: rgba(109,159,55,0.05); border: 1px solid rgba(109,159,55,0.14);
        font-size: 12px; color: var(--text-secondary); line-height: 1.45; cursor: pointer;
      }
      .vt-consent-box { accent-color: var(--bamboo-500); margin-top: 1px; cursor: pointer; flex-shrink: 0; }
      .vt-consent-icon { color: var(--bamboo-400); flex-shrink: 0; margin-top: 1px; }

      .vt-submit-btn {
        width: 100%; display: flex; align-items: center; justify-content: center; gap: 7px;
        padding: 11px 0; border-radius: 10px; border: none;
        background: linear-gradient(135deg, #4a7a28 0%, #6db94a 60%, #a3c96e 100%);
        color: var(--text-primary); font-size: 13px; font-weight: 600; cursor: pointer;
        letter-spacing: 0.01em; transition: opacity 0.15s, transform 0.12s, box-shadow 0.2s;
        box-shadow: 0 2px 16px rgba(109,159,55,0.25);
      }
      .vt-submit-btn:hover:not(:disabled) { opacity: 0.92; transform: translateY(-1px); box-shadow: 0 4px 22px rgba(109,159,55,0.38); }
      .vt-submit-btn:active:not(:disabled) { transform: translateY(0); }
      .vt-submit-btn:disabled { background: var(--surface-subtle); color: var(--text-faint); cursor: default; box-shadow: none; }
    `}</style>
  );
}
