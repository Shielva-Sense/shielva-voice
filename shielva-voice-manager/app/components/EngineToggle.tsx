"use client";

import type { TranslateEngine } from "../lib/amt-api";

interface Props {
  value: TranslateEngine;
  onChange: (engine: TranslateEngine) => void;
  disabled?: boolean;
  /** Optional uppercase label rendered above the toggle (vm-label style). */
  label?: string;
}

interface EngineOption {
  id: TranslateEngine;
  label: string;
  hint: string;
}

// Qwen is the commercial-safe default; NLLB is faster but non-commercial.
const ENGINES: readonly EngineOption[] = [
  { id: "qwen", label: "Qwen", hint: "commercial-safe" },
  { id: "nllb", label: "NLLB", hint: "faster" },
];

/**
 * Segmented control for choosing the translation engine. Mirrors the visual
 * language of the other vm-* toggles (e.g. the Whisper model selector).
 */
export default function EngineToggle({ value, onChange, disabled, label }: Props) {
  return (
    <div>
      {label && <div className="vm-label">{label}</div>}
      <div className="vm-engine-toggle" role="group" aria-label="Translation engine">
        {ENGINES.map((engine) => (
          <button
            key={engine.id}
            type="button"
            disabled={disabled}
            aria-pressed={value === engine.id}
            onClick={() => onChange(engine.id)}
            className={`vm-engine-toggle-btn${value === engine.id ? " is-active" : ""}`}
          >
            <span className="vm-engine-toggle-label">{engine.label}</span>
            <span className="vm-engine-toggle-hint">{engine.hint}</span>
          </button>
        ))}
      </div>
      {value === "nllb" && (
        <div className="vm-engine-toggle-note">NLLB-200 is non-commercial (CC-BY-NC).</div>
      )}
    </div>
  );
}
