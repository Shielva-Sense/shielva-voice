"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Users, Trash2, Play, Pause, Download } from "lucide-react";
import { notify } from "../lib/toast";
import { deleteVoice, deleteVoiceFull, fetchVoiceAudio, triggerRvcTraining, cancelRvcTraining, subscribeVoiceTrainingStatus, type VoiceInfo } from "../lib/amt-api";
import UsageIndicator from "./UsageIndicator";
import StoragePathWidget from "./StoragePathWidget";
import VoiceLibraryModal from "./VoiceLibraryModal";
import { useVoice, useVoiceDispatch } from "../context/VoiceContext";
import { useVoices, useInvalidateVoices } from "../hooks/useVoices";

// ── Training step definitions ──────────────────────────────────────────────────
const TRAINING_STEPS = [
  { key: "audio",   label: "Audio processed",        test: (steps: Set<string>, prog: number) => steps.has("audio")   || prog >= 20  },
  { key: "encoder", label: "Voice registered",        test: (steps: Set<string>, _prog: number) => steps.has("encoder") || steps.has("done") },
  { key: "r2",      label: "Cloud backup",            test: (steps: Set<string>, _prog: number) => steps.has("r2")      || steps.has("done") },
  { key: "rvc",     label: "RVC model training",      test: (steps: Set<string>, prog: number) => steps.has("rvc")     || prog >= 95  },
  { key: "done",    label: "Model saved to cloud",    test: (steps: Set<string>, prog: number) => steps.has("done")    || prog >= 100 },
];

// ── localStorage persistence for RVC pending training ─────────────────────────
const RVC_PENDING_LS_KEY = "rvc_pending_trains";
function loadPendingRvcIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(RVC_PENDING_LS_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch { return new Set(); }
}
function savePendingRvcIds(ids: Set<string>) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(RVC_PENDING_LS_KEY, JSON.stringify([...ids])); } catch {}
}


