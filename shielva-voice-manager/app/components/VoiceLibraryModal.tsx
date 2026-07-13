"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { X, Play, Pause, Download, Trash2, Star, Search, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { notify } from "../lib/toast";
import { deleteVoice, deleteVoiceFull, fetchVoiceAudio, type VoiceInfo } from "../lib/amt-api";
import { useVoice } from "../context/VoiceContext";
import { useVoices, useInvalidateVoices } from "../hooks/useVoices";

// ── Types ─────────────────────────────────────────────────────────────────────
type SortKey = "name" | "language" | "duration";
type SortDir = "asc" | "desc";

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
          ? sort.dir === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />
          : <ChevronsUpDown size={11} style={{ opacity: 0.35 }} />}
      </span>
    </th>
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
      aria-label={title}
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
}

export default function VoiceLibraryModal({ onClose }: Props) {
  const { defaultVoiceId, setDefaultVoice } = useVoice();
  const { voices, isLoading } = useVoices();
  const invalidateVoices = useInvalidateVoices();
  const refresh = useCallback(() => invalidateVoices(), [invalidateVoices]);

  // ── Filters / sort ─────────────────────────────────────────────────────────
  const [search, setSearch]         = useState("");
  const [langFilter, setLangFilter] = useState("");
  const [sort, setSort]             = useState<{ key: SortKey; dir: SortDir }>({ key: "name", dir: "asc" });

  // ── Per-voice state ────────────────────────────────────────────────────────
  const [playingId, setPlayingId]         = useState<string | null>(null);
  const [audioLoading, setAudioLoading]   = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId]       = useState<string | null>(null);

  const audioUrls = useRef<Record<string, string>>({});
  const audioEl   = useRef<HTMLAudioElement | null>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    const urls = audioUrls.current;
    return () => { Object.values(urls).forEach((u) => URL.revokeObjectURL(u)); };
  }, []);

  const onSort = (col: SortKey) =>
    setSort((s) => s.key === col ? { key: col, dir: s.dir === "asc" ? "desc" : "asc" } : { key: col, dir: "asc" });

  // ── Filtered + sorted voices ───────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = voices.filter((v) => {
      const q = search.trim().toLowerCase();
      if (q && !(v.name || v.voice_id).toLowerCase().includes(q)) return false;
      if (langFilter && v.language !== langFilter) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      let av: string | number = "";
      let bv: string | number = "";
      if (sort.key === "name")     { av = (a.name || a.voice_id).toLowerCase(); bv = (b.name || b.voice_id).toLowerCase(); }
      if (sort.key === "language") { av = a.language || ""; bv = b.language || ""; }
      if (sort.key === "duration") { av = a.sample_duration_ms ?? 0; bv = b.sample_duration_ms ?? 0; }
      if (av < bv) return sort.dir === "asc" ? -1 : 1;
      if (av > bv) return sort.dir === "asc" ? 1 : -1;
      return 0;
    });
    return list;
  }, [voices, search, langFilter, sort]);

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
      } catch (err) {
        setAudioLoading(null);
        notify.warning((err as Error)?.message === "no_audio" ? "No audio sample" : "Playback failed");
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
    } catch (err) {
      notify.error("Download failed", (err as Error)?.message === "no_audio" ? "No audio available." : String(err));
    } finally { setDownloadingId(null); }
  };

  const handleSetDefault = (v: VoiceInfo) => {
    if (defaultVoiceId === v.voice_id) {
      setDefaultVoice(null);
      notify.info("Default cleared", "Text to Speech will use the built-in IndicF5 voice.");
    } else {
      setDefaultVoice(v.voice_id);
      notify.success(`"${v.name || v.voice_id}" set as default`);
    }
  };

  const handleDelete = async (v: VoiceInfo) => {
    if (deletingId === v.voice_id) return;
    setDeletingId(v.voice_id);
    if (playingId === v.voice_id) { audioEl.current?.pause(); setPlayingId(null); }
    if (audioUrls.current[v.voice_id]) { URL.revokeObjectURL(audioUrls.current[v.voice_id]); delete audioUrls.current[v.voice_id]; }
    if (defaultVoiceId === v.voice_id) setDefaultVoice(null);
    try {
      await Promise.all([
        deleteVoiceFull(v.voice_id, v.name).catch(() => {}),
        deleteVoice(v.voice_id).catch(() => {}),
      ]);
      notify.success(`"${v.name || v.voice_id}" deleted`);
      refresh();
    } catch (err) {
      notify.error("Delete failed", err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingId(null);
    }
  };

  // ── All unique languages in the list ──────────────────────────────────────
  const langs = useMemo(() => [...new Set(voices.map((v) => v.language).filter(Boolean))].sort(), [voices]);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.65)",
        backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "20px 16px",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Voice Library"
        style={{
          background: "linear-gradient(145deg,rgba(14,14,14,0.97),rgba(8,8,8,0.99))",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 14, width: "100%", maxWidth: 860, maxHeight: "88vh",
          display: "flex", flexDirection: "column", overflow: "hidden",
          boxShadow: "0 32px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(109,159,55,0.08)",
        }}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={{
          padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.08)",
          display: "flex", alignItems: "center", gap: 12, flexShrink: 0,
        }}>
          <div style={{ flex: "0 0 auto" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary,#e8e8e8)" }}>Voice Library</div>
            <div style={{ fontSize: 11, color: "var(--text-muted,rgba(255,255,255,0.4))", marginTop: 1 }}>
              {voices.length} {voices.length === 1 ? "voice" : "voices"}
            </div>
          </div>

          {/* Search */}
          <div style={{ flex: 1, position: "relative" }}>
            <Search size={12} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.3)", pointerEvents: "none" }} />
            <label htmlFor="vlm-search" className="vm-visually-hidden">Search voices</label>
            <input
              id="vlm-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search voices…"
              style={{
                width: "100%", boxSizing: "border-box",
                background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 7, padding: "7px 10px 7px 28px",
                color: "var(--text-primary,#e8e8e8)", fontSize: 12, outline: "none",
              }}
            />
          </div>

          {/* Language filter */}
          <label htmlFor="vlm-lang" className="vm-visually-hidden">Filter by language</label>
          <select
            id="vlm-lang"
            value={langFilter}
            onChange={(e) => setLangFilter(e.target.value)}
            style={{
              background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 7, padding: "7px 10px", color: "var(--text-primary,#e8e8e8)",
              fontSize: 12, outline: "none", cursor: "pointer",
            }}
          >
            <option value="">All languages</option>
            {langs.map((l) => <option key={l} value={l as string}>{(l as string).toUpperCase()}</option>)}
          </select>

          {/* Close */}
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 7, padding: "7px 9px", color: "var(--text-muted,rgba(255,255,255,0.4))",
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
              {search || langFilter ? "No voices match the current filters" : "No voices yet — clone a voice to get started"}
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead style={{ position: "sticky", top: 0, zIndex: 2 }}>
                <tr>
                  <SortTh label="Name"     col="name"     sort={sort} onSort={onSort} />
                  <SortTh label="Language" col="language" sort={sort} onSort={onSort} />
                  <SortTh label="Duration" col="duration" sort={sort} onSort={onSort} />
                  <th style={{
                    padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 600,
                    color: "var(--text-muted,rgba(255,255,255,0.4))",
                    borderBottom: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.2)",
                  }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((v, idx) => {
                  const isDefault = defaultVoiceId === v.voice_id;
                  return (
                    <tr
                      key={v.voice_id}
                      style={{ background: idx % 2 === 0 ? "rgba(255,255,255,0.01)" : "transparent" }}
                    >
                      {/* Name */}
                      <td style={{ padding: "11px 12px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary,#e8e8e8)", display: "flex", alignItems: "center", gap: 6 }}>
                          {v.name || v.voice_id}
                          {isDefault && (
                            <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 3, background: "rgba(109,159,55,0.18)", border: "1px solid rgba(109,159,55,0.4)", color: "var(--bamboo-400,#8cb856)" }}>
                              default
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--text-faint,rgba(255,255,255,0.25))", marginTop: 1, fontFamily: "monospace" }}>
                          {v.voice_id.slice(0, 12)}…
                        </div>
                      </td>

                      {/* Language */}
                      <td style={{ padding: "11px 12px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                        {v.language ? (
                          <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 4, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "var(--text-secondary,rgba(255,255,255,0.65))" }}>
                            {v.language.toUpperCase()}
                          </span>
                        ) : (
                          <span style={{ color: "var(--text-faint,rgba(255,255,255,0.25))", fontSize: 11 }}>—</span>
                        )}
                      </td>

                      {/* Duration */}
                      <td style={{ padding: "11px 12px", borderBottom: "1px solid rgba(255,255,255,0.05)", color: "var(--text-secondary,rgba(255,255,255,0.65))", fontSize: 12 }}>
                        {v.sample_duration_ms ? `${(v.sample_duration_ms / 1000).toFixed(1)}s` : "—"}
                      </td>

                      {/* Actions */}
                      <td style={{ padding: "11px 12px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <IBtn onClick={() => handlePlay(v.voice_id)} title={playingId === v.voice_id ? "Stop" : "Play sample"} active={playingId === v.voice_id}>
                            {audioLoading === v.voice_id
                              ? <div className="vm-spinner" style={{ width: 11, height: 11 }} />
                              : playingId === v.voice_id ? <Pause size={12} /> : <Play size={12} />}
                          </IBtn>
                          <IBtn onClick={() => handleDownload(v.voice_id, v.name || v.voice_id)} title="Download sample">
                            {downloadingId === v.voice_id ? <div className="vm-spinner" style={{ width: 11, height: 11 }} /> : <Download size={12} />}
                          </IBtn>
                          <IBtn onClick={() => handleSetDefault(v)} title={isDefault ? "Remove as default" : "Set as default"} active={isDefault}>
                            <Star size={12} fill={isDefault ? "currentColor" : "none"} />
                          </IBtn>
                          <IBtn onClick={() => handleDelete(v)} title="Delete voice" danger disabled={deletingId === v.voice_id}>
                            {deletingId === v.voice_id ? <div className="vm-spinner" style={{ width: 11, height: 11 }} /> : <Trash2 size={12} />}
                          </IBtn>
                        </div>
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
          padding: "10px 20px", borderTop: "1px solid rgba(255,255,255,0.06)",
          display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0,
        }}>
          <span style={{ fontSize: 11, color: "var(--text-faint,rgba(255,255,255,0.25))" }}>
            {filtered.length} of {voices.length} voices{(search || langFilter) && " (filtered)"}
          </span>
          {(search || langFilter) && (
            <button
              onClick={() => { setSearch(""); setLangFilter(""); }}
              style={{ background: "none", border: "none", color: "var(--text-faint,rgba(255,255,255,0.25))", fontSize: 11, cursor: "pointer" }}
            >
              Clear filters
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
