"use client";

/**
 * StorageContext — Cloud / Local storage adapter for Shielva Voice.
 *
 * Persistence layers (authenticated users):
 *   1. MongoDB (primary) — fetched on login via GET /amt/v1/storage/config
 *                           saved on every saveSettings() via PUT /amt/v1/storage/config
 *   2. localStorage (secondary) — read as fast fallback while API call is in flight,
 *                                  written in sync with every API save
 *
 * IMPORTANT: The backend ALWAYS uses cloud R2 for audio I/O in production.
 * Local paths stored here are a UI-layer preference only — they tell the frontend
 * which mode/paths the user prefers. The server never reads from the local
 * machine filesystem in production (ENVIRONMENT=production guard in gateway).
 *
 * Modes:
 *   cloud  → audio stored in R2 via CDN
 *             optionally layered with a local read-cache (serve local-first on the
 *             gateway host, sync from R2 on miss — only valid in self-hosted mode)
 *   local  → gateway reads/writes to server-local paths (self-hosted / dev only)
 *             can be temporary (/tmp) or persistent (/var/shielva or custom)
 *
 * Fallback chain:
 *   local selected + paths valid          → local (self-hosted only)
 *   local selected + paths invalid        → cloud (if enabled), else features disabled
 *   cloud selected + localCacheEnabled    → local cache first → R2 on miss
 *   cloud selected                        → R2 directly (production default)
 *   nothing configured + cloud enabled    → cloud (silent default)
 *   nothing configured + cloud disabled   → show setup modal, features disabled
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { useAuth } from "./AuthContext";

const AMT_BASE = process.env.NEXT_PUBLIC_API_URL || "https://localhost:8000";
const LS_KEY = "vm-storage-v2";

// ─── Types ────────────────────────────────────────────────────────────────────

export type StorageMode = "cloud" | "local";

export interface LocalPaths {
  tts:          string;
  stt:          string;
  voice:        string;
  voiceLibrary: string;
}

export interface PathValidation {
  tts:          "valid" | "invalid" | "pending" | "unchecked";
  stt:          "valid" | "invalid" | "pending" | "unchecked";
  voice:        "valid" | "invalid" | "pending" | "unchecked";
  voiceLibrary: "valid" | "invalid" | "pending" | "unchecked";
}

/** All LocalPaths keys — used for unified sync. */
export const ALL_PATH_KEYS: (keyof LocalPaths)[] = ["tts", "stt", "voice", "voiceLibrary"];

/** Build a LocalPaths object where every key has the same value (unified mode). */
export function unifiedPaths(dir: string): LocalPaths {
  return { tts: dir, stt: dir, voice: dir, voiceLibrary: dir };
}

/** Build a PathValidation object where every key has the same status. */
export function unifiedValidation(status: PathValidation["tts"]): PathValidation {
  return { tts: status, stt: status, voice: status, voiceLibrary: status };
}

export interface StorageSettings {
  mode: StorageMode;
  cloudEnabled: boolean;

  // Local mode — primary paths (self-hosted / dev only; ignored in production backend)
  localPaths: LocalPaths;
  pathValidation: PathValidation;
  isPersistent: boolean;

  // Cloud mode — optional local read-cache overlay (gateway-host cache, not browser)
  localCacheEnabled: boolean;
  cachePaths: LocalPaths;
  cacheValidation: PathValidation;

  termsAccepted: boolean;
  setupComplete: boolean;
}

/** Result from checkLocalFile — tells the caller whether to use local or CDN URL. */
export interface LocalFileCheckResult {
  /** true = file exists at localPath, use localUrl for playback */
  exists: boolean;
  /** Absolute local path that was checked */
  localPath: string;
  /** Constructed local-serve URL (via gateway proxy) */
  localUrl: string;
  /** true = running in production, local filesystem not available */
  production?: boolean;
}

