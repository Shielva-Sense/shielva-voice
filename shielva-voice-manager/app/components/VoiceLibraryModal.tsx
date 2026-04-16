"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { X, Play, Pause, Download, Trash2, Search, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { notify } from "../lib/toast";
import {
  deleteVoice, deleteVoiceFull, fetchVoiceAudio,
  submitVoiceTraining, subscribeVoiceTrainingStatus,
  type VoiceInfo,
} from "../lib/amt-api";
import { useVoice, useVoiceDispatch } from "../context/VoiceContext";
import { useVoices, useInvalidateVoices } from "../hooks/useVoices";

// ── Types ─────────────────────────────────────────────────────────────────────
type SortKey = "name" | "language" | "status" | "duration";
type SortDir = "asc" | "desc";
type StatusFilter = "all" | "trained" | "training" | "untrained";

// ── Inline progress bar (reused from VoiceLibrary) ───────────────────────────
function InlineBar({ progress, message }: { progress: number; message: string }) {
  return (
    <div style={{ minWidth: 0, flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
        <div style={{
          flex: 1, height: 5, borderRadius: 3,
          background: "rgba(255,255,255,0.08)", overflow: "hidden",
        }}>
          <div style={{
            height: "100%", width: `${progress}%`,
            background: progress >= 100 ? "#4ade80" : "linear-gradient(90deg,#ca8a04,#fbbf24)",
            borderRadius: 3, transition: "width 0.4s ease",
          }} />
        </div>
        <span style={{
          fontSize: 11, fontWeight: 700, fontVariantNumeric: "tabular-nums",
          color: progress >= 100 ? "#4ade80" : "#fbbf24", minWidth: 30, textAlign: "right",
        }}>
          {progress}%
        </span>
      </div>
      {message && (
        <div style={{
          fontSize: 10, color: "#ca8a04",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {message}
        </div>
      )}
    </div>
  );
}

// ── Sort header cell ──────────────────────────────────────────────────────────
function SortTh({ label, col, sort, onSort }: {
  label: string; col: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort: (col: SortKey) => void;
}) {
  const active = sort.key === col;
  return (
    <th
      onClick={() => onSort(col)}
      style={{
        padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 600,
        color: active ? "var(--bamboo-400,#8cb856)" : "var(--text-muted,rgba(255,255,255,0.4))",
        cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(0,0,0,0.2)",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {label}
        {active
          ? sort.dir === "asc"
            ? <ChevronUp size={11} />
            : <ChevronDown size={11} />
          : <ChevronsUpDown size={11} style={{ opacity: 0.35 }} />}
      </span>
    </th>
  );
}

// ── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: "trained" | "training" | "untrained" }) {
  const map = {
    trained:   { bg: "rgba(109,159,55,0.15)",  border: "rgba(109,159,55,0.35)",  color: "var(--bamboo-400,#8cb856)", label: "trained" },
    training:  { bg: "rgba(251,191,36,0.12)",  border: "rgba(251,191,36,0.35)",  color: "#fbbf24",                  label: "training" },
    untrained: { bg: "rgba(255,255,255,0.05)", border: "rgba(255,255,255,0.12)", color: "var(--text-faint,#6b7280)", label: "untrained" },
  }[status];
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 4,
      background: map.bg, border: `1px solid ${map.border}`, color: map.color,
    }}>
      {map.label}
    </span>
  );
}

// ── Icon button ───────────────────────────────────────────────────────────────
function IBtn({ onClick, title, danger, children, disabled, active }: {
  onClick: () => void; title: string; danger?: boolean; children: React.ReactNode;
  disabled?: boolean; active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        background: "none",
        border: `1px solid ${danger ? "rgba(239,68,68,0.35)" : active ? "rgba(109,159,55,0.4)" : "rgba(255,255,255,0.12)"}`,
        borderRadius: 5,
        color: danger ? "#f87171" : active ? "var(--bamboo-400,#8cb856)" : "var(--text-muted,rgba(255,255,255,0.4))",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        padding: "4px 7px",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        transition: "all 0.18s",
      }}
    >
      {children}
    </button>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────
interface Props {
  onClose: () => void;
  onTrainNew?: () => void;  // navigate to Train Your Voice tab
}

export default function VoiceLibraryModal({ onClose, onTrainNew }: Props) {
  const { state: { trainedVoiceIds, pendingVoices } } = useVoice();
  const { voiceDeleted, voiceTrained } = useVoiceDispatch();
  const { voices, isLoading } = useVoices();
  const invalidateVoices = useInvalidateVoices();
  const refresh = useCallback(() => invalidateVoices(), [invalidateVoices]);

  // ── Filters / sort ─────────────────────────────────────────────────────────
  const [search, setSearch]         = useState("");
  const [langFilter, setLangFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort]             = useState<{ key: SortKey; dir: SortDir }>({ key: "name", dir: "asc" });

  // ── Per-voice state ────────────────────────────────────────────────────────
  const [playingId, setPlayingId]             = useState<string | null>(null);
  const [audioLoading, setAudioLoading]       = useState<string | null>(null);
  const [downloadingId, setDownloadingId]     = useState<string | null>(null);
  const [optimizingId, setOptimizingId]       = useState<string | null>(null);
  const [localTrained, setLocalTrained]       = useState<Set<string>>(new Set());
  const [retrainProg, setRetrainProg]         = useState<Record<string, { progress: number; message: string }>>({});

  const audioUrls  = useRef<Record<string, string>>({});
  const audioEl    = useRef<HTMLAudioElement | null>(null);
  const pollTimers = useRef<Record<string, () => void>>({});

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    return () => {
      Object.values(audioUrls.current).forEach((u) => URL.revokeObjectURL(u));
      Object.values(pollTimers.current).forEach((fn) => fn());
    };
  }, []);

  // SSE for server-side training voices (not pending)
  useEffect(() => {
    voices.forEach((v) => {
      if (pendingVoices.has(v.voice_id)) return;
      if (v.training_status !== "training" || pollTimers.current[v.voice_id]) return;
      pollTimers.current[v.voice_id] = subscribeVoiceTrainingStatus(
        v.voice_id,
        (s) => setRetrainProg((p) => ({ ...p, [v.voice_id]: { progress: s.progress ?? 0, message: s.message ?? s.status } })),
        () => {
          delete pollTimers.current[v.voice_id];
          import("../lib/amt-api").then(({ getVoiceTrainingStatus }) =>
            getVoiceTrainingStatus(v.voice_id).then((s) => {
              if (s.status === "complete") { setLocalTrained((p) => new Set([...p, v.voice_id])); refresh(); }
            }).catch(() => {})
          );
        },
      );
    });
    Object.keys(pollTimers.current).forEach((id) => {
      if (!voices.find((v) => v.voice_id === id && v.training_status === "training")) {
        pollTimers.current[id]();
        delete pollTimers.current[id];
      }
    });
  }, [voices, pendingVoices, refresh]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const getStatus = (v: VoiceInfo): "trained" | "training" | "untrained" => {
    if (pendingVoices.has(v.voice_id) || v.training_status === "training" || optimizingId === v.voice_id) return "training";
    if (localTrained.has(v.voice_id) || trainedVoiceIds.has(v.voice_id) || v.training_status === "trained") return "trained";
    return "untrained";
  };

  const getProgress = (voiceId: string) => {
    const p = pendingVoices.get(voiceId);
    if (p) return { progress: p.progress, message: p.message };
    return retrainProg[voiceId] ?? null;
  };

  const onSort = (col: SortKey) =>
    setSort((s) => s.key === col ? { key: col, dir: s.dir === "asc" ? "desc" : "asc" } : { key: col, dir: "asc" });

  // ── Filtered + sorted voices ───────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = voices.filter((v) => {
      const q = search.trim().toLowerCase();
      if (q && !(v.name || v.voice_id).toLowerCase().includes(q)) return false;
      if (langFilter && v.language !== langFilter) return false;
      if (statusFilter !== "all" && getStatus(v) !== statusFilter) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      let av: string | number = "";
      let bv: string | number = "";
      if (sort.key === "name")     { av = (a.name || a.voice_id).toLowerCase(); bv = (b.name || b.voice_id).toLowerCase(); }
      if (sort.key === "language") { av = a.language || ""; bv = b.language || ""; }
      if (sort.key === "status")   { av = getStatus(a); bv = getStatus(b); }
      if (sort.key === "duration") { av = a.sample_duration_ms ?? 0; bv = b.sample_duration_ms ?? 0; }
      if (av < bv) return sort.dir === "asc" ? -1 : 1;
      if (av > bv) return sort.dir === "asc" ? 1 : -1;
      return 0;
    });
    return list;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voices, search, langFilter, statusFilter, sort, pendingVoices, localTrained, trainedVoiceIds, optimizingId]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const handlePlay = async (voiceId: string) => {
    if (playingId === voiceId) { audioEl.current?.pause(); setPlayingId(null); return; }
    audioEl.current?.pause(); setPlayingId(null);
    let url = audioUrls.current[voiceId];
    if (!url) {
      setAudioLoading(voiceId);
      try {
        const blob = await fetchVoiceAudio(voiceId);
        url = URL.createObjectURL(blob);
        audioUrls.current[voiceId] = url;
      } catch (err: any) {
        setAudioLoading(null);
        notify.warning(err?.message === "no_audio" ? "No audio sample" : "Playback failed");
        return;
      } finally { setAudioLoading(null); }
    }
    const el = new Audio(url);
    audioEl.current = el;
    setPlayingId(voiceId);
    el.onended = () => setPlayingId(null);
    el.onerror = () => setPlayingId(null);
    el.play().catch(() => setPlayingId(null));
  };

  const handleDownload = async (voiceId: string, name: string) => {
    setDownloadingId(voiceId);
    try {
      let url = audioUrls.current[voiceId];
      if (!url) {
        const blob = await fetchVoiceAudio(voiceId);
        url = URL.createObjectURL(blob);
        audioUrls.current[voiceId] = url;
      }
      const a = document.createElement("a");
      a.href = url; a.download = `${name || voiceId}.wav`; a.click();
    } catch (err: any) {
      notify.error("Download failed", err?.message === "no_audio" ? "No audio available." : String(err));
    } finally { setDownloadingId(null); }
  };

  const handleTrain = async (v: VoiceInfo) => {
    if (optimizingId === v.voice_id) return;
    setOptimizingId(v.voice_id);
    setRetrainProg((p) => ({ ...p, [v.voice_id]: { progress: 0, message: "Fetching voice audio…" } }));
    try {
      const audioBlob = await fetchVoiceAudio(v.voice_id);
      await submitVoiceTraining(
        v.voice_id, v.name || v.voice_id, v.language || "en",
        [{ blob: audioBlob, filename: `${v.voice_id}.wav` }],
        (s) => setRetrainProg((p) => ({ ...p, [v.voice_id]: { progress: s.progress ?? 0, message: s.message || s.status } })),
      );
      setOptimizingId(null);
      setLocalTrained((p) => new Set([...p, v.voice_id]));
      setRetrainProg((p) => ({ ...p, [v.voice_id]: { progress: 100, message: "Training complete" } }));
      voiceTrained(v.voice_id);
      notify.success(`"${v.name || v.voice_id}" trained!`);
      refresh();
    } catch (err: any) {
      notify.error("Training failed", err instanceof Error ? err.message : String(err));
      setOptimizingId(null);
    }
  };

  const handleDelete = async (v: VoiceInfo) => {
    const training = getStatus(v) === "training";
    try {
      if (playingId === v.voice_id) { audioEl.current?.pause(); setPlayingId(null); }
      if (pollTimers.current[v.voice_id]) { pollTimers.current[v.voice_id](); delete pollTimers.current[v.voice_id]; }
      if (audioUrls.current[v.voice_id]) { URL.revokeObjectURL(audioUrls.current[v.voice_id]); delete audioUrls.current[v.voice_id]; }
      const deletions = [deleteVoiceFull(v.voice_id, v.name).catch(() => {})];
      if (!training) deletions.push(deleteVoice(v.voice_id).catch(() => {}));
      await Promise.all(deletions);
      notify.success(`"${v.name || v.voice_id}" deleted`);
      refresh();
      voiceDeleted(v.voice_id);
    } catch (err: any) {
      notify.error("Delete failed", err instanceof Error ? err.message : String(err));
    }
  };

  // ── All unique languages in the list ──────────────────────────────────────
  const langs = useMemo(() => [...new Set(voices.map((v) => v.language).filter(Boolean))].sort(), [voices]);

  // ── Counts ─────────────────────────────────────────────────────────────────
  const counts = useMemo(() => {
    const c = { trained: 0, training: 0, untrained: 0 };
    voices.forEach((v) => { c[getStatus(v)]++; });
    return c;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voices, pendingVoices, localTrained, trainedVoiceIds, optimizingId]);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.65)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "20px 16px",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "linear-gradient(145deg,rgba(14,14,14,0.97),rgba(8,8,8,0.99))",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 14,
          width: "100%",
          maxWidth: 940,
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 32px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(109,159,55,0.08)",
        }}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={{
          padding: "16px 20px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          display: "flex", alignItems: "center", gap: 12, flexShrink: 0,
        }}>
          {/* Title + counts */}
          <div style={{ flex: "0 0 auto" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary,#e8e8e8)" }}>
              Voice Library
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted,rgba(255,255,255,0.4))", marginTop: 1 }}>
              {voices.length} voices · {counts.trained} trained · {counts.training} training
            </div>
          </div>

          {/* Search */}
          <div style={{ flex: 1, position: "relative" }}>
            <Search size={12} style={{
              position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)",
              color: "rgba(255,255,255,0.3)", pointerEvents: "none",
            }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search voices…"
              style={{
                width: "100%", boxSizing: "border-box",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 7, padding: "7px 10px 7px 28px",
                color: "var(--text-primary,#e8e8e8)", fontSize: 12,
                outline: "none",
              }}
            />
          </div>

          {/* Language filter */}
          <select
            value={langFilter}
            onChange={(e) => setLangFilter(e.target.value)}
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 7, padding: "7px 10px", color: "var(--text-primary,#e8e8e8)",
              fontSize: 12, outline: "none", cursor: "pointer",
            }}
          >
            <option value="">All languages</option>
            {langs.map((l) => <option key={l} value={l}>{l?.toUpperCase()}</option>)}
          </select>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 7, padding: "7px 10px", color: "var(--text-primary,#e8e8e8)",
              fontSize: 12, outline: "none", cursor: "pointer",
            }}
          >
            <option value="all">All status</option>
            <option value="trained">Trained</option>
            <option value="training">Training</option>
            <option value="untrained">Untrained</option>
          </select>

          {/* Train new voice */}
          {onTrainNew && (
            <button
              onClick={() => { onClose(); onTrainNew(); }}
              style={{
                background: "linear-gradient(135deg,rgba(109,159,55,0.2),rgba(109,159,55,0.1))",
                border: "1px solid rgba(109,159,55,0.4)",
                borderRadius: 7, padding: "7px 14px",
                color: "var(--bamboo-400,#8cb856)", fontSize: 12, fontWeight: 600,
                cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
              }}
            >
              + Train New
            </button>
          )}

          {/* Close */}
          <button
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 7, padding: "7px 9px",
              color: "var(--text-muted,rgba(255,255,255,0.4))",
              cursor: "pointer", display: "flex", alignItems: "center", flexShrink: 0,
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* ── Table ──────────────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {isLoading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 160 }}>
              <div className="vm-spinner" style={{ width: 24, height: 24 }} />
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted,rgba(255,255,255,0.4))", fontSize: 13 }}>
              {search || langFilter || statusFilter !== "all"
                ? "No voices match the current filters"
                : "No voices registered yet"}
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead style={{ position: "sticky", top: 0, zIndex: 2 }}>
                <tr>
                  <SortTh label="Name"     col="name"     sort={sort} onSort={onSort} />
                  <SortTh label="Language" col="language" sort={sort} onSort={onSort} />
                  <SortTh label="Status"   col="status"   sort={sort} onSort={onSort} />
                  <SortTh label="Duration" col="duration" sort={sort} onSort={onSort} />
                  <th style={{
                    padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 600,
                    color: "var(--text-muted,rgba(255,255,255,0.4))",
                    borderBottom: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(0,0,0,0.2)",
                  }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((v, idx) => {
                  const status  = getStatus(v);
                  const training = status === "training";
                  const trained  = status === "trained";
                  const prog     = getProgress(v.voice_id);

                  return (
                    <tr
                      key={v.voice_id}
                      style={{
                        background: idx % 2 === 0 ? "rgba(255,255,255,0.01)" : "transparent",
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(109,159,55,0.05)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = idx % 2 === 0 ? "rgba(255,255,255,0.01)" : "transparent")}
                    >
                      {/* Name */}
                      <td style={{ padding: "11px 12px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary,#e8e8e8)" }}>
                          {v.name || v.voice_id}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--text-faint,rgba(255,255,255,0.25))", marginTop: 1, fontFamily: "monospace" }}>
                          {v.voice_id.slice(0, 12)}…
                        </div>
                      </td>

                      {/* Language */}
                      <td style={{ padding: "11px 12px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                        {v.language ? (
                          <span style={{
                            fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 4,
                            background: "rgba(255,255,255,0.06)",
                            border: "1px solid rgba(255,255,255,0.1)",
                            color: "var(--text-secondary,rgba(255,255,255,0.65))",
                          }}>
                            {v.language.toUpperCase()}
                          </span>
                        ) : (
                          <span style={{ color: "var(--text-faint,rgba(255,255,255,0.25))", fontSize: 11 }}>—</span>
                        )}
                      </td>

                      {/* Status */}
                      <td style={{ padding: "11px 12px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                        <StatusBadge status={status} />
                      </td>

                      {/* Duration */}
                      <td style={{ padding: "11px 12px", borderBottom: "1px solid rgba(255,255,255,0.05)", color: "var(--text-secondary,rgba(255,255,255,0.65))", fontSize: 12 }}>
                        {v.sample_duration_ms ? `${(v.sample_duration_ms / 1000).toFixed(1)}s` : "—"}
                        {v.embedding_dim ? (
                          <div style={{ fontSize: 10, color: "var(--text-faint,rgba(255,255,255,0.25))", marginTop: 1 }}>
                            {v.embedding_dim}d
                          </div>
                        ) : null}
                      </td>

                      {/* Actions */}
                      <td style={{ padding: "11px 12px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                        {training ? (
                          /* ── Progress bar row ── */
                          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 220 }}>
                            <InlineBar progress={prog?.progress ?? 0} message={prog?.message ?? "Preparing…"} />
                            <IBtn onClick={() => handleDelete(v)} title="Cancel training & delete" danger>
                              <X size={11} />
                            </IBtn>
                          </div>
                        ) : (
                          /* ── Normal action buttons ── */
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <IBtn
                              onClick={() => handlePlay(v.voice_id)}
                              title={playingId === v.voice_id ? "Stop" : "Play sample"}
                              active={playingId === v.voice_id}
                            >
                              {audioLoading === v.voice_id
                                ? <div className="vm-spinner" style={{ width: 11, height: 11 }} />
                                : playingId === v.voice_id
                                  ? <Pause size={12} />
                                  : <Play size={12} />}
                            </IBtn>
                            <IBtn
                              onClick={() => handleDownload(v.voice_id, v.name || v.voice_id)}
                              title="Download sample"
                            >
                              {downloadingId === v.voice_id
                                ? <div className="vm-spinner" style={{ width: 11, height: 11 }} />
                                : <Download size={12} />}
                            </IBtn>
                            <button
                              onClick={() => handleTrain(v)}
                              disabled={optimizingId === v.voice_id}
                              title={trained ? "Re-train this voice" : "Train this voice"}
                              style={{
                                background: trained
                                  ? "rgba(109,159,55,0.12)"
                                  : "rgba(255,255,255,0.04)",
                                border: `1px solid ${trained ? "rgba(109,159,55,0.35)" : "rgba(255,255,255,0.12)"}`,
                                borderRadius: 5, padding: "4px 10px",
                                color: trained ? "var(--bamboo-400,#8cb856)" : "var(--text-muted,rgba(255,255,255,0.5))",
                                fontSize: 11, fontWeight: 600, cursor: "pointer",
                                opacity: optimizingId === v.voice_id ? 0.4 : 1,
                              }}
                            >
                              {trained ? "Re-train" : "Train"}
                            </button>
                            <IBtn onClick={() => handleDelete(v)} title="Delete voice" danger>
                              <Trash2 size={12} />
                            </IBtn>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div style={{
          padding: "10px 20px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 11, color: "var(--text-faint,rgba(255,255,255,0.25))" }}>
            {filtered.length} of {voices.length} voices
            {(search || langFilter || statusFilter !== "all") && " (filtered)"}
          </span>
          <button
            onClick={() => { setSearch(""); setLangFilter(""); setStatusFilter("all"); }}
            style={{
              background: "none", border: "none",
              color: "var(--text-faint,rgba(255,255,255,0.25))",
              fontSize: 11, cursor: "pointer",
              display: (search || langFilter || statusFilter !== "all") ? "block" : "none",
            }}
          >
            Clear filters
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
