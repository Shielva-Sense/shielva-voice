"use client";

import { Activity, RefreshCw } from "lucide-react";
import type { ServiceHealth } from "../lib/amt-api";

interface Props {
  health: Record<string, ServiceHealth>;
  onRefresh: () => void;
}

const SERVICE_META: Record<string, { port: number; model: string }> = {
  acoustic: { port: 8200, model: "Whisper Small (int8)" },
  intent: { port: 8201, model: "BART-large-MNLI" },
  speaker: { port: 8202, model: "GE2E 256-dim" },
  "shielva-tts": { port: 8203, model: "Shielva TTS (VITS + Edge TTS + RVC)" },
  vocoder: { port: 8204, model: "HiFi-GAN V1" },
  translator: { port: 8205, model: "NLLB-200-distilled-600M" },
};

export default function SystemStatus({ health, onRefresh }: Props) {
  return (
    <div className="vm-card">
      <div className="vm-card-header">
        <div className="vm-card-icon">
          <Activity size={18} strokeWidth={2} />
        </div>
        <div>
          <div className="vm-card-title">System Status</div>
          <div className="vm-card-subtitle">6 Neural ML Services</div>
        </div>
        <button
          className="vm-btn vm-btn-sm"
          style={{ marginLeft: "auto" }}
          onClick={onRefresh}
          title="Refresh health"
          aria-label="Refresh service health"
        >
          <RefreshCw size={12} strokeWidth={2.5} />
        </button>
      </div>

      <div className="vm-status-grid">
        {Object.entries(SERVICE_META).map(([key, meta]) => {
          const h = health[key];
          const status = h?.status || "loading";

          const cardClass =
          status === "online"  ? "status-online"  :
          status === "warming" ? "status-warming"  :
          status === "offline" ? "status-offline"  : "";
        const label =
          status === "online"  ? "Online"   :
          status === "warming" ? "Warming…"  :
          status === "offline" ? "Offline"  : "…";

        return (
            <div key={key} className={`vm-status-card ${cardClass}`}>
              <div className="vm-status-name">{h?.name || key}</div>
              <div className={`vm-status-indicator ${status}`}>
                {label}
              </div>
              <div className="vm-status-detail">
                :{meta.port} &middot; {meta.model}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
