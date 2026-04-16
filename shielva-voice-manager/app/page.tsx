"use client";

import { useEffect, useState, useCallback } from "react";
import { LogIn, LogOut, User, Crown, Sun, Moon, Cloud, HardDrive } from "lucide-react";
import Image from "next/image";
import { SERVICES, checkHealth, type ServiceHealth } from "./lib/amt-api";
import SessionTimer from "./components/SessionTimer";
import SpeechToText from "./components/SpeechToText";
import TextToSpeech from "./components/TextToSpeech";
import VoiceLibrary from "./components/VoiceLibrary";
import Translator from "./components/Translator";
import IntentClassifier from "./components/IntentClassifier";
import SystemStatus from "./components/SystemStatus";
import RealTimeVoice from "./components/RealTimeVoice";
import AnalyticsWidget from "./components/AnalyticsWidget";
import VoiceTraining from "./components/VoiceTraining";
import { useAuth } from "./context/AuthContext";
import { useStorage } from "./context/StorageContext";
import SyncWidget from "./components/SyncWidget";

export default function Home() {
  const [health, setHealth] = useState<Record<string, ServiceHealth>>({});
  // SSR-safe: always "dark" on server (matches layout.tsx inline script fallback).
  // After mount, reads localStorage / time-based preference to avoid hydration mismatch.
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const { user, isAuthenticated, isLoading, usageInfo, login, logout } = useAuth();
  const { settings: storageSettings, activeMode, isLocalFallback, openModal: openStorageModal, configLoading: storageConfigLoading } = useStorage();

  // Hydrate theme from localStorage / time-of-day after first client render
  useEffect(() => {
    const saved = localStorage.getItem("vm-theme") as "dark" | "light" | null;
    const hour = new Date().getHours();
    const resolved = saved ?? (hour >= 6 && hour < 20 ? "light" : "dark");
    setTheme(resolved);
    // data-theme already set by inline script in layout.tsx — just keep in sync
    document.documentElement.setAttribute("data-theme", resolved);
  }, []);

  // Sync theme to <html data-theme="..."> and persist manual overrides.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("vm-theme", theme);
  }, [theme]);

  const refreshHealth = useCallback(async () => {
    const results: Record<string, ServiceHealth> = {};
    await Promise.all(
      SERVICES.map(async (svc) => {
        const h = await checkHealth(svc.url);
        results[svc.key] = {
          name: svc.label,
          url: svc.url,
          // ok + loading = model still warming up (amber), ok alone = green, else red
          status: h.ok ? (h.loading ? "warming" : "online") : "offline",
          detail: h.detail,
        };
      })
    );
    setHealth(results);
  }, []);

  useEffect(() => {
    refreshHealth();
    const interval = setInterval(refreshHealth, 15000);
    return () => clearInterval(interval);
  }, [refreshHealth]);

  const onlineCount = Object.values(health).filter((h) => h.status === "online" || h.status === "warming").length;

  const planLabel = usageInfo?.plan
    ? usageInfo.plan.charAt(0).toUpperCase() + usageInfo.plan.slice(1)
    : null;

  return (
    <div className="vm-root">
      {/* ─── Header ─── */}
      <header className="vm-header">
        <div className="vm-logo">
          <div className="vm-logo-icon">
            <Image src="/shielva_brand_logo.svg" alt="Shielva" width={34} height={34} />
          </div>
          <div className="vm-logo-text">
            Shielva <span>Voice</span>
          </div>
        </div>

        <div className="vm-header-right">
          {/* Storage mode badge — authenticated users only (public auto-uses local /tmp silently) */}
          {isAuthenticated && (
            <button
              className="vm-storage-badge"
              onClick={openStorageModal}
              title="Storage settings — click to configure"
              data-mode={storageConfigLoading ? "loading" : activeMode}
              data-fallback={isLocalFallback ? "true" : undefined}
            >
              {storageConfigLoading ? (
                <span style={{ width: 10, height: 10, border: "1.5px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
              ) : activeMode === "cloud" ? (
                <Cloud size={13} strokeWidth={2} />
              ) : (
                <HardDrive size={13} strokeWidth={2} />
              )}
              <span>
                {storageConfigLoading
                  ? "Loading…"
                  : activeMode === "cloud"
                    ? (storageSettings.mode === "local" && isLocalFallback ? "Cloud (fallback)" : "Cloud")
                    : "Local"}
              </span>
              <span className="vm-storage-badge__dot" />
            </button>
          )}

          {/* Global sync — authenticated users only */}
          {isAuthenticated && <SyncWidget />}

          <button
            className="vm-theme-toggle"
            onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}
            title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          >
            {theme === "dark" ? <Sun size={15} strokeWidth={2} /> : <Moon size={15} strokeWidth={2} />}
          </button>
          <span className="vm-header-service-count">
            {onlineCount}/{SERVICES.length} online
          </span>
          <div className="vm-status-dots">
            {SERVICES.map((svc) => (
              <div
                key={svc.key}
                className={`vm-dot ${health[svc.key]?.status || "loading"}`}
                title={`${svc.label}: ${health[svc.key]?.status || "checking..."}`}
              />
            ))}
          </div>

          {/* Plan badge — links to /plans */}
          {isAuthenticated && planLabel && (
            <a href="/plans" className="vm-plan-badge" title={`${planLabel} plan — View plans`}>
              <Crown size={12} strokeWidth={2.5} />
              {planLabel}
            </a>
          )}

          {/* Public session countdown — only shown when not authenticated */}
          {!isLoading && !isAuthenticated && (
            <SessionTimer onExpired={() => {}} />
          )}

          {/* Auth button */}
          {!isLoading && (
            isAuthenticated ? (
              <div className="vm-auth-user">
                <User size={14} />
                <span className="vm-auth-name">{user?.name || user?.email || "Account"}</span>
                <button className="vm-auth-btn" onClick={logout} title="Sign out">
                  <LogOut size={14} />
                </button>
              </div>
            ) : (
              <button className="vm-auth-btn vm-auth-btn--login" onClick={login} title="Sign in for full access">
                <LogIn size={14} />
                <span>Sign in</span>
              </button>
            )
          )}
        </div>
      </header>

      {/* ─── Hero ─── */}
      <section className="vm-hero">
        <h1>
          <span className="accent">Voice Intelligence</span> Platform
        </h1>
        <p>
          Real-time speech recognition, voice cloning, neural translation, and intent
          detection — powered by Whisper, Shielva TTS, HiFi-GAN, and NLLB.
        </p>
        {!isAuthenticated && !isLoading && (
          <p className="vm-hero-trial-note">
            <button className="vm-hero-signin-link" onClick={login}>
              Sign in
            </button>{" "}
            to start using voice features with your plan.
          </p>
        )}
      </section>

      {/* ─── Feature Grid ─── */}
      <div className="vm-grid">
        {isAuthenticated && <AnalyticsWidget />}
        <SpeechToText />
        <TextToSpeech />
        <VoiceLibrary />
        {isAuthenticated && <VoiceTraining />}
        <Translator />
        {isAuthenticated && <IntentClassifier />}
        {isAuthenticated && <RealTimeVoice />}
        {isAuthenticated && <SystemStatus health={health} onRefresh={refreshHealth} />}
      </div>

      {/* ─── Footer ─── */}
      <footer className="vm-footer">
        Shielva Voice-AMT Engine v1.0 &middot; 7 Neural Services &middot; Multi-Tenant
      </footer>

      <style>{`
        .vm-auth-user {
          display: flex;
          align-items: center;
          gap: 6px;
          color: var(--text-muted, #888);
          font-size: 13px;
        }
        .vm-auth-name {
          max-width: 120px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .vm-auth-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          background: transparent;
          border: 1px solid var(--border, #1a1a1a);
          color: var(--text-muted, #888);
          border-radius: 6px;
          padding: 4px 10px;
          font-size: 12px;
          cursor: pointer;
          transition: border-color 0.15s, color 0.15s;
        }
        .vm-auth-btn:hover {
          border-color: var(--bamboo-600, #6d9f37);
          color: var(--white, #fff);
        }
        .vm-auth-btn--login {
          border-color: rgba(109,159,55,0.4);
          color: var(--bamboo-400, #a3c96e);
        }
        .vm-auth-btn--login:hover {
          background: rgba(109,159,55,0.08);
        }
        .vm-hero-trial-note {
          font-size: 13px;
          color: var(--text-muted, #888);
          margin-top: 8px;
        }
        .vm-hero-signin-link {
          background: none;
          border: none;
          color: var(--bamboo-400, #a3c96e);
          cursor: pointer;
          font-size: 13px;
          padding: 0;
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .vm-hero-signin-link:hover {
          color: var(--bamboo-300, #c5e08a);
        }
        a.vm-plan-badge {
          text-decoration: none;
        }
        .vm-plan-badge:hover {
          background: rgba(109,159,55,0.2);
          border-color: var(--bamboo-500, #6d9f37);
        }
        .vm-plan-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          font-weight: 600;
          color: var(--bamboo-400, #a3c96e);
          background: rgba(109,159,55,0.1);
          border: 1px solid rgba(109,159,55,0.25);
          border-radius: 12px;
          padding: 2px 10px 2px 7px;
          letter-spacing: 0.3px;
          text-transform: capitalize;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s;
        }
      `}</style>
    </div>
  );
}
