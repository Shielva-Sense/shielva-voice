"use client";

import { useState, useRef, useEffect } from "react";
import { BarChart3, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import "./UsageIndicator.css";

interface Props {
  /** Which resource this card primarily uses */
  resource: "text" | "voice" | "both";
}

export default function UsageIndicator({ resource }: Props) {
  const { isAuthenticated, usageInfo } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (!isAuthenticated || !usageInfo) return null;

  const { usage, quotas, plan } = usageInfo;

  const fmt = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toLocaleString("en-US");
  };

  const fmtMin = (n: number) =>
    n.toLocaleString("en-US", { maximumFractionDigits: 1 });

  const textPct =
    quotas.text_chars === -1
      ? -1
      : Math.min(100, (usage.text_chars / quotas.text_chars) * 100);

  const voicePct =
    quotas.voice_minutes === -1
      ? -1
      : Math.min(100, (usage.voice_minutes / quotas.voice_minutes) * 100);

  // Determine which bars to highlight based on card resource type
  const showText = resource === "text" || resource === "both";
  const showVoice = resource === "voice" || resource === "both";

  return (
    <div className="usage-ind" ref={ref}>
      <button
        className="usage-ind-btn"
        onClick={() => setOpen(!open)}
        title="View usage"
      >
        <BarChart3 size={14} strokeWidth={2} />
      </button>

      {open && (
        <div className="usage-ind-popup">
          <div className="usage-ind-header">
            <span className="usage-ind-plan">{plan} plan</span>
            <button className="usage-ind-close" onClick={() => setOpen(false)}>
              <X size={12} />
            </button>
          </div>

          {/* Text chars */}
          {showText && (
            <div className="usage-ind-row">
              <div className="usage-ind-label">Text Characters</div>
              <div className="usage-ind-bar">
                <div
                  className={`usage-ind-fill ${textPct === -1 ? "unlimited" : textPct > 80 ? "warning" : ""}`}
                  style={textPct === -1 ? { width: "100%" } : { width: `${textPct}%` }}
                />
              </div>
              <div className="usage-ind-stat">
                {fmt(usage.text_chars)} /{" "}
                {quotas.text_chars === -1 ? "∞" : fmt(quotas.text_chars)}
              </div>
            </div>
          )}

          {/* Voice minutes */}
          {showVoice && (
            <div className="usage-ind-row">
              <div className="usage-ind-label">Voice Minutes</div>
              <div className="usage-ind-bar">
                <div
                  className={`usage-ind-fill ${voicePct === -1 ? "unlimited" : voicePct > 80 ? "warning" : ""}`}
                  style={voicePct === -1 ? { width: "100%" } : { width: `${voicePct}%` }}
                />
              </div>
              <div className="usage-ind-stat">
                {fmtMin(usage.voice_minutes)} /{" "}
                {quotas.voice_minutes === -1 ? "∞" : fmt(quotas.voice_minutes)}
              </div>
            </div>
          )}

          <a href="/plans" className="usage-ind-link">
            Usage & billing →
          </a>
        </div>
      )}
    </div>
  );
}
