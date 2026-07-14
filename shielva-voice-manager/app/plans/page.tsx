"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import { ArrowLeft, Plus, Mic, Zap, Loader } from "lucide-react";
import Link from "next/link";
import { useAuth } from "../context/AuthContext";
import { notify } from "../lib/toast";
import {
  VOICE_TOPUP,
  deriveVoiceCredits,
  deriveVoiceAgentStatus,
  purchaseVoiceTopup,
  type VoiceAgentStatus,
} from "../lib/voice-billing";
import "./plans.css";

/* ─── Voice-agent status presentation ─── */

const AGENT_STATUS: Record<VoiceAgentStatus, { label: string; tone: string }> = {
  included: { label: "Included with plan", tone: "ok" },
  active: { label: "Active", tone: "ok" },
  depleted: { label: "Out of credits", tone: "warn" },
  inactive: { label: "Not active", tone: "muted" },
};

/* ─── Component ─── */

export default function UsageBillingPage() {
  const { user, isAuthenticated, isLoading, usageInfo, refreshUsage, login } = useAuth();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [purchasing, setPurchasing] = useState(false);

  const credits = deriveVoiceCredits(usageInfo);
  const agentStatus = deriveVoiceAgentStatus(usageInfo);
  const tenantId = user?.tenants?.[0] ?? "";

  const fmt = (n: number) => n.toLocaleString("en-US");

  const usedPct =
    credits && !credits.unlimited && credits.granted > 0
      ? Math.min(100, (credits.consumed / credits.granted) * 100)
      : 0;

  const handleTopup = async () => {
    if (!tenantId) return;
    setPurchasing(true);
    try {
      const result = await purchaseVoiceTopup(tenantId);
      notify.success(
        "Extra usage added",
        `${fmt(VOICE_TOPUP.grantsCredits)} voice credits added — ${fmt(
          result.voice_credits_remaining
        )} remaining.`
      );
      setConfirmOpen(false);
      await refreshUsage();
    } catch (e) {
      notify.error(
        "Top-up failed",
        e instanceof Error ? e.message : "Please try again later."
      );
    } finally {
      setPurchasing(false);
    }
  };

  const status = AGENT_STATUS[agentStatus];

  return (
    <div className="plans-page">
      {/* Back */}
      <Link href="/" className="plans-back">
        <ArrowLeft size={15} />
        Back to Dashboard
      </Link>

      {/* Header */}
      <div className="plans-header">
        <h1 className="plans-title">Usage &amp; Billing</h1>
        <p className="plans-subtitle">
          Track your voice credits and top up when you need more.
        </p>
      </div>

      {/* Not signed in */}
      {!isAuthenticated && !isLoading && (
        <div className="usage-panel usage-signin">
          <p className="usage-signin-text">
            Sign in to view your voice usage and manage billing.
          </p>
          <button className="usage-topup-btn" onClick={login}>
            Sign in
          </button>
        </div>
      )}

      {/* Signed in */}
      {isAuthenticated && credits && (
        <div className="usage-wrap">
          {/* Voice-agent status */}
          <div className="usage-agent-row">
            <div className="usage-agent-icon" aria-hidden="true">
              <Mic size={16} strokeWidth={2} />
            </div>
            <div className="usage-agent-body">
              <div className="usage-agent-label">Voice agent</div>
              <div className="usage-agent-hint">
                {usageInfo?.plan
                  ? `${usageInfo.plan} plan`
                  : "Voice intelligence"}
              </div>
            </div>
            <span className={`usage-agent-status usage-agent-status--${status.tone}`}>
              <span className="usage-agent-dot" />
              {status.label}
            </span>
          </div>

          {/* Credits panel */}
          <div className="usage-panel">
            <div className="usage-panel-head">
              <div>
                <div className="usage-panel-title">Voice credits</div>
                <div className="usage-panel-sub">This billing cycle</div>
              </div>
              <button
                className="usage-topup-btn"
                onClick={() => setConfirmOpen(true)}
                disabled={!tenantId}
              >
                <Plus size={14} strokeWidth={2.5} />
                Add extra usage
              </button>
            </div>

            {credits.unlimited ? (
              <div className="usage-unlimited">
                <Zap size={15} strokeWidth={2} className="usage-unlimited-icon" />
                Voice is included with your plan &mdash; unlimited credits.
              </div>
            ) : (
              <>
                {/* Remaining headline */}
                <div className="usage-remaining">
                  <span className="usage-remaining-value">{fmt(credits.remaining)}</span>
                  <span className="usage-remaining-label">credits remaining</span>
                </div>

                {/* Bar */}
                <div className="usage-bar">
                  <div
                    className={`usage-fill ${usedPct > 85 ? "usage-fill-warn" : ""}`}
                    style={{ width: `${usedPct}%` }}
                  />
                </div>

                {/* Granted / Consumed / Remaining */}
                <div className="usage-stat-grid">
                  <div className="usage-stat">
                    <div className="usage-stat-label">Total granted</div>
                    <div className="usage-stat-value">{fmt(credits.granted)}</div>
                  </div>
                  <div className="usage-stat">
                    <div className="usage-stat-label">Consumed</div>
                    <div className="usage-stat-value">{fmt(credits.consumed)}</div>
                  </div>
                  <div className="usage-stat">
                    <div className="usage-stat-label">Remaining</div>
                    <div className="usage-stat-value">{fmt(credits.remaining)}</div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ─── Top-up confirm modal ─── */}
      {confirmOpen && (
        <div
          style={overlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="topup-title"
          onClick={() => !purchasing && setConfirmOpen(false)}
        >
          <div style={panel} onClick={(e) => e.stopPropagation()}>
            <div style={panelHeader}>
              <div>
                <div id="topup-title" style={panelTitle}>
                  Add extra usage
                </div>
                <div style={panelSub}>One-time voice-credit top-up</div>
              </div>
            </div>

            <div style={{ padding: "18px 20px 4px" }}>
              <div style={offerCard}>
                <div style={offerCardIcon} aria-hidden="true">
                  <Zap size={18} strokeWidth={1.8} />
                </div>
                <div style={{ textAlign: "left" }}>
                  <div style={offerAmount}>
                    +{VOICE_TOPUP.grantsCredits.toLocaleString("en-US")} voice credits
                  </div>
                  <div style={offerPrice}>
                    ${VOICE_TOPUP.priceUsd.toLocaleString("en-US")} one-time
                  </div>
                </div>
              </div>
              <div style={offerNote}>
                Credits are added to your balance immediately and never expire while
                your plan is active.
              </div>
            </div>

            <div style={footer}>
              <button
                style={cancelBtn}
                onClick={() => setConfirmOpen(false)}
                disabled={purchasing}
              >
                Cancel
              </button>
              <button style={confirmBtn(!purchasing)} onClick={handleTopup} disabled={purchasing}>
                {purchasing ? (
                  <>
                    <Loader size={13} style={{ animation: "spin 1s linear infinite" }} />
                    Processing…
                  </>
                ) : (
                  `Confirm — $${VOICE_TOPUP.priceUsd}`
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Modal styles (match StorageConfigModal convention, token-driven) ─── */

const overlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 2000,
  background: "rgba(0,0,0,0.7)",
  backdropFilter: "blur(6px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
};

const panel: CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  width: "100%",
  maxWidth: 440,
  display: "flex",
  flexDirection: "column",
  boxShadow: "0 24px 64px rgba(0,0,0,0.7)",
};

const panelHeader: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  padding: "18px 20px 14px",
  borderBottom: "1px solid var(--border)",
};

const panelTitle: CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: "var(--white)",
  letterSpacing: -0.3,
};

const panelSub: CSSProperties = {
  fontSize: 12,
  color: "var(--gray-400)",
  marginTop: 3,
};

const offerCard: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: 14,
  background: "rgba(109,159,55,0.07)",
  border: "1px solid rgba(109,159,55,0.35)",
  borderRadius: 10,
  textAlign: "left",
};

const offerCardIcon: CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 8,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  background: "rgba(109,159,55,0.15)",
  color: "var(--bamboo-400)",
  border: "1px solid rgba(109,159,55,0.25)",
};

const offerAmount: CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: "var(--white)",
};

const offerPrice: CSSProperties = {
  fontSize: 12,
  color: "var(--gray-400)",
  marginTop: 2,
};

const offerNote: CSSProperties = {
  fontSize: 11,
  color: "var(--gray-500)",
  marginTop: 12,
  lineHeight: 1.5,
};

const footer: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
  padding: "16px 20px",
  borderTop: "1px solid var(--border)",
  marginTop: 16,
};

const cancelBtn: CSSProperties = {
  height: 34,
  padding: "0 16px",
  background: "transparent",
  border: "1px solid var(--border-hover)",
  borderRadius: 8,
  color: "var(--gray-400)",
  fontSize: 13,
  cursor: "pointer",
};

const confirmBtn = (enabled: boolean): CSSProperties => ({
  height: 34,
  padding: "0 20px",
  background: enabled ? "var(--bamboo-500)" : "var(--gray-700)",
  border: `1px solid ${enabled ? "var(--bamboo-600)" : "var(--gray-600)"}`,
  borderRadius: 8,
  color: enabled ? "#fff" : "var(--gray-500)",
  fontSize: 13,
  fontWeight: 600,
  cursor: enabled ? "pointer" : "not-allowed",
  display: "flex",
  alignItems: "center",
  gap: 7,
  transition: "all 0.15s ease",
});
