"use client";

import { useState, useCallback } from "react";
import { Users, Trash2, Play, Pause, Download, Star } from "lucide-react";
import { notify } from "../lib/toast";
import { deleteVoice, deleteVoiceFull, type VoiceInfo } from "../lib/amt-api";
import UsageIndicator from "./UsageIndicator";
import StoragePathWidget from "./StoragePathWidget";
import VoiceLibraryModal from "./VoiceLibraryModal";
import { useVoice } from "../context/VoiceContext";
import { useClonedVoices, useInvalidateVoices } from "../hooks/useVoices";
import { useVoicePreview } from "../hooks/useVoicePreview";
import { engineLabel } from "../lib/voice-settings";
import { confirmDialog } from "./ui/ConfirmDialog";

export interface VoiceLibraryProps {
  /** The tenant's selected TTS engine — decides which store holds the clones. */
  engine?: string | null;
}

export default function VoiceLibrary({ engine = null }: VoiceLibraryProps) {
  const { defaultVoiceId, setDefaultVoice } = useVoice();
  const isCloudGpu = !engine || engine === "shielva";
  const engineName = engine ? engineLabel(engine) : "the platform default engine";
  const { voices, isLoading, isError } = useClonedVoices(engine);
  const invalidateVoices = useInvalidateVoices();
  const total = voices.length;

  const [downloadingVoiceId, setDownloadingVoiceId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [langFilter, setLangFilter] = useState<string>("");
  const [showModal, setShowModal] = useState(false);
  /** Ids removed locally so the row disappears the moment the server confirms,
   *  instead of lingering until the refetch lands. `voices` comes from React
   *  Query, so it cannot be mutated directly. */
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const refresh = useCallback(() => { invalidateVoices(); }, [invalidateVoices]);

  /**
   * Every voice is playable, whichever store holds it.
   *
   * A voice cloned on our own stack plays its stored reference clip. A voice
   * cloned at a vendor has no clip to fetch — the vendor keeps the model — so
   * the preview is synthesized with that voice instead. Hiding the button
   * there (which is what this did) left a cloned voice you could not hear at
   * all, and hearing it is the whole point of having cloned it.
   */
  const {
    playingId: playingVoiceId,
    loadingId: voiceAudioLoading,
    toggle: previewVoice,
    stop: stopPreview,
    cachedUrl,
  } = useVoicePreview();

  const handleVoicePlay = (v: VoiceInfo) =>
    previewVoice({ id: v.voice_id, fromClip: isCloudGpu, language: v.language || "en" });

  const handleVoiceDownload = async (v: VoiceInfo) => {
    setDownloadingVoiceId(v.voice_id);
    try {
      // Reuse whatever the preview already produced rather than fetching or
      // synthesizing a second copy of the same audio.
      let url = cachedUrl(v.voice_id, v.language || "en");
      if (!url) {
        await previewVoice({ id: v.voice_id, fromClip: isCloudGpu, language: v.language || "en" });
        stopPreview();
        url = cachedUrl(v.voice_id, v.language || "en");
      }
      if (!url) return; // previewVoice already reported why
      const a = document.createElement("a");
      a.href = url;
      a.download = `${v.name || v.voice_id}.wav`;
      a.click();
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

  /** Release anything this voice holds locally before the row disappears.
   *  Cached preview audio is owned by useVoicePreview and revoked on unmount. */
  const releaseLocalState = (id: string) => {
    if (playingVoiceId === id) stopPreview();
    if (defaultVoiceId === id) setDefaultVoice(null);
  };

  /**
   * Remove one voice from both stores.
   *
   * Both calls previously carried `.catch(() => {})`, which meant the outer
   * try/catch could never fire: a delete that failed on the server still
   * reported "deleted" and the row came back on the next refresh. Failures are
   * propagated now — the two stores are still deleted in parallel, but
   * `allSettled` lets us fail only when BOTH legs fail, so a voice missing from
   * one store (already half-deleted) still resolves cleanly.
   */
  const removeVoice = async (id: string): Promise<void> => {
    const voiceName = voices.find((v) => v.voice_id === id)?.name;
    const results = await Promise.allSettled([deleteVoiceFull(id, voiceName), deleteVoice(id)]);
    if (results.every((r) => r.status === "rejected")) {
      throw (results[0] as PromiseRejectedResult).reason;
    }
  };

  const reportDeleteError = (err: unknown, fallback: string) => {
    const quota = (err as { quota?: unknown })?.quota;
    if (quota) notify.quotaExceeded(quota as Parameters<typeof notify.quotaExceeded>[0]);
    else notify.error("Delete failed", err instanceof Error ? err.message : fallback);
  };

  const markRemoved = (id: string) => {
    setRemovedIds((prev) => new Set(prev).add(id));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const runDeleteOne = async (id: string, label: string) => {
    if (deletingId === id) return;
    setDeletingId(id);
    releaseLocalState(id);
    try {
      await removeVoice(id);
      // Drop the row immediately. Waiting on refresh() left the deleted voice
      // on screen for a full round-trip, which reads as "nothing happened".
      markRemoved(id);
      notify.success(`Voice "${label}" deleted`);
      refresh();
    } catch (err) {
      reportDeleteError(err, "Could not remove voice.");
    } finally {
      setDeletingId(null);
    }
  };

  /** Bulk path — used by both "Delete selected" and "Delete all". */
  const runDeleteMany = async (ids: string[], what: string) => {
    if (!ids.length || bulkBusy) return;
    setBulkBusy(true);
    const failed: string[] = [];
    // Sequential, not parallel: these hit two delete endpoints each, and firing
    // a whole library at once is what makes the backend rate-limit and return
    // partial failures that look random to the user.
    for (const id of ids) {
      releaseLocalState(id);
      try {
        await removeVoice(id);
        markRemoved(id);
      } catch {
        failed.push(voices.find((v) => v.voice_id === id)?.name || id);
      }
    }
    setSelected(new Set());
    setBulkBusy(false);

    const done = ids.length - failed.length;
    if (failed.length === 0) notify.success(`${done} ${what} deleted`);
    else if (done === 0) notify.error("Delete failed", `Could not remove ${failed.length} ${what}.`);
    else notify.error(`${done} deleted, ${failed.length} failed`, `Could not remove: ${failed.join(", ")}`);
    refresh();
  };

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** Every destructive action routes through the shared confirm dialog. */
  const askDeleteOne = async (id: string, label: string) => {
    const ok = await confirmDialog({
      title: `Delete “${label}”?`,
      message: "The reference clip and any cloned model are removed from every store. This cannot be undone.",
      danger: true,
    });
    if (ok) await runDeleteOne(id, label);
  };

  const askDeleteMany = async (ids: string[], title: string) => {
    const ok = await confirmDialog({
      title,
      message: "The reference clips and any cloned models are removed from every store. This cannot be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok) await runDeleteMany(ids, "voices");
  };

  const shownVoices = voices.filter(
    (v) => !removedIds.has(v.voice_id) && (!langFilter || v.language === langFilter),
  );
  const selectedShown = shownVoices.filter((v) => selected.has(v.voice_id));
  const allShownSelected = shownVoices.length > 0 && selectedShown.length === shownVoices.length;

  return (
    <div className="vm-card">
      <div className="vm-card-header">
        <div className="vm-card-icon">
          <Users size={18} strokeWidth={2} />
        </div>
        <div>
          <div className="vm-card-title">Voice Library</div>
          <div className="vm-card-subtitle">
            {isCloudGpu
              ? "Your cloned reference voices"
              : `Your voices cloned on ${engineName}`}
          </div>
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

      {/* R2 holds the reference clips our OWN stack stores. A vendor-side clone
          never touches our storage, so showing the R2 panel there would claim
          something untrue about where the voice lives. */}
      {isCloudGpu ? (
        <StoragePathWidget />
      ) : (
        <div
          style={{
            fontSize: 11, lineHeight: 1.5, color: "var(--text-muted)",
            padding: "8px 10px", marginBottom: 8, borderRadius: 8,
            border: "1px solid var(--border-subtle)", background: "var(--surface-subtle)",
          }}
        >
          These voices live in your {engineName} account, not in Shielva storage — {engineName}
          {" "}holds the model and we only keep the id. Switch to the Cloud GPU engine in{" "}
          <a href="/settings">Settings</a> to keep reference clips in your own R2 bucket.
        </div>
      )}

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

      {!isLoading && shownVoices.length > 0 && (
        <div className="vm-vl-bulk">
          <label className="vm-vl-check">
            <input
              type="checkbox"
              checked={allShownSelected}
              onChange={() =>
                setSelected(allShownSelected ? new Set() : new Set(shownVoices.map((v) => v.voice_id)))
              }
              aria-label={allShownSelected ? "Clear selection" : "Select all voices"}
            />
            <span>{selectedShown.length > 0 ? `${selectedShown.length} selected` : "Select all"}</span>
          </label>
          <div className="vm-vl-bulk-actions">
            {bulkBusy && <div className="vm-spinner" style={{ width: 13, height: 13 }} />}
            <button
              type="button"
              className="vm-vl-btn"
              disabled={bulkBusy || selectedShown.length === 0}
              onClick={() =>
                void askDeleteMany(
                  selectedShown.map((v) => v.voice_id),
                  `Delete ${selectedShown.length} selected ${selectedShown.length === 1 ? "voice" : "voices"}?`,
                )
              }
            >
              Delete selected
            </button>
            <button
              type="button"
              className="vm-vl-btn vm-vl-btn--danger"
              disabled={bulkBusy}
              onClick={() =>
                void askDeleteMany(
                  shownVoices.map((v) => v.voice_id),
                  `Delete all ${shownVoices.length} ${shownVoices.length === 1 ? "voice" : "voices"}?`,
                )
              }
            >
              Delete all
            </button>
          </div>
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
                  ? `Voices could not be loaded from ${engineName} right now. Clone a voice to get started.`
                  : `Use “Clone a voice” to add a ~10-second reference. It is cloned on ${engineName} and ready immediately — no training.`}
            </div>
          </div>
        )}

        {!isLoading && shownVoices.map((v: VoiceInfo) => {
          const isDefault = defaultVoiceId === v.voice_id;
          return (
            <div key={v.voice_id} className="vm-voice-item" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                className="vm-vl-row-check"
                checked={selected.has(v.voice_id)}
                onChange={() => toggleSelected(v.voice_id)}
                aria-label={`Select ${v.name || v.voice_id}`}
              />
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
                  onClick={() => void handleVoicePlay(v)}
                  aria-label={playingVoiceId === v.voice_id ? "Stop playback" : "Play sample"}
                  title={
                    playingVoiceId === v.voice_id
                      ? "Stop playback"
                      : isCloudGpu
                        ? "Play the reference clip"
                        : `Hear this voice — ${engineName} speaks a short sample`
                  }
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
                  onClick={() => void handleVoiceDownload(v)}
                  aria-label="Download voice sample"
                  title={isCloudGpu ? "Download the reference clip" : "Download a sample of this voice"}
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
                {/* Delete goes to the cloud-GPU stores. There is no vendor-side
                    delete route yet, so on a hosted engine it would report
                    success and leave the voice in place — disabled until that
                    route exists. */}
                <button
                  className="vm-voice-delete"
                  onClick={() => void askDeleteOne(v.voice_id, v.name || v.voice_id)}
                  disabled={deletingId === v.voice_id || bulkBusy || !isCloudGpu}
                  aria-label="Delete voice"
                  title={isCloudGpu ? "Delete voice" : `Delete this voice in your ${engineName} account`}
                  style={!isCloudGpu ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
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
        /* ── bulk selection + in-place confirm ─────────────────────────── */
        .vm-vl-bulk {
          display: flex; align-items: center; justify-content: space-between;
          gap: 10px; flex-wrap: wrap;
          padding: 8px 2px 10px;
        }
        .vm-vl-check { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; cursor: pointer; }
        .vm-vl-bulk-actions { display: flex; align-items: center; gap: 6px; }
        .vm-vl-row-check { flex-shrink: 0; cursor: pointer; }
        .vm-vl-btn {
          height: 32px; padding: 0 12px; border-radius: 7px; font-size: 13px;
          border: 1px solid var(--border-subtle); background: var(--surface);
          color: var(--text-primary); cursor: pointer;
          transition: border-color 0.15s ease, color 0.15s ease;
        }
        .vm-vl-btn:hover:not(:disabled) { border-color: var(--border-strong, var(--border)); }
        .vm-vl-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .vm-vl-btn--danger { color: #c0392b; border-color: #c0392b55; }

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