// ── Main component ─────────────────────────────────────────────────────────────
export default function VoiceLibrary() {
  const { state: { trainedVoiceIds: contextTrainedIds, pendingVoices } } = useVoice();
  const { voiceDeleted, voiceTrained, updateTrainingProgress } = useVoiceDispatch();
  const { voices, isLoading: loading } = useVoices();
  const invalidateVoices = useInvalidateVoices();
  const total = voices.length;

  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [voiceAudioLoading, setVoiceAudioLoading] = useState<string | null>(null);
  const [downloadingVoiceId, setDownloadingVoiceId] = useState<string | null>(null);
  const [optimizingId, setOptimizingId] = useState<string | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [localTrainedIds, setLocalTrainedIds] = useState<Set<string>>(new Set());
  const [langFilter, setLangFilter] = useState<string>("");
  const [showModal, setShowModal] = useState(false);
  const [hoveringVoiceId, setHoveringVoiceId] = useState<string | null>(null);
  const [trainQuality, setTrainQuality] = useState<Record<string, "fast" | "near_accurate" | "accurate">>({});
  const [openQualityId, setOpenQualityId] = useState<string | null>(null);

  // Persisted across refreshes: voices whose RVC training was triggered this session
  const [pendingRvcIds, setPendingRvcIds] = useState<Set<string>>(() => loadPendingRvcIds());
  const addPendingRvc = useCallback((id: string) => {
    setPendingRvcIds((prev) => { const next = new Set([...prev, id]); savePendingRvcIds(next); return next; });
  }, []);
  const removePendingRvc = useCallback((id: string) => {
    setPendingRvcIds((prev) => { const next = new Set(prev); next.delete(id); savePendingRvcIds(next); return next; });
  }, []);

  // For the "Re-train" flow — separate from the optimistic pending state
  const [retrainProgress, setRetrainProgress] = useState<Record<string, { progress: number; message: string; stepsDone: Set<string> }>>({});

  // SSE cleanup map for server-side training subscriptions
  const pollTimers = useRef<Record<string, () => void>>({});
  const voiceAudioUrls = useRef<Record<string, string>>({});
  const voiceAudioEl = useRef<HTMLAudioElement | null>(null);

  const refresh = useCallback(() => { invalidateVoices(); }, [invalidateVoices]);

  // Subscribe to SSE for voices in training status from server OR locally-triggered RVC
  useEffect(() => {
    const cleanups = pollTimers.current;
    voices.forEach((v) => {
      // Skip if registration is still in progress (VoiceTraining SSE handles that).
      const pendingEntry = pendingVoices.get(v.voice_id);
      if (pendingEntry && !pendingEntry.stepsDone.has("done")) return;
      // Subscribe if server says "training" OR we locally triggered RVC for this voice
      const shouldSubscribe = v.training_status === "training" || pendingRvcIds.has(v.voice_id);
      if (!shouldSubscribe || cleanups[v.voice_id]) return;
      const voiceName = v.name || v.voice_id;
      cleanups[v.voice_id] = subscribeVoiceTrainingStatus(
        v.voice_id,
        (s) => {
          const msg = s.message || s.status || "";
          const msgLower = msg.toLowerCase();
          setRetrainProgress((prev) => {
            const prevSteps = prev[v.voice_id]?.stepsDone ?? new Set<string>();
            const next = new Set(prevSteps);
            if ((s.progress ?? 0) >= 20) next.add("audio");
            if (msgLower.includes("registered") || msgLower.includes("voice library") || (s.progress ?? 0) >= 90) next.add("encoder");
            if (s.r2_uploaded === true || msgLower.includes("cloud backup complete")) next.add("r2");
            if (msgLower.includes("voice conversion") && msgLower.includes("ready")) next.add("rvc");
            if (s.status === "complete") {
              ["audio","encoder","indicf5","vits","rvc","r2","done"].forEach((k) => next.add(k));
              setLocalTrainedIds((ids) => new Set([...ids, v.voice_id]));
              removePendingRvc(v.voice_id);
              voiceTrained(v.voice_id);
            } else if (s.status === "failed") {
              removePendingRvc(v.voice_id);
            } else if (s.status === "not_found" || s.status === "registered") {
              // Job is gone — clear pending so the card stops showing "training"
              removePendingRvc(v.voice_id);
            }
            // Never drop progress backwards — keeps bar from flashing to 0 on pending events
            const prevProgress = prev[v.voice_id]?.progress ?? 0;
            const newProgress = Math.max(prevProgress, s.progress ?? 0);
            return { ...prev, [v.voice_id]: { progress: newProgress, message: msg, stepsDone: next } };
          });
        },
        () => {
          delete cleanups[v.voice_id];
          import("../lib/amt-api").then(({ getVoiceTrainingStatus }) =>
            getVoiceTrainingStatus(v.voice_id).then((s) => {
              if (s.status === "complete" || (s.progress ?? 0) >= 100) {
                setLocalTrainedIds((ids) => new Set([...ids, v.voice_id]));
                removePendingRvc(v.voice_id);
                refresh();
              } else if (s.status === "failed") {
                removePendingRvc(v.voice_id);
                notify.error("Training failed", `Voice "${voiceName}" could not be trained.`);
              } else if (s.status === "not_found") {
                // Job was truly lost (server restart, Redis flush) — notify user
                removePendingRvc(v.voice_id);
                notify.error("Training interrupted", `Training for "${voiceName}" was interrupted. Please retrain.`);
              } else if (s.status === "registered") {
                // Normal state after initial registration — RVC training not started yet
                removePendingRvc(v.voice_id);
              }
            }).catch(() => {})
          );
        },
      );
    });
    Object.keys(cleanups).forEach((id) => {
      const voice = voices.find((v) => v.voice_id === id);
      const stillActive = voice && (voice.training_status === "training" || pendingRvcIds.has(id));
      if (!stillActive) { cleanups[id](); delete cleanups[id]; }
    });
  }, [voices, pendingVoices, pendingRvcIds, removePendingRvc, refresh]);

  useEffect(() => {
    return () => { Object.values(pollTimers.current).forEach((fn) => fn()); };
  }, []);

  useEffect(() => {
    const urls = voiceAudioUrls.current;
    return () => { Object.values(urls).forEach((u) => URL.revokeObjectURL(u)); };
  }, []);

  // Close quality dropdown on outside click
  useEffect(() => {
    if (!openQualityId) return;
    const handler = () => setOpenQualityId(null);
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openQualityId]);

  // ── Resolve training progress for a voice ──────────────────────────────────
  // Phase detection via stepsDone:
  //   - Registration phase: pending voice exists AND stepsDone does NOT have "done"
  //     → use pendingVoices (live SSE from VoiceTraining)
  //   - RVC background phase: stepsDone HAS "done" (registration complete, RVC running)
  //     → use retrainProgress (live SSE from voice_training_status_stream → RVC worker Redis)
  const getProgress = (voiceId: string): { progress: number; message: string; stepsDone: Set<string> } | null => {
    const pending = pendingVoices.get(voiceId);
    const registrationDone = pending?.stepsDone?.has("done") ?? false;

    if (registrationDone) {
      // RVC phase — use SSE-driven retrainProgress
      const retrain = retrainProgress[voiceId];
      if (retrain) return retrain;
      // SSE not yet connected — show the last registration progress (never drop to 0)
      const lastPct = pending?.progress ?? 10;
      return { progress: lastPct, message: "RVC model training in background…", stepsDone: new Set() };
    }
    // Registration phase — use live VoiceTraining SSE data
    if (pending) return { progress: pending.progress, message: pending.message, stepsDone: pending.stepsDone };
    // Fallback: re-train SSE (for voices trained before this session)
    const retrain = retrainProgress[voiceId];
    return retrain ?? null;
  };

  // isTraining: show progress bar during registration (pending, not done) OR RVC training (server/localStorage)
  const isTraining = (v: VoiceInfo) => {
    const pending = pendingVoices.get(v.voice_id);
    const inRegistration = !!pending && !pending.stepsDone.has("done");
    return inRegistration || v.training_status === "training" || optimizingId === v.voice_id || pendingRvcIds.has(v.voice_id);
  };

  // ── Playback ───────────────────────────────────────────────────────────────
  const handleVoicePlay = async (voiceId: string) => {
    if (playingVoiceId === voiceId) {
      voiceAudioEl.current?.pause();
      setPlayingVoiceId(null);
      return;
    }
    voiceAudioEl.current?.pause();
    setPlayingVoiceId(null);
    let url = voiceAudioUrls.current[voiceId];
    if (!url) {
      setVoiceAudioLoading(voiceId);
      try {
        const blob = await fetchVoiceAudio(voiceId);
        url = URL.createObjectURL(blob);
        voiceAudioUrls.current[voiceId] = url;
      } catch (err: any) {
        setVoiceAudioLoading(null);
        if (err?.message === "no_audio") {
          notify.warning("No audio sample", "Re-register this voice to enable playback.");
        } else {
          notify.error("Playback failed", "Could not load the voice sample.");
        }
        return;
      } finally {
        setVoiceAudioLoading(null);
      }
    }
    const audio = new Audio(url);
    voiceAudioEl.current = audio;
    setPlayingVoiceId(voiceId);
    audio.onended = () => setPlayingVoiceId(null);
    audio.onerror = () => setPlayingVoiceId(null);
    audio.play().catch(() => setPlayingVoiceId(null));
  };

  const handleVoiceDownload = async (voiceId: string) => {
    setDownloadingVoiceId(voiceId);
    try {
      let url = voiceAudioUrls.current[voiceId];
      if (!url) {
        const blob = await fetchVoiceAudio(voiceId);
        url = URL.createObjectURL(blob);
        voiceAudioUrls.current[voiceId] = url;
      }
      const a = document.createElement("a");
      a.href = url;
      a.download = `${voiceId}.wav`;
      a.click();
    } catch (err: any) {
      if (err?.message === "no_audio") {
        notify.warning("No audio sample", "Re-register this voice to enable download.");
      } else {
        notify.error("Download failed", "Could not fetch the voice sample.");
      }
    } finally {
      setDownloadingVoiceId(null);
    }
  };

  // ── Stop training (cancel backend job + flush memory, keep voice registered) ──
  const handleStopTraining = async (id: string) => {
    if (stoppingId === id) return;
    setStoppingId(id);
    // 1. Close SSE subscription immediately
    if (pollTimers.current[id]) {
      pollTimers.current[id]();
      delete pollTimers.current[id];
    }
    // 2. Clear local training progress and pending state
    setRetrainProgress((prev) => { const n = { ...prev }; delete n[id]; return n; });
    setOptimizingId((prev) => prev === id ? null : prev);
    removePendingRvc(id);
    // 3. Cancel the backend training job — sets cancel flag, aborts thread, flushes memory
    try {
      await cancelRvcTraining(id);
    } catch {
      // Non-fatal — local state already cleared
    }
    // 4. Refresh so card shows registered (not training)
    setStoppingId(null);
    refresh();
    notify.success("Training stopped", "Voice is still registered. Click Train to restart.");
  };

  // ── Re-train ───────────────────────────────────────────────────────────────
  const handleOptimize = async (id: string) => {
    if (optimizingId === id) return;
    // Abort any existing SSE subscription for this voice before starting a new one
    if (pollTimers.current[id]) {
      pollTimers.current[id]();
      delete pollTimers.current[id];
    }
    setOptimizingId(id);
    const quality = trainQuality[id] ?? "accurate";
    const nSteps = quality === "accurate" ? 1500 : quality === "near_accurate" ? 500 : 300;
    const qualityLabel = quality === "accurate" ? "Accurate" : quality === "near_accurate" ? "Near Accurate" : "Fast";
    setRetrainProgress((prev) => ({ ...prev, [id]: { progress: 2, message: `Starting RVC training — ${qualityLabel} (${nSteps} steps)…`, stepsDone: new Set() } }));
    try {
      // Fire RVC training on the server (speaker_ref.wav was stored during registration)
      await triggerRvcTraining(id, { nSteps });
      // Persist to localStorage so training indicator survives page refresh
      addPendingRvc(id);

      // Subscribe to live progress SSE stream
      const voiceName = voices.find((v) => v.voice_id === id)?.name || id;
      const cleanup = subscribeVoiceTrainingStatus(
        id,
        (s) => {
          const msg = s.message || s.status || "";
          setRetrainProgress((prev) => {
            const prevSteps = prev[id]?.stepsDone ?? new Set<string>();
            const next = new Set(prevSteps);
            if (s.status === "complete") {
              ["audio", "encoder", "rvc", "r2", "done"].forEach((k) => next.add(k));
            }
            const prevProgress = prev[id]?.progress ?? 0;
            const newProgress = Math.max(prevProgress, s.progress ?? 0);
            return { ...prev, [id]: { progress: newProgress, message: msg, stepsDone: next } };
          });
          if (s.status === "complete") {
            setLocalTrainedIds((prev) => new Set([...prev, id]));
            removePendingRvc(id);
            voiceTrained(id);
            setOptimizingId(null);
            notify.success(`"${voiceName}" trained!`, "Voice is now ready for cloned TTS.");
            refresh();
          } else if (s.status === "failed") {
            removePendingRvc(id);
            notify.error("Training failed", s.message || "RVC model training failed");
            setOptimizingId(null);
          }
        },
        () => {
          // SSE connection closed — keep pendingRvcIds so next render re-subscribes
          delete pollTimers.current[id];
          setOptimizingId((cur) => (cur === id ? null : cur));
          refresh();
        },
      );
      pollTimers.current[id] = cleanup;
    } catch (err: any) {
      notify.error("Training failed", err instanceof Error ? err.message : String(err));
      setOptimizingId(null);
    }
  };

  // ── Delete ─────────────────────────────────────────────────────────────────
  const handleDelete = async (id: string, isTraining?: boolean) => {
    try {
      if (playingVoiceId === id) {
        voiceAudioEl.current?.pause();
        setPlayingVoiceId(null);
      }
      if (pollTimers.current[id]) {
        pollTimers.current[id]();
        delete pollTimers.current[id];
      }
      setRetrainProgress((prev) => { const n = { ...prev }; delete n[id]; return n; });
      if (voiceAudioUrls.current[id]) {
        URL.revokeObjectURL(voiceAudioUrls.current[id]);
        delete voiceAudioUrls.current[id];
      }
      const voiceName = voices.find((v) => v.voice_id === id)?.name;
      const deletions = [deleteVoiceFull(id, voiceName).catch(() => {})];
      if (!isTraining) deletions.push(deleteVoice(id).catch(() => {}));
      await Promise.all(deletions);
      const label = voices.find((v) => v.voice_id === id)?.name || id;
      notify.success(`Voice "${label}" deleted`, isTraining ? "Training cancelled and data removed." : "Speaker embedding removed.");
      refresh();
      voiceDeleted(id);
    } catch (err: any) {
      if (err?.quota) {
        notify.quotaExceeded(err.quota);
      } else {
        notify.error("Delete failed", err instanceof Error ? err.message : "Could not remove voice.");
      }
    }
  };

  return (
    <div className="vm-card">
      <div className="vm-card-header">
        <div className="vm-card-icon">
          <Users size={18} strokeWidth={2} />
        </div>
        <div>
          <div className="vm-card-title">Voice Library</div>
          <div className="vm-card-subtitle">GE2E Speaker Encoder (256-dim)</div>
        </div>
        <UsageIndicator resource="voice" />
        <span className="vm-tag vm-tag-gray">
          {total} {total === 1 ? "voice" : "voices"}
        </span>
        <button
          onClick={() => setShowModal(true)}
          style={{
            marginLeft: "auto",
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 6, padding: "4px 10px",
            color: "var(--text-muted,rgba(255,255,255,0.4))",
            fontSize: 11, fontWeight: 600, cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          View All
        </button>
      </div>
      {showModal && (
        <VoiceLibraryModal onClose={() => setShowModal(false)} />
      )}

      <StoragePathWidget />

      {voices.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <select
            value={langFilter}
            onChange={(e) => setLangFilter(e.target.value)}
            style={{
              width: "100%",
              background: "var(--surface-subtle)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 6,
              color: "var(--text-primary, #e8e8e8)",
              fontSize: 12,
              padding: "5px 8px",
              outline: "none",
            }}
          >
            <option value="">All languages</option>
            <optgroup label="Indian">
              <option value="hi">Hindi</option>
              <option value="ta">Tamil</option>
              <option value="te">Telugu</option>
              <option value="kn">Kannada</option>
              <option value="ml">Malayalam</option>
              <option value="mr">Marathi</option>
              <option value="bn">Bengali</option>
              <option value="gu">Gujarati</option>
              <option value="pa">Punjabi</option>
              <option value="or">Odia</option>
              <option value="as">Assamese</option>
              <option value="ur">Urdu</option>
              <option value="sa">Sanskrit</option>
            </optgroup>
            <optgroup label="International">
              <option value="en">English</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
              <option value="de">German</option>
              <option value="ja">Japanese</option>
              <option value="zh">Chinese</option>
              <option value="ar">Arabic</option>
              <option value="pt">Portuguese</option>
              <option value="ru">Russian</option>
              <option value="ko">Korean</option>
              <option value="it">Italian</option>
              <option value="nl">Dutch</option>
              <option value="tr">Turkish</option>
            </optgroup>
          </select>
        </div>
      )}

      <div className="vm-voice-list">
        {loading && (
          <div style={{ textAlign: "center", padding: 20 }}>
            <div className="vm-spinner" />
          </div>
        )}
        {!loading && voices.length === 0 && (
          <div style={{ textAlign: "center", padding: 20, color: "var(--gray-500)", fontSize: 13 }}>
            No voices registered yet
          </div>
        )}

        {voices.filter((v) => !langFilter || v.language === langFilter).map((v) => {
          const training = isTraining(v);
          // Source of truth: rvc_trained from MongoDB (backend-verified).
          // localTrainedIds / contextTrainedIds kept as optimistic UI update during current session.
          const trained = !training && (v.rvc_trained === true || localTrainedIds.has(v.voice_id) || contextTrainedIds.has(v.voice_id));
          const prog = getProgress(v.voice_id);

          return (
            <div
              key={v.voice_id}
              className="vm-voice-item"
              style={{ flexDirection: "row", alignItems: "center", gap: 8, position: "relative" }}
              onMouseEnter={() => setHoveringVoiceId(v.voice_id)}
              onMouseLeave={() => setHoveringVoiceId(null)}
            >
              {/* ── Left: name + meta + progress ── */}
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                <div className="vm-voice-name" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {v.name || v.voice_id}
                  </span>
                  {trained && (
                    <span style={{ fontSize: 10, color: "var(--bamboo-400, #a3c96e)", fontWeight: 600, flexShrink: 0 }}>fast</span>
                  )}
                </div>

                <div className="vm-voice-meta" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  {v.sample_duration_ms ? (
                    <span>{(v.sample_duration_ms / 1000).toFixed(1)}s</span>
                  ) : null}
                  {v.language && (
                    <span style={{ fontSize: 10, background: "var(--surface-subtle)", borderRadius: 3, padding: "1px 5px", color: "var(--text-muted)" }}>
                      {v.language.toUpperCase()}
                    </span>
                  )}
                  {training ? (
                    <span style={{ fontSize: 10, background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.35)", borderRadius: 3, padding: "1px 5px", color: "#fbbf24", fontWeight: 600 }}>
                      training
                    </span>
                  ) : trained ? (
                    <span style={{ fontSize: 10, background: "rgba(109,159,55,0.18)", border: "1px solid rgba(109,159,55,0.4)", borderRadius: 3, padding: "1px 5px", color: "var(--bamboo-400, #a3c96e)", fontWeight: 600 }}>
                      trained
                    </span>
                  ) : (
                    <span style={{ fontSize: 10, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 3, padding: "1px 5px", color: "var(--text-faint, #6b7280)", fontWeight: 500 }}>
                      untrained
                    </span>
                  )}
                </div>

                {training && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <div style={{ flex: 1, height: 5, borderRadius: 3, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                      <div style={{
                        height: "100%", width: `${prog?.progress ?? 0}%`,
                        background: (prog?.progress ?? 0) >= 100 ? "#4ade80" : "linear-gradient(90deg,#ca8a04,#fbbf24)",
                        borderRadius: 3, transition: "width 0.4s ease",
                      }} />
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: (prog?.progress ?? 0) >= 100 ? "#4ade80" : "#fbbf24", minWidth: 32, textAlign: "right", flexShrink: 0 }}>
                      {prog?.progress ?? 0}%
                    </span>
                  </div>
                )}
                {training && prog?.message && (
                  <div style={{ fontSize: 10, color: "#ca8a04", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {prog.message}
                  </div>
                )}
                {training && hoveringVoiceId === v.voice_id && (
                  <div style={{
                    marginTop: 4, padding: "7px 10px",
                    background: "var(--surface-card, #1a1a1a)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 6, display: "flex", flexDirection: "column", gap: 4,
                  }}>
                    {TRAINING_STEPS.map((step) => {
                      const done = step.test(prog?.stepsDone ?? new Set(), prog?.progress ?? 0);
                      const isCurrent = !done && TRAINING_STEPS.findIndex((s) => !s.test(prog?.stepsDone ?? new Set(), prog?.progress ?? 0)) === TRAINING_STEPS.indexOf(step);
                      return (
                        <div key={step.key} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11 }}>
                          <span style={{
                            width: 14, height: 14, flexShrink: 0,
                            border: `1px solid ${done ? "rgba(109,159,55,0.6)" : isCurrent ? "rgba(251,191,36,0.6)" : "rgba(255,255,255,0.2)"}`,
                            borderRadius: 3, background: done ? "rgba(109,159,55,0.18)" : "transparent",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 9, color: done ? "var(--bamboo-400,#a3c96e)" : "transparent",
                          }}>
                            {done ? "✓" : ""}
                          </span>
                          <span style={{
                            color: done ? "var(--text-secondary, #ccc)" : isCurrent ? "#fbbf24" : "var(--text-faint, #6b7280)",
                            fontWeight: isCurrent ? 600 : 400,
                          }}>
                            {step.label}
                            {isCurrent && <span style={{ marginLeft: 5, opacity: 0.7, fontWeight: 400 }}>…</span>}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ── Right: actions — vertically centered by parent alignItems:center ── */}
              <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                {training ? (
                  <>
                    <button
                      onClick={() => handleStopTraining(v.voice_id)}
                      disabled={stoppingId === v.voice_id}
                      title="Stop training — keep voice registered"
                      style={{
                        background: "none", border: "1px solid rgba(251,191,36,0.4)",
                        borderRadius: 5, padding: "3px 9px",
                        cursor: stoppingId === v.voice_id ? "not-allowed" : "pointer",
                        color: "#fbbf24", fontSize: 11, fontWeight: 600,
                        opacity: stoppingId === v.voice_id ? 0.6 : 1,
                      }}
                    >{stoppingId === v.voice_id ? "…" : "Stop"}</button>
                    <button
                      onClick={() => handleDelete(v.voice_id, true)}
                      title="Cancel training & delete voice"
                      style={{
                        background: "none", border: "1px solid rgba(239,68,68,0.35)",
                        borderRadius: 5, padding: "3px 9px",
                        cursor: "pointer", color: "#f87171", fontSize: 11,
                      }}
                    >✕</button>
                  </>
                ) : (
                  <>
                    <button
                      className="vm-voice-delete"
                      onClick={() => handleVoicePlay(v.voice_id)}
                      title={playingVoiceId === v.voice_id ? "Stop playback" : "Play sample"}
                      style={{
                        color: playingVoiceId === v.voice_id ? "var(--bamboo-400)" : undefined,
                        border: playingVoiceId === v.voice_id ? "1px solid rgba(109,159,55,0.4)" : "1px solid transparent",
                      }}
                    >
                      {voiceAudioLoading === v.voice_id ? (
                        <div className="vm-spinner" style={{ width: 12, height: 12 }} />
                      ) : playingVoiceId === v.voice_id ? (
                        <Pause size={14} strokeWidth={2} />
                      ) : (
                        <Play size={14} strokeWidth={2} />
                      )}
                    </button>
                    <button
                      className="vm-voice-delete"
                      onClick={() => handleVoiceDownload(v.voice_id)}
                      title="Download voice sample"
                    >
                      {downloadingVoiceId === v.voice_id ? (
                        <div className="vm-spinner" style={{ width: 12, height: 12 }} />
                      ) : (
                        <Download size={14} strokeWidth={2} />
                      )}
                    </button>
                    {/* Custom quality picker */}
                    <div style={{ position: "relative" }}>
                      <button
                        onClick={() => setOpenQualityId(openQualityId === v.voice_id ? null : v.voice_id)}
                        style={{
                          display: "flex", alignItems: "center", gap: 4,
                          fontSize: 10, padding: "3px 7px", borderRadius: 5,
                          background: "var(--surface-2, #1a1a1a)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          color: "var(--text-muted)", cursor: "pointer", whiteSpace: "nowrap",
                        }}
                      >
                        {(trainQuality[v.voice_id] ?? "accurate") === "fast" ? "Fast" :
                         (trainQuality[v.voice_id] ?? "accurate") === "near_accurate" ? "Near Accurate" : "Accurate"}
                        <span style={{ fontSize: 8, opacity: 0.6 }}>▾</span>
                      </button>
                      {openQualityId === v.voice_id && (
                        <div style={{
                          position: "absolute", bottom: "calc(100% + 4px)", right: 0, zIndex: 50,
                          background: "#1c1c1c", border: "1px solid rgba(255,255,255,0.12)",
                          borderRadius: 8, padding: "4px 0", minWidth: 160,
                          boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                        }}>
                          {([ ["fast", "Fast", "300 steps · ~2 min"], ["near_accurate", "Near Accurate", "500 steps · ~4 min"], ["accurate", "Accurate", "1500 steps · ~12 min"] ] as const).map(([val, label, hint]) => {
                            const selected = (trainQuality[v.voice_id] ?? "accurate") === val;
                            return (
                              <div
                                key={val}
                                onMouseDown={(e) => { e.stopPropagation(); setTrainQuality((p) => ({ ...p, [v.voice_id]: val })); setOpenQualityId(null); }}
                                style={{
                                  display: "flex", alignItems: "center", justifyContent: "space-between",
                                  padding: "7px 12px", cursor: "pointer", gap: 12,
                                  background: selected ? "rgba(255,255,255,0.06)" : "transparent",
                                  transition: "background 0.1s",
                                }}
                                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.08)"; }}
                                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = selected ? "rgba(255,255,255,0.06)" : "transparent"; }}
                              >
                                <span style={{ fontSize: 11, color: selected ? "var(--bamboo-300, #c5e07a)" : "var(--text-primary)", fontWeight: selected ? 600 : 400 }}>{label}</span>
                                <span style={{ fontSize: 10, color: "var(--text-muted)", opacity: 0.7 }}>{hint}</span>
                                {selected && <span style={{ fontSize: 10, color: "var(--bamboo-400)" }}>✓</span>}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <button
                      className="vm-voice-delete"
                      onClick={() => handleOptimize(v.voice_id)}
                      title={trained ? "Re-train this voice" : "Train this voice for cloned TTS"}
                      style={{
                        fontSize: 11, fontWeight: 600, padding: "3px 8px",
                        color: trained ? "var(--bamboo-400, #a3c96e)" : "var(--text-muted)",
                        border: trained ? "1px solid rgba(109,159,55,0.4)" : "1px solid transparent",
                      }}
                    >
                      {trained ? "Re-train" : "Train"}
                    </button>
                    <button
                      className="vm-voice-delete"
                      onClick={() => handleDelete(v.voice_id, false)}
                      title="Delete voice"
                    >
                      <Trash2 size={14} strokeWidth={2} />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
