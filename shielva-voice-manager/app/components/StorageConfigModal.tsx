"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Cloud, HardDrive, X, Check, AlertTriangle, Loader,
  FolderOpen, ChevronRight, ChevronLeft, Home, Database,
} from "lucide-react";
import {
  useStorage,
  type LocalPaths,
  type StorageMode,
  TMP_PATHS,
  PERSISTENT_PATHS,
  CACHE_PATHS,
  unifiedPaths,
  unifiedValidation,
  ALL_PATH_KEYS,
} from "../context/StorageContext";

// storage/list-dir is a gateway-auth'd DB route — it needs the session cookie,
// host-scoped to the identity/gateway host, so it must be called there (not via
// voice.shielva.ai / API_URL) or the cookie is never sent → 401.
const GATEWAY_BASE = process.env.NEXT_PUBLIC_IDENTITY_URL || "https://api.shielva.ai";

/** Single representative key used for the unified path input. */
const UNIFIED_KEY: keyof LocalPaths = "tts";

/** Feature chips shown below the unified input. */
const FEATURE_CHIPS = [
  "Text to Speech",
  "Speech to Text",
  "Live Translation",
  "Voice Library",
];

type ValidationState = "unchecked" | "pending" | "valid" | "invalid";

// ─── Directory Browser ────────────────────────────────────────────────────────

