"use client";

import { useState, useRef, useCallback } from "react";
import { Mic, Square, Tag } from "lucide-react";
import { notify } from "../lib/toast";
import { isQuotaExceededError, transcribe, classifyIntent, type TranscribeResult, type IntentResult } from "../lib/amt-api";
import { recordMic } from "../lib/audio-utils";
import { useProcessing } from "../context/ProcessingContext";
import { useAuth } from "../context/AuthContext";
import { useStorage } from "../context/StorageContext";
import UsageIndicator from "./UsageIndicator";

const PUBLIC_MAX_SEC = Number(process.env.NEXT_PUBLIC_PUBLIC_MAX_VOICE_SEC || "5");
const AUTH_MAX_SEC = 3600; // 1 hour for authenticated users

const STT_STAGES = [
  { label: "Recording audio...", percent: 10 },
  { label: "Uploading to Whisper ASR...", percent: 30 },
  { label: "Transcribing speech...", percent: 55 },
  { label: "Running intent detection...", percent: 80 },
  { label: "Finalizing results...", percent: 95 },
];

export default function SpeechToText() {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<TranscribeResult | null>(null);
  const [intent, setIntent] = useState<IntentResult | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const proc = useProcessing();
  const { isAuthenticated, refreshUsage } = useAuth();
  const { canUseFeature, openModal: openStorageModal } = useStorage();
  const storageAccess = canUseFeature("stt");
  const maxDurationMs = (isAuthenticated ? AUTH_MAX_SEC : PUBLIC_MAX_SEC) * 1000;

  const startRecording = useCallback(async () => {
    setResult(null);
    setIntent(null);
    setElapsed(0);
    setLevel(0);
    setRecording(true);

    try {
      proc.startProcessing(STT_STAGES);

      const { promise, stop } = recordMic(
        maxDurationMs,
        (ms) => setElapsed(ms),
        (lvl) => setLevel(lvl)
      );
      stopRef.current = stop;

      const blob = await promise;
      setRecording(false);
      setProcessing(true);

      proc.nextStage("Uploading audio...");
      proc.nextStage("Transcribing with Whisper...");
      const res = await transcribe(blob);
      setResult(res);
      setProcessing(false);

      if (isAuthenticated) refreshUsage();

      if (res.text.trim()) {
        proc.nextStage("Classifying intent...");
        classifyIntent(res.text)
          .then((intentRes) => {
            setIntent(intentRes);
            proc.complete("Speech-to-text complete");
          })
          .catch(() => {
            proc.complete("Transcription complete");
          });
      } else {
        proc.complete("Transcription complete — no speech detected");
      }
    } catch (err) {
      proc.cancel();
      if (isQuotaExceededError(err)) {
        notify.quotaExceeded(err.quota);
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.toLowerCase().includes("permission") || msg.toLowerCase().includes("notallowed")) {
          notify.micDenied();
        } else if (msg.toLowerCase().includes("fetch") || msg.toLowerCase().includes("network") || msg.toLowerCase().includes("transcri")) {
          notify.serviceOffline("Whisper ASR");
        } else {
          notify.error("Recording failed", msg);
        }
      }
    } finally {
      setRecording(false);
      setProcessing(false);
      stopRef.current = null;
    }
  }, [proc, maxDurationMs, refreshUsage]);

  const stopRecording = useCallback(() => {
    stopRef.current?.();
  }, []);

  return (
    <div className="vm-card" style={{ display: "flex", flexDirection: "column" }}>
      {!storageAccess.allowed && (
        <div className="vm-storage-gate-banner">
          <span>Storage not configured.</span>
          <button className="vm-storage-gate-link" onClick={openStorageModal}>Configure storage</button>
        </div>
      )}
      <div className={!storageAccess.allowed ? "vm-card-gated" : undefined} style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <div className="vm-card-header">
        <div className="vm-card-icon">
          <Mic size={18} strokeWidth={2} />
        </div>
        <div>
          <div className="vm-card-title">Speech to Text</div>
          <div className="vm-card-subtitle">Whisper ASR + Auto Intent Detection</div>
        </div>
        <UsageIndicator resource="voice" />
      </div>

      {/* Mic Button */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, flex: 1, minHeight: 120 }}>
        <button
          className={`vm-btn-record ${recording ? "recording" : ""}`}
          onClick={recording ? stopRecording : startRecording}
          disabled={processing}
          aria-label={recording ? "Stop recording" : "Start recording"}
        >
          {recording ? (
            <Square size={22} strokeWidth={2.5} />
          ) : processing ? (
            <div className="vm-spinner" />
          ) : (
            <Mic size={26} strokeWidth={2} />
          )}
        </button>

        {recording && (
          <div className="vm-fade-in" style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="vm-timer">{(elapsed / 1000).toFixed(1)}s</div>
            <div className="vm-level-bar">
              <div className="vm-level-fill" style={{ width: `${level * 100}%` }} />
            </div>
          </div>
        )}

        {!recording && !processing && (
          <span className="vm-record-hint">Tap to record</span>
        )}

        {processing && (
          <div className="vm-processing-hint">
            <div className="vm-spinner" />
            Transcribing...
          </div>
        )}
      </div>

      {/* Transcript Result */}
      {result && (
        <div className="vm-fade-in" style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div className="vm-label">Transcript</div>
            <div className="vm-result">
              <span className={result.text ? "vm-result-text" : "vm-result-empty"}>
                {result.text || "No speech detected"}
              </span>
            </div>
          </div>

          {result.phonemes && result.phonemes.length > 0 && (
            <div>
              <div className="vm-label">Phonemes</div>
              <div className="vm-phonemes">
                {result.phonemes.map((p, i) => (
                  <span key={i} className="vm-phoneme">{p}</span>
                ))}
              </div>
            </div>
          )}

          {intent && (
            <div>
              <div className="vm-label">Detected Intent</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Tag size={14} color="var(--bamboo-400)" strokeWidth={2.5} />
                <span className="vm-tag vm-tag-bamboo">{intent.intent}</span>
                <span style={{ fontSize: 12, color: "var(--gray-400)", fontWeight: 500 }}>
                  {(intent.confidence * 100).toFixed(1)}%
                </span>
              </div>
            </div>
          )}
        </div>
      )}
      </div> {/* end vm-card-gated wrapper */}
    </div>
  );
}