interface StorageContextValue {
  settings: StorageSettings;
  showModal: boolean;
  openModal: () => void;
  closeModal: () => void;
  saveSettings: (next: Partial<StorageSettings>) => void;
  validatePath: (feature: keyof LocalPaths, path: string) => Promise<boolean>;
  validateAllPaths: () => Promise<boolean>;
  canUseFeature: (feature: "tts" | "stt" | "voice") => { allowed: boolean; reason?: string };
  activeMode: StorageMode;
  isLocalFallback: boolean;
  localCacheActive: boolean;
  configLoading: boolean;
  /**
   * Check if a named audio file exists in the local cache/persistent path for
   * the given feature.  Returns exists=true + localUrl when found so the caller
   * can play from local instead of R2.
   *
   * When the file is NOT found but isPersistent=true (user explicitly chose
   * persistent storage), the context records a `localFileMissingWarning` that
   * surfaces in the UI as a toast.
   */
  checkLocalFile: (feature: keyof LocalPaths, filename: string) => Promise<LocalFileCheckResult>;
  /** Non-null when a previously-expected local file was found missing. */
  localFileMissingWarning: string | null;
  clearLocalFileMissingWarning: () => void;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const TMP_PATHS: LocalPaths = unifiedPaths("/tmp/shielva/voice");
export const PERSISTENT_PATHS: LocalPaths = unifiedPaths("/var/shielva/voice");
export const CACHE_PATHS: LocalPaths = unifiedPaths("/tmp/shielva/cache");

const DEFAULT_VALIDATION: PathValidation = unifiedValidation("unchecked");

const DEFAULT_SETTINGS: StorageSettings = {
  mode:              "cloud",
  cloudEnabled:      true,
  localPaths:        TMP_PATHS,
  pathValidation:    DEFAULT_VALIDATION,
  isPersistent:      false,
  localCacheEnabled: false,
  cachePaths:        CACHE_PATHS,
  cacheValidation:   DEFAULT_VALIDATION,
  termsAccepted:     false,
  setupComplete:     false,
};

// Public-session default: local /tmp silently, no cloud, no modal.
const PUBLIC_SETTINGS: StorageSettings = {
  ...DEFAULT_SETTINGS,
  mode:           "local",
  cloudEnabled:   false,
  localPaths:     TMP_PATHS,
  pathValidation: unifiedValidation("valid"),
  termsAccepted:  true,
  setupComplete:  true,
};

// ─── Merge helper ─────────────────────────────────────────────────────────────

function mergeSettings(base: StorageSettings, partial: Partial<StorageSettings>): StorageSettings {
  const ppv = partial.pathValidation  as Partial<PathValidation> | undefined;
  const pcv = partial.cacheValidation as Partial<PathValidation> | undefined;
  return {
    ...base,
    ...partial,
    localPaths:  { ...base.localPaths,  ...(partial.localPaths  || {}) },
    cachePaths:  { ...base.cachePaths,  ...(partial.cachePaths  || {}) },
    pathValidation: {
      tts:          ppv?.tts          ?? base.pathValidation.tts,
      stt:          ppv?.stt          ?? base.pathValidation.stt,
      voice:        ppv?.voice        ?? base.pathValidation.voice,
      voiceLibrary: ppv?.voiceLibrary ?? base.pathValidation.voiceLibrary ?? "unchecked",
    },
    cacheValidation: {
      tts:          pcv?.tts          ?? base.cacheValidation.tts,
      stt:          pcv?.stt          ?? base.cacheValidation.stt,
      voice:        pcv?.voice        ?? base.cacheValidation.voice,
      voiceLibrary: pcv?.voiceLibrary ?? base.cacheValidation.voiceLibrary ?? "unchecked",
    },
  };
}

// ─── Context ──────────────────────────────────────────────────────────────────

const StorageContext = createContext<StorageContextValue | null>(null);

export function StorageProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const [settings,                  setSettings]                  = useState<StorageSettings>(DEFAULT_SETTINGS);
  const [showModal,                  setShowModal]                  = useState(false);
  const [configLoading,              setConfigLoading]              = useState(false);
  const [localFileMissingWarning,    setLocalFileMissingWarning]    = useState<string | null>(null);
  const initialized = useRef(false);

  // ── Persist helpers ────────────────────────────────────────────────────────

