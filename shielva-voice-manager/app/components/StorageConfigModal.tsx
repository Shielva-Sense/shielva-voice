"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import { Cloud, X, Loader } from "lucide-react";
import { useStorage } from "../context/StorageContext";

/**
 * Storage configuration modal.
 *
 * Shielva Voice stores all audio in Cloudflare R2 (cloud). "Local" storage would
 * mean the *pod's* server filesystem — not the user's machine — so it is not
 * offered. Generated clips download to the user's device via the per-result
 * download button, independent of this setting.
 */
export default function StorageConfigModal() {
  const { showModal, closeModal, saveSettings } = useStorage();
  const [saving, setSaving] = useState(false);

  if (!showModal) return null;

  const handleSave = () => {
    setSaving(true);
    // Cloud (R2) is the only storage adapter — force it here.
    saveSettings({ mode: "cloud", cloudEnabled: true, setupComplete: true });
    setSaving(false);
    closeModal();
  };

  return (
    <div style={overlay}>
      <div style={panel}>
        {/* Header */}
        <div style={panelHeader}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--white)", letterSpacing: -0.3 }}>
              Storage Configuration
            </div>
            <div style={{ fontSize: 12, color: "var(--gray-400)", marginTop: 3 }}>
              Audio is stored in Cloudflare R2
            </div>
          </div>
          <button style={iconBtn} onClick={closeModal} title="Close"><X size={15} /></button>
        </div>

        {/* Cloud (R2) — the sole storage adapter */}
        <div style={{ padding: "18px 20px 4px" }}>
          <div style={cloudCard}>
            <div style={cloudCardIcon}>
              <Cloud size={18} strokeWidth={1.8} />
            </div>
            <div style={{ textAlign: "left" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--white)" }}>Cloud Storage (R2)</div>
              <div style={{ fontSize: 11, color: "var(--gray-400)", marginTop: 2 }}>
                Cloudflare R2 · Persistent · No setup required
              </div>
            </div>
          </div>
          <div style={{ fontSize: 11, color: "var(--gray-500)", marginTop: 12, lineHeight: 1.5 }}>
            Voice references and generated audio are stored securely in Cloudflare R2.
            Generated clips download to your device with the download button on each result.
          </div>
        </div>

        <div style={footer}>
          <button style={cancelBtn} onClick={closeModal}>Close</button>
          <button style={saveButton(!saving)} onClick={handleSave} disabled={saving}>
            {saving ? (
              <><Loader size={13} style={{ animation: "spin 1s linear infinite" }} />Saving…</>
            ) : "Save Settings"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const overlay: CSSProperties = {
  position: "fixed", inset: 0, zIndex: 2000,
  background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)",
  display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
};

const panel: CSSProperties = {
  background: "#0d0d0d", border: "1px solid #222", borderRadius: 12,
  width: "100%", maxWidth: 560, maxHeight: "90vh", overflowY: "auto",
  display: "flex", flexDirection: "column",
  boxShadow: "0 24px 64px rgba(0,0,0,0.7)",
};

const panelHeader: CSSProperties = {
  display: "flex", alignItems: "flex-start", justifyContent: "space-between",
  padding: "18px 20px 14px", borderBottom: "1px solid #1a1a1a",
};

const iconBtn: CSSProperties = {
  background: "transparent", border: "1px solid #2a2a2a", borderRadius: 6,
  color: "var(--gray-400)", cursor: "pointer",
  width: 32, height: 32,
  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
};

const cloudCard: CSSProperties = {
  display: "flex", alignItems: "center", gap: 12, padding: "14px",
  background: "rgba(109,159,55,0.07)",
  border: "1px solid rgba(109,159,55,0.35)",
  borderRadius: 10, textAlign: "left",
};

const cloudCardIcon: CSSProperties = {
  width: 36, height: 36, borderRadius: 8,
  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
  background: "rgba(109,159,55,0.15)",
  color: "var(--bamboo-400)",
  border: "1px solid rgba(109,159,55,0.25)",
};

const footer: CSSProperties = {
  display: "flex", justifyContent: "flex-end", gap: 10,
  padding: "16px 20px", borderTop: "1px solid #1a1a1a", marginTop: 16,
};

const cancelBtn: CSSProperties = {
  height: 34, padding: "0 16px", background: "transparent",
  border: "1px solid #2a2a2a", borderRadius: 8, color: "var(--gray-400)",
  fontSize: 13, cursor: "pointer",
};

const saveButton = (enabled: boolean): CSSProperties => ({
  height: 34, padding: "0 20px",
  background: enabled ? "var(--bamboo-500)" : "#222",
  border: `1px solid ${enabled ? "var(--bamboo-600)" : "#333"}`,
  borderRadius: 8, color: enabled ? "#fff" : "var(--gray-500)",
  fontSize: 13, fontWeight: 600, cursor: enabled ? "pointer" : "not-allowed",
  display: "flex", alignItems: "center", gap: 7, transition: "all 0.15s ease",
});
