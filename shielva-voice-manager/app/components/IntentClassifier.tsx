"use client";

import { useState } from "react";
import { BrainCircuit, ArrowRight } from "lucide-react";
import { notify } from "../lib/toast";
import { isQuotaExceededError, classifyIntent, type IntentResult } from "../lib/amt-api";
import { useProcessing } from "../context/ProcessingContext";
import { useAuth } from "../context/AuthContext";
import UsageIndicator from "./UsageIndicator";

const INTENT_STAGES = [
  { label: "Analyzing text...", percent: 20 },
  { label: "Running BART-large-MNLI...", percent: 60 },
  { label: "Scoring intents...", percent: 90 },
];

export default function IntentClassifier() {
  const [text, setText] = useState("");
  const [classifying, setClassifying] = useState(false);
  const [result, setResult] = useState<IntentResult | null>(null);
  const proc = useProcessing();
  const { isAuthenticated, refreshUsage } = useAuth();

  const handleClassify = async () => {
    if (!text.trim()) return;
    setClassifying(true);
    proc.startProcessing(INTENT_STAGES);

    try {
      proc.addLog("Sending text for classification...");
      proc.nextStage("Classifying with zero-shot NLI...");
      const res = await classifyIntent(text);
      setResult(res);
      proc.nextStage();
      proc.complete(`Intent detected: ${res.intent}`);
      if (isAuthenticated) refreshUsage();
    } catch (err) {
      proc.cancel();
      if (isQuotaExceededError(err)) {
        notify.quotaExceeded(err.quota);
      } else {
        notify.serviceOffline("Intent Classifier (BART-large-MNLI)");
      }
    } finally {
      setClassifying(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleClassify();
    }
  };

  const sortedScores = result
    ? Object.entries(result.all_scores)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 6)
    : [];

  return (
    <div className="vm-card vm-card-full">
      <div className="vm-card-header">
        <div className="vm-card-icon">
          <BrainCircuit size={18} strokeWidth={2} />
        </div>
        <div>
          <div className="vm-card-title">Intent Classifier</div>
          <div className="vm-card-subtitle">BART-large-MNLI Zero-Shot (12 intents)</div>
        </div>
        <UsageIndicator resource="text" />
      </div>

      {/* Input */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <input
          className="vm-input"
          placeholder='Try: "Search the knowledge base for onboarding docs"'
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={classifying}
          style={{ flex: "1 1 200px", minWidth: 0 }}
        />
        <button
          className="vm-btn vm-btn-primary"
          onClick={handleClassify}
          disabled={classifying || !text.trim()}
        >
          {classifying ? <div className="vm-spinner" /> : <ArrowRight size={14} strokeWidth={2.5} />}
        </button>
      </div>

      {/* Results */}
      {result && (
        <div className="vm-fade-in">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: "var(--gray-300)" }}>Top intent:</span>
            <span className="vm-tag vm-tag-bamboo">{result.intent}</span>
            <span style={{ fontSize: 13, color: "var(--gray-400)", fontWeight: 500 }}>
              {(result.confidence * 100).toFixed(1)}%
            </span>
          </div>

          {/* Score bars */}
          <div>
            {sortedScores.map(([label, score]) => (
              <div key={label} className="vm-intent-bar">
                <span className="vm-intent-label">{label.replace(/_/g, " ")}</span>
                <div className="vm-intent-track">
                  <div className="vm-intent-fill" style={{ width: `${score * 100}%` }} />
                </div>
                <span className="vm-intent-score">{(score * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
