"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { useProcessing, type ProcessingLog } from "../context/ProcessingContext";
import "./ProcessingOverlay.css";

const RING_RADIUS = 73;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const LOG_VISIBLE_MS = 2500;
const MAX_VISIBLE_LOGS = 4;

interface VisibleLog extends ProcessingLog {
  exiting: boolean;
}

export default function ProcessingOverlay() {
  const { state } = useProcessing();
  const { active, percent, status, stages, currentStage, logs } = state;

  // Track visible/exiting logs
  const [visibleLogs, setVisibleLogs] = useState<VisibleLog[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const prevLogsLen = useRef(0);

  // Overlay visibility with exit animation
  const [show, setShow] = useState(false);
  const [phase, setPhase] = useState<"entering" | "visible" | "exiting">("entering");

  useEffect(() => {
    if (active) {
      setShow(true);
      setPhase("entering");
      const t = setTimeout(() => setPhase("visible"), 500);
      return () => clearTimeout(t);
    } else if (show) {
      setPhase("exiting");
      const t = setTimeout(() => {
        setShow(false);
        setVisibleLogs([]);
        timersRef.current.forEach((t) => clearTimeout(t));
        timersRef.current.clear();
        prevLogsLen.current = 0;
      }, 700);
      return () => clearTimeout(t);
    }
  }, [active, show]);

  // Handle new logs
  useEffect(() => {
    if (logs.length > prevLogsLen.current) {
      const newLogs = logs.slice(prevLogsLen.current);
      prevLogsLen.current = logs.length;

      setVisibleLogs((prev) => {
        const updated = [...prev];
        for (const log of newLogs) {
          updated.push({ ...log, exiting: false });
        }
        // Trim to max visible
        return updated.slice(-MAX_VISIBLE_LOGS * 2);
      });

      // Schedule exit for each new log
      for (const log of newLogs) {
        const exitTimer = setTimeout(() => {
          setVisibleLogs((prev) =>
            prev.map((l) => (l.id === log.id ? { ...l, exiting: true } : l))
          );
          // Remove after exit animation
          const removeTimer = setTimeout(() => {
            setVisibleLogs((prev) => prev.filter((l) => l.id !== log.id));
            timersRef.current.delete(log.id);
          }, 500);
          timersRef.current.set(log.id + "-rm", removeTimer);
        }, LOG_VISIBLE_MS);
        timersRef.current.set(log.id, exitTimer);
      }
    }
  }, [logs]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach((t) => clearTimeout(t));
    };
  }, []);

  if (!show) return null;

  const isDone = status === "done";
  const fillPercent = percent / 2; // Each side fills 50% max
  const dashOffset = RING_CIRCUMFERENCE - (percent / 100) * RING_CIRCUMFERENCE;
  const stageLabel = !isDone && stages[currentStage]?.label;

  const displayLogs = visibleLogs.slice(-MAX_VISIBLE_LOGS);

  return (
    <div className={`proc-overlay ${phase}`}>
      {/* ─── Log Strip (top center) ─── */}
      <div className="proc-log-strip">
        {displayLogs.map((log) => (
          <div
            key={log.id}
            className={`proc-log-item ${log.exiting ? "exiting" : ""}`}
          >
            {log.message}
          </div>
        ))}
      </div>

      {/* ─── Progress Strip + Circle (center) ─── */}
      <div className={`proc-strip-container ${phase === "entering" ? "entering" : phase === "exiting" ? "exiting" : ""}`}>
        {/* Track */}
        <div className="proc-strip-track">
          {/* Left fill */}
          <div
            className="proc-strip-fill-left"
            style={{ width: `${fillPercent}%` }}
          />
          {/* Right fill */}
          <div
            className="proc-strip-fill-right"
            style={{ width: `${fillPercent}%` }}
          />
        </div>

        {/* Center Circle */}
        <div
          className={[
            "proc-circle",
            phase === "entering" ? "entering" : "",
            isDone ? "done" : "",
            isDone && phase === "exiting" ? "done-exit" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {/* Ring SVG */}
          <svg className="proc-ring" viewBox="0 0 158 158">
            <circle className="proc-ring-bg" cx="79" cy="79" r={RING_RADIUS} />
            <circle
              className="proc-ring-fill"
              cx="79"
              cy="79"
              r={RING_RADIUS}
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
            />
          </svg>

          {isDone ? (
            <>
              <Check className="proc-checkmark" strokeWidth={2.5} />
              <span className="proc-done-label">Processed</span>
            </>
          ) : (
            <>
              <span className="proc-percent">
                {Math.round(percent)}
                <span className="proc-percent-sign">%</span>
              </span>
            </>
          )}

          {/* Stage label below circle */}
          {stageLabel && !isDone && (
            <span className="proc-stage-label">{stageLabel}</span>
          )}
        </div>
      </div>
    </div>
  );
}
