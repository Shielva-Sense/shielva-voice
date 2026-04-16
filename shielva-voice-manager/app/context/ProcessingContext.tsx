"use client";

import { createContext, useContext, useCallback, useRef, useState } from "react";

/* ─── Types ─── */

export interface ProcessingStage {
  label: string;
  percent: number;
}

export interface ProcessingLog {
  id: string;
  message: string;
  timestamp: number;
}

interface ProcessingState {
  active: boolean;
  stages: ProcessingStage[];
  currentStage: number;
  percent: number;
  status: "idle" | "processing" | "done";
  logs: ProcessingLog[];
}

interface ProcessingAPI {
  /** Start a new processing session with defined stages */
  startProcessing: (stages: ProcessingStage[]) => void;
  /** Advance to the next stage */
  nextStage: (logMessage?: string) => void;
  /** Jump to a specific stage index */
  setStage: (index: number, logMessage?: string) => void;
  /** Set an arbitrary percent (overrides stage-based percent) */
  setPercent: (percent: number) => void;
  /** Add a log message */
  addLog: (message: string) => void;
  /** Mark processing as complete — shows "Processed" then fades out */
  complete: (logMessage?: string) => void;
  /** Cancel / reset immediately */
  cancel: () => void;
  /** Current state */
  state: ProcessingState;
}

const INITIAL: ProcessingState = {
  active: false,
  stages: [],
  currentStage: -1,
  percent: 0,
  status: "idle",
  logs: [],
};

const ProcessingContext = createContext<ProcessingAPI | null>(null);

let logIdCounter = 0;

export function ProcessingProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ProcessingState>(INITIAL);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearFade = () => {
    if (fadeTimer.current) {
      clearTimeout(fadeTimer.current);
      fadeTimer.current = null;
    }
  };

  const pushLog = useCallback((message: string) => {
    const log: ProcessingLog = {
      id: `log-${++logIdCounter}`,
      message,
      timestamp: Date.now(),
    };
    setState((s) => ({
      ...s,
      logs: [...s.logs.slice(-19), log], // keep last 20
    }));
  }, []);

  const startProcessing = useCallback(
    (stages: ProcessingStage[]) => {
      clearFade();
      setState({
        active: true,
        stages,
        currentStage: 0,
        percent: stages.length > 0 ? stages[0].percent : 0,
        status: "processing",
        logs: [],
      });
      if (stages.length > 0) {
        pushLog(stages[0].label);
      }
    },
    [pushLog]
  );

  const nextStage = useCallback(
    (logMessage?: string) => {
      setState((s) => {
        const next = s.currentStage + 1;
        if (next >= s.stages.length) return s;
        const msg = logMessage || s.stages[next]?.label;
        if (msg) setTimeout(() => pushLog(msg), 0);
        return {
          ...s,
          currentStage: next,
          percent: s.stages[next]?.percent ?? s.percent,
        };
      });
    },
    [pushLog]
  );

  const setStage = useCallback(
    (index: number, logMessage?: string) => {
      setState((s) => {
        if (index < 0 || index >= s.stages.length) return s;
        const msg = logMessage || s.stages[index]?.label;
        if (msg) setTimeout(() => pushLog(msg), 0);
        return {
          ...s,
          currentStage: index,
          percent: s.stages[index]?.percent ?? s.percent,
        };
      });
    },
    [pushLog]
  );

  const setPercent = useCallback((percent: number) => {
    // Monotonic — progress never goes backwards (prevents backward jumps on fallback paths)
    setState((s) => ({ ...s, percent: Math.min(100, Math.max(s.percent, percent)) }));
  }, []);

  const addLog = useCallback(
    (message: string) => {
      pushLog(message);
    },
    [pushLog]
  );

  const complete = useCallback(
    (logMessage?: string) => {
      clearFade();
      if (logMessage) pushLog(logMessage);
      else pushLog("Processed");

      setState((s) => ({
        ...s,
        percent: 100,
        status: "done",
      }));

      // Auto-dismiss after 2s
      fadeTimer.current = setTimeout(() => {
        setState(INITIAL);
      }, 2200);
    },
    [pushLog]
  );

  const cancel = useCallback(() => {
    clearFade();
    setState(INITIAL);
  }, []);

  return (
    <ProcessingContext.Provider
      value={{ startProcessing, nextStage, setStage, setPercent, addLog, complete, cancel, state }}
    >
      {children}
    </ProcessingContext.Provider>
  );
}

export function useProcessing(): ProcessingAPI {
  const ctx = useContext(ProcessingContext);
  if (!ctx) throw new Error("useProcessing must be used within ProcessingProvider");
  return ctx;
}
