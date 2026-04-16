"use client";

import { useEffect, useState, useRef } from "react";
import { getPublicSessionMsRemaining, fetchSessionTiming, PUBLIC_SESSION_TTL_MS } from "../lib/amt-api";

interface Props {
  onExpired: () => void;
}

function formatHHMMSS(ms: number): string {
  if (ms <= 0) return "0:00:00";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function getUrgency(ms: number): "normal" | "warning" | "critical" {
  if (ms <= 5 * 60 * 1000) return "critical";
  if (ms <= 15 * 60 * 1000) return "warning";
  return "normal";
}

export default function SessionTimer({ onExpired }: Props) {
  const [msRemaining, setMsRemaining] = useState<number>(PUBLIC_SESSION_TTL_MS);
  const [mounted, setMounted] = useState(false);
  const expiredFired = useRef(false);

  // ── Mount: get local time first (instant), then sync with backend ───────────
  useEffect(() => {
    // Step 1: show local estimate immediately (no flicker / no wait)
    setMsRemaining(getPublicSessionMsRemaining());
    setMounted(true);

    // Step 2: fetch server-authoritative timing.
    // fetchSessionTiming() overwrites localStorage created_at with the server's value,
    // so subsequent local reads are always in sync with the backend's actual expiry.
    fetchSessionTiming().then((timing) => {
      if (timing && timing.ms_remaining != null) {
        setMsRemaining(timing.ms_remaining);
      }
    });
  }, []);

  // ── Tick every second — purely local subtraction after initial server sync ──
  useEffect(() => {
    if (!mounted) return;

    const tick = () => {
      const rem = getPublicSessionMsRemaining();
      setMsRemaining(rem);
      if (rem <= 0 && !expiredFired.current) {
        expiredFired.current = true;
        onExpired();
      }
    };

    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [mounted, onExpired]);

  // ── Re-sync with backend every 5 minutes to correct any clock drift ─────────
  useEffect(() => {
    if (!mounted) return;

    const resync = async () => {
      const timing = await fetchSessionTiming();
      if (timing && timing.ms_remaining != null) {
        setMsRemaining(timing.ms_remaining);
      }
    };

    const interval = setInterval(resync, 5 * 60 * 1000); // every 5 min
    return () => clearInterval(interval);
  }, [mounted]);

  if (!mounted) return null;

  // Session is now permanent (no TTL) — show static badge, no countdown.
  return (
    <div
      className="vm-session-timer"
      data-urgency="normal"
      title="Free trial — sign in to save your voice profiles permanently"
    >
      <div className="vm-session-timer-body">
        <span className="vm-session-timer-label">FREE TRIAL</span>
      </div>
    </div>
  );
}
