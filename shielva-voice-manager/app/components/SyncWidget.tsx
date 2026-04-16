"use client";

import { useState, useCallback } from "react";
import { RefreshCw, Check, AlertCircle } from "lucide-react";
import { syncToLocal, type SyncResult } from "../lib/amt-api";
import { notify } from "../lib/toast";

type SyncStatus = "idle" | "syncing" | "done" | "error";

export default function SyncWidget() {
  const [status, setStatus]   = useState<SyncStatus>("idle");
  const [result, setResult]   = useState<SyncResult | null>(null);
  const [showTip, setShowTip] = useState(false);

  const run = useCallback(async () => {
    if (status === "syncing") return;
    setStatus("syncing");
    setResult(null);
    try {
      const r = await syncToLocal();
      setResult(r);
      setStatus("done");
      if (r.synced > 0) {
        notify.success(
          `Sync complete`,
          `${r.synced} file${r.synced !== 1 ? "s" : ""} downloaded · ${r.already_local} already local`,
        );
      } else if (r.already_local > 0) {
        notify.info("Already in sync", `${r.already_local} local file${r.already_local !== 1 ? "s" : ""} up-to-date`);
      } else if (r.total === 0) {
        notify.info("Nothing to sync yet", "Generate some audio first — files will appear here after processing.");
      } else if (r.cloud_only > 0) {
        notify.info("Files in cloud only", "Local paths not configured or directories not found — configure Storage in settings.");
      } else {
        notify.info("Sync complete", "No files needed downloading.");
      }
      // Fade back to idle after 4 s
      setTimeout(() => setStatus("idle"), 4000);
    } catch (e) {
      setStatus("error");
      notify.error("Sync failed", String(e));
      setTimeout(() => setStatus("idle"), 5000);
    }
  }, [status]);

  const icon = status === "syncing" ? (
    <RefreshCw size={13} style={{ animation: "spin 0.9s linear infinite" }} />
  ) : status === "done" ? (
    <Check size={13} />
  ) : status === "error" ? (
    <AlertCircle size={13} />
  ) : (
    <RefreshCw size={13} />
  );

  const label = status === "syncing" ? "Syncing…"
    : status === "done"   ? (result ? `Synced ${result.synced}` : "Synced")
    : status === "error"  ? "Sync failed"
    : "Sync";

  const color = status === "done"  ? "var(--bamboo-400, #8ab83a)"
    : status === "error" ? "#f87171"
    : "var(--text-muted, #888)";

  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <button
        onClick={run}
        disabled={status === "syncing"}
        onMouseEnter={() => setShowTip(true)}
        onMouseLeave={() => setShowTip(false)}
        title="Sync all features — validates MongoDB metadata against local files and downloads any missing files from R2"
        style={{
          display:     "flex",
          alignItems:  "center",
          gap:         5,
          padding:     "4px 10px",
          borderRadius: 6,
          border:      `1px solid ${status === "done" ? "rgba(138,184,58,0.4)" : status === "error" ? "rgba(248,113,113,0.4)" : "var(--border-subtle, rgba(255,255,255,0.08))"}`,
          background:  status === "done" ? "rgba(138,184,58,0.08)" : status === "error" ? "rgba(248,113,113,0.08)" : "transparent",
          color,
          cursor:      status === "syncing" ? "default" : "pointer",
          fontSize:    12,
          fontWeight:  status === "done" ? 600 : 400,
          transition:  "all 0.2s",
          whiteSpace:  "nowrap",
        }}
      >
        {icon}
        {label}
        {result && result.failed.length > 0 && (
          <span style={{
            background: "#f87171", color: "#fff",
            borderRadius: 99, fontSize: 9, padding: "1px 5px", marginLeft: 2, fontWeight: 700,
          }}>
            {result.failed.length} failed
          </span>
        )}
      </button>

      {/* Tooltip */}
      {showTip && status === "idle" && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", right: 0,
          background: "var(--surface, #111)",
          border: "1px solid var(--border, #1a1a1a)",
          borderRadius: 6, padding: "7px 10px",
          fontSize: 11, color: "var(--text-muted)",
          whiteSpace: "nowrap", zIndex: 200, pointerEvents: "none",
          boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        }}>
          Validate MongoDB metadata vs local files<br />
          <span style={{ color: "var(--bamboo-400)", fontSize: 10 }}>Downloads missing R2 files → local storage</span>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
