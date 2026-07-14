"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Users, Trash2, Play, Pause, Download, Star } from "lucide-react";
import { notify } from "../lib/toast";
import { deleteVoice, deleteVoiceFull, fetchVoiceAudio, type VoiceInfo } from "../lib/amt-api";
import UsageIndicator from "./UsageIndicator";
import StoragePathWidget from "./StoragePathWidget";
import VoiceLibraryModal from "./VoiceLibraryModal";
import { useVoice } from "../context/VoiceContext";
import { useVoices, useInvalidateVoices } from "../hooks/useVoices";

export default function VoiceLibrary() {
  const { defaultVoiceId, setDefaultVoice } = useVoice();
  const { voices, isLoading, isError } = useVoices();
  const invalidateVoices = useInvalidateVoices();
  const total = voices.length;

  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [voiceAudioLoading, setVoiceAudioLoading] = useState<string | null>(null);
  const [downloadingVoiceId, setDownloadingVoiceId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [langFilter, setLangFilter] = useState<string>("");
  const [showModal, setShowModal] = useState(false);

  const voiceAudioUrls = useRef<Record<string, string>>({});
  const voiceAudioEl = useRef<HTMLAudioElement | null>(null);

  const refresh = useCallback(() => { invalidateVoices(); }, [invalidateVoices]);

  useEffect(() => {
    const urls = voiceAudioUrls.current;
    return () => { Object.values(urls).forEach((u) => URL.revokeObjectURL(u)); };
  }, []);

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
      } catch (err) {
        setVoiceAudioLoading(null);
        if ((err as Error)?.message === "no_audio") notify.warning("No audio sample", "This voice has no stored reference clip.");
        else notify.error("Playback failed", "Could not load the voice sample.");
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
    } catch (err) {
      if ((err as Error)?.message === "no_audio") notify.warning("No audio sample", "This voice has no stored reference clip.");
      else notify.error("Download failed", "Could not fetch the voice sample.");
    } finally {
      setDownloadingVoiceId(null);
    }
  };

  const handleSetDefault = (voiceId: string) => {
    if (defaultVoiceId === voiceId) {
      setDefaultVoice(null);
      notify.info("Default cleared", "Text to Speech will use the built-in Chatterbox voice.");
    } else {
      setDefaultVoice(voiceId);
      const name = voices.find((v) => v.voice_id === voiceId)?.name || voiceId;
      notify.success(`"${name}" set as default`, "It will be pre-selected in the voice pickers.");
    }
  };

  // ── Delete ─────────────────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    if (deletingId === id) return;
    setDeletingId(id);
    if (playingVoiceId === id) {
      voiceAudioEl.current?.pause();
      setPlayingVoiceId(null);
    }
    if (voiceAudioUrls.current[id]) {
      URL.revokeObjectURL(voiceAudioUrls.current[id]);
      delete voiceAudioUrls.current[id];
    }
    if (defaultVoiceId === id) setDefaultVoice(null);
    const label = voices.find((v) => v.voice_id === id)?.name || id;
    const voiceName = voices.find((v) => v.voice_id === id)?.name;
    try {
      await Promise.all([
        deleteVoiceFull(id, voiceName).catch(() => {}),
        deleteVoice(id).catch(() => {}),
      ]);
      notify.success(`Voice "${label}" deleted`);
      refresh();
    } catch (err) {
      const quota = (err as { quota?: unknown })?.quota;
      if (quota) notify.quotaExceeded(quota as Parameters<typeof notify.quotaExceeded>[0]);
      else notify.error("Delete failed", err instanceof Error ? err.message : "Could not remove voice.");
    } finally {
      setDeletingId(null);
    }
  };

  const shownVoices = voices.filter((v) => !langFilter || v.language === langFilter);

  return (
    <div className="vm-card">
      <div className="vm-card-header">
        <div className="vm-card-icon">
          <Users size={18} strokeWidth={2} />
        </div>
        <div>
          <div className="vm-card-title">Voice Library</div>
          <div className="vm-card-subtitle">Your cloned reference voices</div>
        </div>
        <UsageIndicator resource="voice" />
        <span className="vm-tag vm-tag-gray">
          {total} {total === 1 ? "voice" : "voices"}
        </span>
        {total > 0 && (
          <button onClick={() => setShowModal(true)} className="vm-vl-viewall">
            View All
          </button>
        )}
      </div>

      {showModal && <VoiceLibraryModal onClose={() => setShowModal(false)} />}

      <StoragePathWidget />

      {voices.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <label htmlFor="vl-lang-filter" className="vm-visually-hidden">Filter by language</label>
          <select
            id="vl-lang-filter"
            value={langFilter}
            onChange={(e) => setLangFilter(e.target.value)}
            className="vm-vl-filter"
          >
            <option value="">All languages</option>
            {[...new Set(voices.map((v) => v.language).filter(Boolean))].sort().map((l) => (
              <option key={l} value={l as string}>{(l as string).toUpperCase()}</option>
            ))}
          </select>
        </div>
      )}

      <div className="vm-voice-list">
        {isLoading && (
          <div style={{ textAlign: "center", padding: 20 }}>
            <div className="vm-spinner" style={{ margin: "0 auto" }} />
          </div>
        )}

        {!isLoading && shownVoices.length === 0 && (
          <div className="vm-vl-empty">
            <div className="vm-vl-empty-icon">
              <Users size={28} strokeWidth={1.5} />
            </div>
            <div className="vm-vl-empty-title">
              {langFilter ? "No voices in this language" : "No voices yet"}
            </div>
            <div className="vm-vl-empty-sub">
              {langFilter
                ? "Clear the filter or clone a voice in this language."
                : isError
                  ? "Voices could not be loaded right now. Clone a voice to get started."
                  : "Use “Clone a voice” to add a ~10-second reference. It is ready immediately — no training."}
            </div>
          </div>
        )}

        {!isLoading && shownVoices.map((v: VoiceInfo) => {
          const isDefault = defaultVoiceId === v.voice_id;
          return (
            <div key={v.voice_id} className="vm-voice-item" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
                <div className="vm-voice-name" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {v.name || v.voice_id}
                  </span>
                  {isDefault && <span className="vm-vl-default-tag">default</span>}
                </div>
                <div className="vm-voice-meta" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  {v.sample_duration_ms ? <span>{(v.sample_duration_ms / 1000).toFixed(1)}s</span> : null}
                  {v.language && <span className="vm-vl-lang">{v.language.toUpperCase()}</span>}
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                <button
                  className="vm-voice-delete"
                  onClick={() => handleVoicePlay(v.voice_id)}
                  aria-label={playingVoiceId === v.voice_id ? "Stop playback" : "Play sample"}
                  title={playingVoiceId === v.voice_id ? "Stop playback" : "Play sample"}
                  style={{ color: playingVoiceId === v.voice_id ? "var(--bamboo-400)" : undefined }}
                >
                  {voiceAudioLoading === v.voice_id
                    ? <div className="vm-spinner" style={{ width: 12, height: 12 }} />
                    : playingVoiceId === v.voice_id
                      ? <Pause size={14} strokeWidth={2} />
                      : <Play size={14} strokeWidth={2} />}
                </button>
                <button
                  className="vm-voice-delete"
                  onClick={() => handleVoiceDownload(v.voice_id)}
                  aria-label="Download voice sample"
                  title="Download voice sample"
                >
                  {downloadingVoiceId === v.voice_id
                    ? <div className="vm-spinner" style={{ width: 12, height: 12 }} />
                    : <Download size={14} strokeWidth={2} />}
                </button>
                <button
                  className="vm-voice-delete"
                  onClick={() => handleSetDefault(v.voice_id)}
                  aria-label={isDefault ? "Remove as default voice" : "Set as default voice"}
                  aria-pressed={isDefault}
                  title={isDefault ? "Remove as default voice" : "Set as default voice"}
                  style={{ color: isDefault ? "var(--bamboo-400)" : undefined }}
                >
                  <Star size={14} strokeWidth={2} fill={isDefault ? "currentColor" : "none"} />
                </button>
                <button
                  className="vm-voice-delete"
                  onClick={() => handleDelete(v.voice_id)}
                  disabled={deletingId === v.voice_id}
                  aria-label="Delete voice"
                  title="Delete voice"
                >
                  {deletingId === v.voice_id
                    ? <div className="vm-spinner" style={{ width: 12, height: 12 }} />
                    : <Trash2 size={14} strokeWidth={2} />}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        .vm-vl-viewall {
          margin-left: auto; background: rgba(255,255,255,0.05); border: 1px solid var(--border-subtle);
          border-radius: 6px; padding: 4px 10px; color: var(--text-muted); font-size: 11px;
          font-weight: 600; cursor: pointer; white-space: nowrap;
        }
        .vm-vl-viewall:hover { border-color: rgba(109,159,55,0.4); color: var(--bamboo-400); }
        .vm-vl-filter {
          width: 100%; background: var(--surface-subtle); border: 1px solid var(--border-subtle);
          border-radius: 6px; color: var(--text-primary); font-size: 12px; padding: 5px 8px; outline: none;
        }
        .vm-vl-lang {
          font-size: 10px; background: var(--surface-subtle); border-radius: 3px; padding: 1px 5px; color: var(--text-muted);
        }
        .vm-vl-default-tag {
          font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 3px; flex-shrink: 0;
          background: rgba(109,159,55,0.18); border: 1px solid rgba(109,159,55,0.4); color: var(--bamboo-400);
        }
        .vm-vl-empty {
          display: flex; flex-direction: column; align-items: center; text-align: center;
          padding: 28px 20px; gap: 8px;
        }
        .vm-vl-empty-icon {
          width: 52px; height: 52px; border-radius: 14px; display: flex; align-items: center; justify-content: center;
          background: rgba(109,159,55,0.08); border: 1px solid rgba(109,159,55,0.18); color: var(--bamboo-400); margin-bottom: 4px;
        }
        .vm-vl-empty-title { font-size: 13px; font-weight: 600; color: var(--text-secondary); }
        .vm-vl-empty-sub { font-size: 11.5px; color: var(--text-faint); line-height: 1.5; max-width: 280px; }
      `}</style>
    </div>
  );
}
