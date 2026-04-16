"use client";

import { useEffect, useState } from "react";
import { getStorageConfig, type StorageConfig } from "../lib/amt-api";
import { useStorage } from "../context/StorageContext";

export default function StoragePathWidget() {
  const { settings, localCacheActive, openModal } = useStorage();
  const [config, setConfig] = useState<StorageConfig | null>(null);

  useEffect(() => {
    getStorageConfig().then(setConfig).catch(() => {});
  }, []);

  const isCloud = settings.mode === "cloud";
  const localVoicePath = settings.localCacheEnabled
    ? settings.cachePaths.voice
    : settings.localPaths.voice;

  return (
    <div style={{
      background: "var(--bg-secondary)",
      border: "1px solid var(--border-primary)",
      borderRadius: 10,
      padding: "14px 16px",
      marginBottom: 16,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
          Model Storage
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {/* Mode badge */}
          <span style={{
            fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 99,
            background: isCloud ? "rgba(99,102,241,0.15)" : "rgba(20,184,166,0.15)",
            color: isCloud ? "#818cf8" : "#14B8A6",
          }}>
            {isCloud ? "Cloud (R2)" : "Local"}
          </span>
          {/* Availability badge — in cloud mode R2 is the source, local path is irrelevant */}
          {config && (
            <span style={{
              fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 99,
              background: (isCloud || config.path_exists) ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
              color: (isCloud || config.path_exists) ? "#22c55e" : "#ef4444",
            }}>
              {(isCloud || config.path_exists) ? "Available" : "Not found"}
            </span>
          )}
        </div>
      </div>

      {isCloud ? (
        /* ── Cloud mode ─────────────────────────────────────────────────────── */
        <>
          {/* R2 bucket — primary */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={{
              flex: 1, fontSize: 12, fontFamily: "monospace",
              color: "var(--text-primary)", background: "var(--bg-primary)",
              border: "1px solid var(--border-primary)", borderRadius: 6,
              padding: "6px 10px", lineHeight: 1.4,
            }}>
              R2 › {config?.rvc_models_bucket ?? "shielva-rvc-models"}
            </div>
            <span style={{
              fontSize: 11, fontWeight: 500, padding: "4px 10px", borderRadius: 6,
              background: "rgba(99,102,241,0.1)", color: "#818cf8",
              border: "1px solid rgba(99,102,241,0.2)", flexShrink: 0,
            }}>
              Primary
            </span>
          </div>

          {/* Local cache row — shown when localCacheEnabled */}
          {settings.localCacheEnabled && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{
                flex: 1, fontSize: 12, fontFamily: "monospace",
                color: "var(--text-tertiary)", background: "var(--bg-primary)",
                border: "1px solid var(--border-primary)", borderRadius: 6,
                padding: "6px 10px", lineHeight: 1.4, wordBreak: "break-all",
              }}>
                {localVoicePath || <span style={{ fontStyle: "italic" }}>no cache path set</span>}
              </div>
              <span style={{
                fontSize: 11, fontWeight: 500, padding: "4px 10px", borderRadius: 6,
                background: "rgba(20,184,166,0.1)", color: "#14B8A6",
                border: "1px solid rgba(20,184,166,0.2)", flexShrink: 0,
              }}>
                Cache
              </span>
            </div>
          )}
        </>
      ) : (
        /* ── Local mode ─────────────────────────────────────────────────────── */
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            flex: 1, fontSize: 12, fontFamily: "monospace",
            color: "var(--text-primary)", background: "var(--bg-primary)",
            border: "1px solid var(--border-primary)", borderRadius: 6,
            padding: "6px 10px", wordBreak: "break-all", lineHeight: 1.4,
          }}>
            {localVoicePath || <span style={{ fontStyle: "italic", color: "var(--text-tertiary)" }}>not configured</span>}
          </div>
          <button
            onClick={openModal}
            style={{
              flexShrink: 0, fontSize: 11, fontWeight: 500,
              padding: "6px 12px", borderRadius: 6, cursor: "pointer",
              background: "var(--bg-tertiary)",
              border: "1px solid var(--border-primary)",
              color: "var(--text-primary)",
            }}
          >
            Change
          </button>
        </div>
      )}

      {/* Disk info row — only when local path exists */}
      {config?.path_exists && config.free_gb !== null && config.total_gb !== null && (
        <div style={{ display: "flex", gap: 16, marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border-primary)" }}>
          <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
            <span style={{ color: "var(--text-secondary)", fontWeight: 500 }}>{config.free_gb} GB</span> free
          </div>
          <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
            <span style={{ color: "var(--text-secondary)", fontWeight: 500 }}>{config.total_gb} GB</span> total
          </div>
          {isCloud && (
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginLeft: "auto" }}>
              R2: <span style={{ color: "var(--text-secondary)", fontWeight: 500 }}>{config.rvc_models_bucket}</span>
            </div>
          )}
        </div>
      )}

      {/* Info footer */}
      <div style={{ marginTop: 10, fontSize: 11, color: "var(--text-tertiary)", lineHeight: 1.5 }}>
        {isCloud
          ? settings.localCacheEnabled
            ? "Local cache read first → R2 on miss. Models auto-restored from cloud if local is missing."
            : "Models stored in R2. Auto-restored from cloud if local is missing."
          : settings.isPersistent
            ? "Persistent local storage — files kept between sessions."
            : "Temporary local storage — files may be cleared between sessions."
        }
      </div>
    </div>
  );
}