interface DirBrowserProps {
  initialPath: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

function DirBrowser({ initialPath, onSelect, onClose }: DirBrowserProps) {
  const [currentPath, setCurrentPath] = useState(initialPath || "/tmp");
  const [dirs, setDirs] = useState<string[]>([]);
  const [parent, setParent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const navigate = useCallback(async (path: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `${GATEWAY_BASE}/amt/v1/storage/list-dir?path=${encodeURIComponent(path)}`,
        { credentials: "include" },
      );
      const data = await res.json();
      if (data.error) { setError(data.error); setLoading(false); return; }
      setCurrentPath(data.path);
      setParent(data.parent ?? null);
      setDirs(data.dirs ?? []);
    } catch {
      setError("Could not reach server");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { navigate(initialPath || "/tmp"); }, []); // eslint-disable-line

  return (
    <div style={browserOverlay}>
      <div style={browserPanel}>
        <div style={browserHeader}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--white)" }}>Browse Directory</div>
          <button style={iconBtn} onClick={onClose}><X size={14} /></button>
        </div>

        <div style={pathBar}>
          <button style={pathNavBtn} onClick={() => navigate("/")} title="Root">
            <Home size={13} />
          </button>
          {parent && (
            <button style={pathNavBtn} onClick={() => navigate(parent)} title="Up">
              <ChevronLeft size={13} />
            </button>
          )}
          <span style={{ fontSize: 11, color: "var(--gray-300)", fontFamily: "monospace", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {currentPath}
          </span>
          {loading && <Loader size={12} style={{ animation: "spin 1s linear infinite", color: "var(--gray-500)", flexShrink: 0 }} />}
        </div>

        <div style={dirList}>
          {error && <div style={{ padding: "8px 12px", fontSize: 11, color: "#f87171" }}>{error}</div>}
          {!error && dirs.length === 0 && !loading && (
            <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--gray-500)" }}>No subdirectories</div>
          )}
          {dirs.map((d) => (
            <button key={d} style={dirRow} onClick={() => navigate(d)}>
              <FolderOpen size={13} style={{ color: "#60a5fa", flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: "var(--gray-200)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {d.split("/").pop()}
              </span>
              <ChevronRight size={12} style={{ color: "var(--gray-500)", marginLeft: "auto", flexShrink: 0 }} />
            </button>
          ))}
        </div>

        <div style={{ padding: "10px 12px", borderTop: "1px solid #1a1a1a", display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ flex: 1, fontSize: 11, color: "var(--gray-400)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {currentPath}
          </span>
          <button style={selectDirBtn} onClick={() => onSelect(currentPath)}>
            Select
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Path row group (reusable) ────────────────────────────────────────────────

interface UnifiedPathInputProps {
  paths: LocalPaths;
  validation: Record<keyof LocalPaths, ValidationState>;
  onChange: (paths: LocalPaths) => void;
  onValidate: () => void;
  onBrowse: () => void;
}

function UnifiedPathInput({ paths, validation, onChange, onValidate, onBrowse }: UnifiedPathInputProps) {
  const v = validation[UNIFIED_KEY];
  return (
    <div>
      {/* Feature chips */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {FEATURE_CHIPS.map((chip) => (
          <span key={chip} style={{
            fontSize: 10, fontWeight: 500,
            padding: "2px 8px", borderRadius: 99,
            background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.2)",
            color: "#93c5fd",
          }}>{chip}</span>
        ))}
      </div>
      {/* Single path row */}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          style={pathInput(v)}
          value={paths[UNIFIED_KEY]}
          onChange={(e) => onChange(unifiedPaths(e.target.value))}
          placeholder="/path/to/storage"
          spellCheck={false}
        />
        <button style={iconBtn} title="Browse directories" onClick={onBrowse}>
          <FolderOpen size={13} style={{ color: "#60a5fa" }} />
        </button>
        <button style={iconBtn} onClick={onValidate} title="Validate path" disabled={v === "pending"}>
          {v === "pending"  ? <Loader size={13} style={{ animation: "spin 1s linear infinite" }} />
          : v === "valid"   ? <Check size={13} style={{ color: "#4ade80" }} />
          : v === "invalid" ? <AlertTriangle size={13} style={{ color: "#f87171" }} />
          :                   <Check size={13} style={{ color: "var(--gray-500)" }} />}
        </button>
        <div style={validationLabel(v)}>
          {v === "valid"   && "Valid"}
          {v === "invalid" && "Invalid"}
          {v === "pending" && "Checking…"}
        </div>
      </div>
      <div style={{ fontSize: 10, color: "var(--gray-500)", marginTop: 6 }}>
        All features use this single directory. Files are stored flat with feature-prefixed names.
      </div>
    </div>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

export default function StorageConfigModal() {
  const { settings, showModal, closeModal, saveSettings, validatePath } = useStorage();

  const [mode,              setMode]              = useState<StorageMode>(settings.mode);
  const [cloudEnabled,      setCloudEnabled]      = useState(settings.cloudEnabled);
  const [paths,             setPaths]             = useState<LocalPaths>({ ...settings.localPaths });
  const [validation,        setValidation]        = useState<Record<keyof LocalPaths, ValidationState>>(
    unifiedValidation(settings.pathValidation.tts as ValidationState) as Record<keyof LocalPaths, ValidationState>
  );
  const [isPersistent,      setIsPersistent]      = useState(settings.isPersistent);
  const [localCacheEnabled, setLocalCacheEnabled] = useState(settings.localCacheEnabled);
  const [cachePaths,        setCachePaths]        = useState<LocalPaths>({ ...settings.cachePaths });
  const [cacheValidation,   setCacheValidation]   = useState<Record<keyof LocalPaths, ValidationState>>(
    unifiedValidation(settings.cacheValidation.tts as ValidationState) as Record<keyof LocalPaths, ValidationState>
  );
  const [terms,      setTerms]      = useState(settings.termsAccepted);
  const [saving,     setSaving]     = useState(false);
  const [globalError,setGlobalError]= useState("");

  // browser state: which group is the dir-browser open for
  const [browserFor, setBrowserFor] = useState<"primary" | "cache" | null>(null);

  // Sync on open
  useEffect(() => {
    if (showModal) {
      setMode(settings.mode);
      setCloudEnabled(settings.cloudEnabled);
      // Normalise to unified (all keys = same value based on tts representative)
      setPaths(unifiedPaths(settings.localPaths.tts));
      setValidation(unifiedValidation(settings.pathValidation.tts as ValidationState) as Record<keyof LocalPaths, ValidationState>);
      setIsPersistent(settings.isPersistent);
      setLocalCacheEnabled(settings.localCacheEnabled);
      setCachePaths(unifiedPaths(settings.cachePaths.tts));
      setCacheValidation(unifiedValidation(settings.cacheValidation.tts as ValidationState) as Record<keyof LocalPaths, ValidationState>);
      setTerms(settings.termsAccepted);
      setGlobalError("");
      setBrowserFor(null);
    }
  }, [showModal]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!showModal) return null;

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Validate the unified path (one request) and mirror result to all keys. */
  const handleValidate = async (
    path: string,
    setVal: React.Dispatch<React.SetStateAction<Record<keyof LocalPaths, ValidationState>>>,
  ) => {
    setVal(unifiedValidation("pending") as Record<keyof LocalPaths, ValidationState>);
    const ok = await validatePath(UNIFIED_KEY, path);
    setVal(unifiedValidation(ok ? "valid" : "invalid") as Record<keyof LocalPaths, ValidationState>);
  };

  const handleValidateAll = () => handleValidate(paths[UNIFIED_KEY], setValidation);
  const handleValidateAllCache = () => handleValidate(cachePaths[UNIFIED_KEY], setCacheValidation);

  const handlePersistentToggle = (persistent: boolean) => {
    setIsPersistent(persistent);
    const defaults = persistent ? PERSISTENT_PATHS : TMP_PATHS;
    setPaths(defaults);
    setValidation(unifiedValidation("unchecked") as Record<keyof LocalPaths, ValidationState>);
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setGlobalError("");

    if (mode === "local") {
      if (!terms) { setGlobalError("You must accept the terms to use local storage."); return; }
      if (validation[UNIFIED_KEY] !== "valid") {
        setSaving(true);
        const ok = await validatePath(UNIFIED_KEY, paths[UNIFIED_KEY]);
        const status = ok ? "valid" : "invalid";
        setValidation(unifiedValidation(status) as Record<keyof LocalPaths, ValidationState>);
        setSaving(false);
        if (!ok) { setGlobalError("Validate the storage path before saving."); return; }
      }
    }

    setSaving(true);
    saveSettings({
      mode,
      cloudEnabled,
      localPaths:        paths,
      pathValidation:    validation as StorageSettings["pathValidation"],
      isPersistent,
      localCacheEnabled,
      cachePaths,
      cacheValidation:   cacheValidation as StorageSettings["cacheValidation"],
      termsAccepted:     terms,
      setupComplete:     true,
    });
    setSaving(false);
    closeModal();
  };

  const localPathsAllValid = validation[UNIFIED_KEY] === "valid";
  const canSave = mode === "cloud" || (mode === "local" && terms && localPathsAllValid);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <div style={overlay}>
        <div style={panel}>
          {/* Header */}
          <div style={panelHeader}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--white)", letterSpacing: -0.3 }}>
                Storage Configuration
              </div>
              <div style={{ fontSize: 12, color: "var(--gray-400)", marginTop: 3 }}>
                Choose where Shielva Voice stores audio data
              </div>
            </div>
            <button style={iconBtn} onClick={closeModal} title="Close"><X size={15} /></button>
          </div>

          {/* Adapter cards */}
          <div style={{ display: "flex", gap: 12, padding: "18px 20px 0" }}>
            <button style={adapterCard(mode === "cloud")} onClick={() => setMode("cloud")}>
              <div style={adapterCardIcon(mode === "cloud", true)}>
                <Cloud size={18} strokeWidth={1.8} />
              </div>
              <div style={{ textAlign: "left" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--white)" }}>Cloud Storage</div>
                <div style={{ fontSize: 11, color: "var(--gray-400)", marginTop: 2 }}>
                  Cloudflare R2 · Persistent · No setup required
                </div>
              </div>
              {mode === "cloud" && <div style={selectedDot(true)} />}
            </button>

            <button style={adapterCard(mode === "local")} onClick={() => setMode("local")}>
              <div style={adapterCardIcon(mode === "local", false)}>
                <HardDrive size={18} strokeWidth={1.8} />
              </div>
              <div style={{ textAlign: "left" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--white)" }}>Local Storage</div>
                <div style={{ fontSize: 11, color: "var(--gray-400)", marginTop: 2 }}>
                  Server filesystem · Private · Requires path setup
                </div>
              </div>
              {mode === "local" && <div style={selectedDot(false)} />}
            </button>
          </div>

          {/* Cloud fallback toggle */}
          <div style={section}>
            <div style={sectionRow}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--white)" }}>Cloud fallback</div>
                <div style={{ fontSize: 11, color: "var(--gray-400)", marginTop: 2 }}>
                  {mode === "cloud"
                    ? "Cloud is the active storage adapter"
                    : "When local paths are unavailable, fall back to cloud R2"}
                </div>
              </div>
              <button style={toggle(cloudEnabled)} onClick={() => setCloudEnabled((v) => !v)} role="switch" aria-checked={cloudEnabled}>
                <span style={toggleKnob(cloudEnabled)} />
              </button>
            </div>
            {!cloudEnabled && (
              <div style={warningBanner}>
                <AlertTriangle size={13} style={{ flexShrink: 0, color: "#f59e0b" }} />
                <span>Cloud disabled. If local paths are invalid, all features will be unavailable.</span>
              </div>
            )}
          </div>

          {/* ─────────── CLOUD MODE: local cache overlay ─────────── */}
          {mode === "cloud" && (
            <div style={section}>
              <div style={sectionRow}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Database size={13} style={{ color: "#60a5fa", flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--white)" }}>Local cache</div>
                    <div style={{ fontSize: 11, color: "var(--gray-400)", marginTop: 2 }}>
                      Serve from local disk first — sync from R2 only on cache miss
                    </div>
                  </div>
                </div>
                <button style={toggle(localCacheEnabled)} onClick={() => setLocalCacheEnabled((v) => !v)} role="switch" aria-checked={localCacheEnabled}>
                  <span style={toggleKnob(localCacheEnabled)} />
                </button>
              </div>

              {localCacheEnabled && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 11, color: "var(--gray-500)", marginBottom: 10, lineHeight: 1.5 }}>
                    Audio files fetched from cloud will be cached here. On subsequent requests the local copy is served directly, reducing latency and R2 bandwidth.
                  </div>
                  <UnifiedPathInput
                    paths={cachePaths}
                    validation={cacheValidation}
                    onChange={(p) => { setCachePaths(p); setCacheValidation(unifiedValidation("unchecked") as Record<keyof LocalPaths, ValidationState>); }}
                    onValidate={handleValidateAllCache}
                    onBrowse={() => setBrowserFor("cache")}
                  />
                  <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                    <button style={validateAllBtn} onClick={handleValidateAllCache}>
                      Validate cache path
                    </button>
                    <button style={defaultsBtn} onClick={() => {
                      setCachePaths({ ...CACHE_PATHS });
                      setCacheValidation(unifiedValidation("unchecked") as Record<keyof LocalPaths, ValidationState>);
                    }}>
                      Use defaults
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ─────────── LOCAL MODE: persistence toggle ─────────── */}
          {mode === "local" && (
            <div style={section}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--white)", marginBottom: 8 }}>
                Storage type
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  style={storageTypeBtn(!isPersistent)}
                  onClick={() => handlePersistentToggle(false)}
                >
                  <div style={{ fontSize: 12, fontWeight: 600 }}>Temporary</div>
                  <div style={{ fontSize: 10, color: "var(--gray-400)", marginTop: 2 }}>
                    /tmp — cleared on reboot
                  </div>
                </button>
                <button
                  style={storageTypeBtn(isPersistent)}
                  onClick={() => handlePersistentToggle(true)}
                >
                  <div style={{ fontSize: 12, fontWeight: 600 }}>Persistent</div>
                  <div style={{ fontSize: 10, color: "var(--gray-400)", marginTop: 2 }}>
                    /var or custom — survives reboots
                  </div>
                </button>
              </div>
              {isPersistent && (
                <div style={{ ...warningBanner, border: "1px solid rgba(96,165,250,0.2)", background: "rgba(96,165,250,0.06)", marginTop: 10 }}>
                  <Database size={13} style={{ flexShrink: 0, color: "#60a5fa" }} />
                  <span style={{ color: "var(--gray-300)" }}>
                    Persistent storage retains audio across restarts. Ensure adequate disk space and set up a retention/cleanup policy.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ─────────── LOCAL STORAGE PATHS (always visible) ─────────── */}
          <>
            <div style={{ ...sectionHeader, paddingTop: mode === "local" ? 6 : 14 }}>
              <span>
                {mode === "local" ? "Storage Paths" : "Local Paths"}
                {mode === "cloud" && (
                  <span style={{ fontSize: 10, fontWeight: 400, color: "var(--gray-500)", marginLeft: 7, textTransform: "none", letterSpacing: 0 }}>
                    optional — used when switched to local mode
                  </span>
                )}
              </span>
              <button style={defaultsBtn} onClick={() => {
                const defaults = isPersistent ? PERSISTENT_PATHS : TMP_PATHS;
                setPaths({ ...defaults });
                setValidation(unifiedValidation("unchecked") as Record<keyof LocalPaths, ValidationState>);
              }}>
                Use defaults
              </button>
            </div>

            <div style={{ padding: "0 20px" }}>
              <UnifiedPathInput
                paths={paths}
                validation={validation}
                onChange={(p) => { setPaths(p); setValidation(unifiedValidation("unchecked") as Record<keyof LocalPaths, ValidationState>); }}
                onValidate={handleValidateAll}
                onBrowse={() => setBrowserFor("primary")}
              />
            </div>

            <div style={{ padding: "10px 20px 0" }}>
              <button
                style={validateAllBtn}
                onClick={handleValidateAll}
                disabled={validation[UNIFIED_KEY] === "pending"}
              >
                Validate path
              </button>
            </div>

            {/* Terms — only required in local mode */}
            {mode === "local" && (
              <div style={section}>
                <label style={termsRow}>
                  <div
                    style={checkbox(terms)}
                    onClick={() => setTerms((v) => !v)}
                    role="checkbox"
                    aria-checked={terms}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === " " && setTerms((v) => !v)}
                  >
                    {terms && <Check size={10} />}
                  </div>
                  <span style={{ fontSize: 12, color: "var(--gray-300)", lineHeight: 1.5 }}>
                    I understand that audio files will be stored on the server filesystem at the paths
                    above, and that I am responsible for their security, retention, and compliance with
                    applicable data protection regulations.
                  </span>
                </label>
              </div>
            )}
          </>

          {globalError && (
            <div style={{ ...warningBanner, margin: "10px 20px 0", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)" }}>
              <AlertTriangle size={13} style={{ flexShrink: 0, color: "#f87171" }} />
              <span style={{ color: "#fca5a5" }}>{globalError}</span>
            </div>
          )}

          <div style={footer}>
            <button style={cancelBtn} onClick={closeModal}>Cancel</button>
            <button style={saveButton(canSave && !saving)} onClick={handleSave} disabled={!canSave || saving}>
              {saving ? (
                <><Loader size={13} style={{ animation: "spin 1s linear infinite" }} />Saving…</>
              ) : "Save Settings"}
            </button>
          </div>
        </div>
      </div>

      {/* Directory browser */}
      {browserFor && (
        <DirBrowser
          initialPath={browserFor === "cache" ? cachePaths[UNIFIED_KEY] : paths[UNIFIED_KEY]}
          onSelect={(selectedPath) => {
            const unified = unifiedPaths(selectedPath);
            if (browserFor === "cache") {
              setCachePaths(unified);
              setCacheValidation(unifiedValidation("unchecked") as Record<keyof LocalPaths, ValidationState>);
            } else {
              setPaths(unified);
              setValidation(unifiedValidation("unchecked") as Record<keyof LocalPaths, ValidationState>);
            }
            setBrowserFor(null);
          }}
          onClose={() => setBrowserFor(null)}
        />
      )}
    </>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

import type { CSSProperties } from "react";
import type { StorageSettings } from "../context/StorageContext";

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

const adapterCard = (active: boolean): CSSProperties => ({
  flex: 1, display: "flex", alignItems: "center", gap: 12, padding: "14px",
  background: active ? "rgba(109,159,55,0.07)" : "#111",
  border: `1px solid ${active ? "rgba(109,159,55,0.35)" : "#222"}`,
  borderRadius: 10, cursor: "pointer", textAlign: "left",
  transition: "all 0.15s ease", position: "relative",
});

const adapterCardIcon = (active: boolean, isCloud: boolean): CSSProperties => ({
  width: 36, height: 36, borderRadius: 8,
  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
  background: active
    ? isCloud ? "rgba(109,159,55,0.15)" : "rgba(100,160,255,0.12)"
    : "rgba(255,255,255,0.04)",
  color: active ? isCloud ? "var(--bamboo-400)" : "#60a5fa" : "var(--gray-500)",
  border: active
    ? isCloud ? "1px solid rgba(109,159,55,0.25)" : "1px solid rgba(96,165,250,0.2)"
    : "1px solid rgba(255,255,255,0.06)",
});

const selectedDot = (isCloud: boolean): CSSProperties => ({
  position: "absolute", top: 10, right: 10,
  width: 7, height: 7, borderRadius: "50%",
  background: isCloud ? "var(--bamboo-400)" : "#60a5fa",
  boxShadow: `0 0 8px ${isCloud ? "var(--bamboo-glow)" : "rgba(96,165,250,0.4)"}`,
});

const section: CSSProperties = { padding: "14px 20px 0" };

const sectionRow: CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
};

const sectionHeader: CSSProperties = {
  padding: "14px 20px 8px", fontSize: 12, fontWeight: 600,
  color: "var(--gray-300)", letterSpacing: "0.04em",
  textTransform: "uppercase" as const,
  display: "flex", alignItems: "center", justifyContent: "space-between",
};

const toggle = (on: boolean): CSSProperties => ({
  width: 40, height: 22, borderRadius: 11,
  background: on ? "var(--bamboo-500)" : "#333",
  border: "none", cursor: "pointer", position: "relative",
  transition: "background 0.2s ease", flexShrink: 0,
});

const toggleKnob = (on: boolean): CSSProperties => ({
  position: "absolute", top: 3, left: on ? 21 : 3,
  width: 16, height: 16, borderRadius: "50%", background: "#fff",
  transition: "left 0.2s ease", boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
});

const warningBanner: CSSProperties = {
  display: "flex", alignItems: "flex-start", gap: 8,
  padding: "10px 12px",
  background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.18)",
  borderRadius: 8, marginTop: 10, fontSize: 11, color: "var(--gray-300)", lineHeight: 1.5,
};

const storageTypeBtn = (active: boolean): CSSProperties => ({
  flex: 1, padding: "10px 12px", textAlign: "left",
  background: active ? "rgba(96,165,250,0.08)" : "#111",
  border: `1px solid ${active ? "rgba(96,165,250,0.3)" : "#222"}`,
  borderRadius: 8, cursor: "pointer", color: active ? "#93c5fd" : "var(--gray-400)",
  transition: "all 0.15s ease",
});

const pathInput = (status: ValidationState): CSSProperties => ({
  flex: 1, height: 34, padding: "0 10px", background: "#111",
  border: `1px solid ${status === "valid" ? "rgba(74,222,128,0.3)" : status === "invalid" ? "rgba(248,113,113,0.3)" : "#222"}`,
  borderRadius: 7, color: "var(--white)", fontSize: 12, fontFamily: "monospace", outline: "none",
});

const validationLabel = (status: ValidationState): CSSProperties => ({
  fontSize: 11,
  color: status === "valid" ? "#4ade80" : status === "invalid" ? "#f87171" : status === "pending" ? "#f59e0b" : "transparent",
  width: 52, flexShrink: 0,
});

const validateAllBtn: CSSProperties = {
  height: 32, padding: "0 14px", background: "transparent",
  border: "1px solid #2a2a2a", borderRadius: 7,
  color: "var(--gray-300)", fontSize: 12, cursor: "pointer",
};

const defaultsBtn: CSSProperties = {
  fontSize: 11, color: "var(--bamboo-400)", background: "transparent",
  border: "none", cursor: "pointer", padding: 0,
  textTransform: "none" as const, letterSpacing: 0, fontWeight: 500,
};

const termsRow: CSSProperties = {
  display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer",
};

const checkbox = (checked: boolean): CSSProperties => ({
  width: 16, height: 16, borderRadius: 4,
  border: `1px solid ${checked ? "var(--bamboo-500)" : "#333"}`,
  background: checked ? "var(--bamboo-500)" : "transparent",
  display: "flex", alignItems: "center", justifyContent: "center",
  flexShrink: 0, cursor: "pointer", color: "#fff", marginTop: 1,
});

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

// ── Directory browser styles ──────────────────────────────────────────────────

const browserOverlay: CSSProperties = {
  position: "fixed", inset: 0, zIndex: 2100,
  background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
  display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
};

const browserPanel: CSSProperties = {
  background: "#0d0d0d", border: "1px solid #222", borderRadius: 10,
  width: "100%", maxWidth: 420, maxHeight: 480,
  display: "flex", flexDirection: "column",
  boxShadow: "0 20px 48px rgba(0,0,0,0.8)",
};

const browserHeader: CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  padding: "12px 14px", borderBottom: "1px solid #1a1a1a",
};

const pathBar: CSSProperties = {
  display: "flex", alignItems: "center", gap: 6, padding: "8px 12px",
  borderBottom: "1px solid #1a1a1a", background: "#0a0a0a",
};

const pathNavBtn: CSSProperties = {
  background: "transparent", border: "1px solid #2a2a2a", borderRadius: 5,
  color: "var(--gray-400)", cursor: "pointer",
  width: 24, height: 24,
  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
};

const dirList: CSSProperties = { flex: 1, overflowY: "auto", padding: "4px 0" };

const dirRow: CSSProperties = {
  display: "flex", alignItems: "center", gap: 8,
  width: "100%", padding: "7px 14px",
  background: "transparent", border: "none", cursor: "pointer", textAlign: "left",
  transition: "background 0.1s",
};

const selectDirBtn: CSSProperties = {
  height: 28, padding: "0 14px",
  background: "var(--bamboo-500)", border: "none", borderRadius: 6,
  color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", flexShrink: 0,
};
