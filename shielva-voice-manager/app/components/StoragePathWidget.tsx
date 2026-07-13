"use client";

import { useEffect, useState } from "react";
import { getStorageConfig, type StorageConfig } from "../lib/amt-api";

/**
 * Voice-storage summary widget. Storage is Cloudflare R2 (cloud) only — the
 * pod's local filesystem is never offered as a user-facing option. Generated
 * audio downloads to the user's device via the per-result download button.
 */
export default function StoragePathWidget() {
  const [config, setConfig] = useState<StorageConfig | null>(null);

  useEffect(() => {
    getStorageConfig().then(setConfig).catch(() => {});
  }, []);

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
          Voice Storage
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 99,
            background: "rgba(99,102,241,0.15)", color: "#818cf8",
          }}>
            Cloud (R2)
          </span>
          <span style={{
            fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 99,
            background: "rgba(34,197,94,0.12)", color: "#22c55e",
          }}>
            Available
          </span>
        </div>
      </div>

      {/* R2 bucket — primary */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{
          flex: 1, fontSize: 12, fontFamily: "monospace",
          color: "var(--text-primary)", background: "var(--bg-primary)",
          border: "1px solid var(--border-primary)", borderRadius: 6,
          padding: "6px 10px", lineHeight: 1.4,
        }}>
          R2 › {config?.voice_bucket ?? "shielvasense-voice-synthesis"}
        </div>
        <span style={{
          fontSize: 11, fontWeight: 500, padding: "4px 10px", borderRadius: 6,
          background: "rgba(99,102,241,0.1)", color: "#818cf8",
          border: "1px solid rgba(99,102,241,0.2)", flexShrink: 0,
        }}>
          Primary
        </span>
      </div>

      {/* Info footer */}
      <div style={{ marginTop: 10, fontSize: 11, color: "var(--text-tertiary)", lineHeight: 1.5 }}>
        Voice references and generated audio are stored in Cloudflare R2.
      </div>
    </div>
  );
}