  /** Write to localStorage (fast, synchronous). */
  const persistLocal = useCallback((next: StorageSettings) => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch {}
  }, []);

  /** Write to MongoDB via gateway (async, best-effort). */
  const persistRemote = useCallback(async (next: StorageSettings) => {
    try {
      await fetch(`${AMT_BASE}/amt/v1/storage/config`, {
        method:      "PUT",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",
        body:        JSON.stringify(next),
      });
    } catch {
      // Network errors are silent — localStorage copy is the fallback
    }
  }, []);

  // ── Initialise ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (isLoading) return;
    if (initialized.current) return;
    initialized.current = true;

    if (!isAuthenticated) {
      setSettings(PUBLIC_SETTINGS);
      return;
    }

    // 1. Apply localStorage immediately (instant — avoids blank state flash)
    let localSnapshot: StorageSettings | null = null;
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<StorageSettings>;
        localSnapshot = mergeSettings(DEFAULT_SETTINGS, parsed);
        setSettings(localSnapshot);
      }
    } catch {}

    // 2. Fetch from MongoDB (authoritative) and reconcile
    setConfigLoading(true);
    fetch(`${AMT_BASE}/amt/v1/storage/config`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((remote: Partial<StorageSettings> | null) => {
        if (remote && Object.keys(remote).length > 0) {
          const resolved = mergeSettings(DEFAULT_SETTINGS, remote);
          setSettings(resolved);
          persistLocal(resolved);   // keep localStorage in sync
        }
        // If empty response → keep localStorage snapshot (or defaults)
      })
      .catch(() => {
        // Network error — localStorage snapshot already applied
      })
      .finally(() => setConfigLoading(false));
  }, [isAuthenticated, isLoading, persistLocal]);

  // ── Re-apply public defaults on logout ────────────────────────────────────

  useEffect(() => {
    if (!isLoading && !isAuthenticated && initialized.current) {
      setSettings(PUBLIC_SETTINGS);
      setShowModal(false);
    }
  }, [isAuthenticated, isLoading]);

  // Show setup modal for authenticated users with no config and cloud disabled
  useEffect(() => {
    if (!isLoading && isAuthenticated && initialized.current
        && !settings.setupComplete && !settings.cloudEnabled) {
      setShowModal(true);
    }
  }, [isAuthenticated, isLoading, settings.setupComplete, settings.cloudEnabled]);

  // ── saveSettings ───────────────────────────────────────────────────────────

  const saveSettings = useCallback((partial: Partial<StorageSettings>) => {
    setSettings((prev) => {
      const next = mergeSettings(prev, partial);
      // Write to both layers immediately
      persistLocal(next);
      if (isAuthenticated) persistRemote(next);
      return next;
    });
  }, [isAuthenticated, persistLocal, persistRemote]);

  // ── Single-key validation helper ──────────────────────────────────────────

  const setOneValidation = useCallback(
    (feature: keyof LocalPaths, status: PathValidation[keyof LocalPaths]) => {
      setSettings((prev) => {
        const next: StorageSettings = {
          ...prev,
          pathValidation: { ...prev.pathValidation, [feature]: status },
        };
        persistLocal(next);
        return next;
      });
    },
    [persistLocal],
  );

  // ── Path validation via gateway ────────────────────────────────────────────

  const validatePath = useCallback(
    async (feature: keyof LocalPaths, path: string): Promise<boolean> => {
      setOneValidation(feature, "pending");
      try {
        const res = await fetch(`${AMT_BASE}/amt/v1/storage/validate-path`, {
          method:      "POST",
          headers:     { "Content-Type": "application/json" },
          credentials: "include",
          body:        JSON.stringify({ path, feature }),
        });
        const data = await res.json();
        // Production guard: backend returns { production: true } — treat as "valid"
        // so the UI doesn't block users who are in cloud-only production mode.
        if (data.production) {
          setOneValidation(feature, "valid");
          return true;
        }
        const status: PathValidation[keyof LocalPaths] = data.valid && data.writable ? "valid" : "invalid";
        setOneValidation(feature, status);
        return status === "valid";
      } catch {
        setOneValidation(feature, "invalid");
        return false;
      }
    },
    [setOneValidation],
  );

  const validateAllPaths = useCallback(async (): Promise<boolean> => {
    // Unified: all paths are the same directory — validate once, apply to all keys
    const dir = settings.localPaths.tts;
    const ok  = await validatePath("tts", dir);
    // Mirror result to the other 3 keys without re-fetching
    setSettings((prev) => {
      const status = ok ? "valid" : "invalid";
      const next: StorageSettings = {
        ...prev,
        pathValidation: unifiedValidation(status),
      };
      persistLocal(next);
      return next;
    });
    return ok;
  }, [settings.localPaths, validatePath, persistLocal]);

  // ── Local file existence check ─────────────────────────────────────────────
  //
  // After synthesis/translation the audio is stored in R2.  When isPersistent
  // is enabled, the gateway also writes a local copy at the configured path
  // so that future playback can be served directly from disk.
  //
  // This helper constructs the expected local path for a given filename and
  // checks if the file still exists on the gateway host.  If the file is
  // missing and the user had chosen persistent storage, it fires a warning
  // notification so the UI can tell the user their file may have been deleted.

  const checkLocalFile = useCallback(
    async (feature: keyof LocalPaths, filename: string): Promise<LocalFileCheckResult> => {
      const baseDir  = settings.localCacheEnabled
        ? settings.cachePaths[feature]
        : settings.localPaths[feature];
      const localPath = `${baseDir.replace(/\/$/, "")}/${filename}`;
      // Gateway-proxied local-serve URL (the gateway streams the file)
      const localUrl  = `${AMT_BASE}/amt/v1/storage/serve-local?path=${encodeURIComponent(localPath)}`;

      try {
        const res  = await fetch(
          `${AMT_BASE}/amt/v1/storage/file-exists?path=${encodeURIComponent(localPath)}`,
          { credentials: "include" },
        );
        const data = await res.json();

        // Production: local filesystem not available — no warning, just use R2
        if (data.production) return { exists: false, localPath, localUrl, production: true };

        if (data.exists) return { exists: true, localPath, localUrl };

        // File missing — show warning only when user explicitly chose persistent storage
        if (settings.isPersistent && (settings.mode === "local" || settings.localCacheEnabled)) {
          setLocalFileMissingWarning(
            `Local audio file not found: ${localPath}. ` +
            `It may have been deleted — check your recycle bin or the configured path.`,
          );
        }
        return { exists: false, localPath, localUrl };
      } catch {
        return { exists: false, localPath, localUrl };
      }
    },
    [settings],
  );

  // ── Feature gating ─────────────────────────────────────────────────────────

  const canUseFeature = useCallback(
    (feature: "tts" | "stt" | "voice" | "voiceLibrary"): { allowed: boolean; reason?: string } => {
      if (settings.mode === "cloud" && settings.cloudEnabled) return { allowed: true };

      if (settings.mode === "local") {
        const v = settings.pathValidation[feature];
        if (v === "valid") return { allowed: true };
        if (settings.cloudEnabled) return { allowed: true };  // cloud fallback
        if (v === "pending") return { allowed: false, reason: "Validating storage path…" };
        return { allowed: false, reason: "Local storage path is not configured. Open storage settings to fix." };
      }

      if (!settings.cloudEnabled) {
        if (!settings.setupComplete) return { allowed: false, reason: "Storage not configured. Open storage settings." };
        return { allowed: false, reason: "No storage available. Enable cloud or configure local paths." };
      }

      return { allowed: true };
    },
    [settings],
  );

  // ── Derived values ─────────────────────────────────────────────────────────

  const activeMode: StorageMode = (() => {
    if (settings.mode === "local") {
      // Unified: use tts as the representative key
      const allValid = settings.pathValidation.tts === "valid";
      if (allValid) return "local";
      return settings.cloudEnabled ? "cloud" : "local";
    }
    return "cloud";
  })();

  const isLocalFallback = settings.mode === "local" && activeMode === "cloud";

  const localCacheActive =
    settings.mode === "cloud" &&
    settings.localCacheEnabled &&
    settings.cacheValidation.tts === "valid";

  return (
    <StorageContext.Provider
      value={{
        settings,
        showModal,
        openModal:     () => { if (isAuthenticated) setShowModal(true); },
        closeModal:    () => setShowModal(false),
        saveSettings,
        validatePath,
        validateAllPaths,
        canUseFeature,
        activeMode,
        isLocalFallback,
        localCacheActive,
        configLoading,
        checkLocalFile,
        localFileMissingWarning,
        clearLocalFileMissingWarning: () => setLocalFileMissingWarning(null),
      }}
    >
      {children}
    </StorageContext.Provider>
  );
}

export function useStorage(): StorageContextValue {
  const ctx = useContext(StorageContext);
  if (!ctx) throw new Error("useStorage must be used inside <StorageProvider>");
  return ctx;
}
