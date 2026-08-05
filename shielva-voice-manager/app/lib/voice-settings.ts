/**
 * Engine settings service — talks to presence-core through the API gateway.
 *
 * presence-core owns provider selection for the whole platform (voice.shielva.ai
 * and speech.shielva.ai are forks of one another, so putting the setting in
 * either UI would mean building and maintaining it twice). This module is a thin
 * typed client over those endpoints; all the selection and entitlement logic
 * lives server-side.
 */

const GATEWAY_BASE = process.env.NEXT_PUBLIC_IDENTITY_URL || "https://api.shielva.ai";
const VOICE_BASE = `${GATEWAY_BASE}/presence/api/v1/voice`;

/** One selectable engine, as reported by the live health probe. */
export interface EngineRow {
  id: string;
  kind: "tts" | "stt";
  /**
   * Tri-state on purpose. `null` means no probe exists for this engine —
   * which is NOT the same as healthy, and the UI must not render it as a tick.
   */
  healthy: boolean | null;
  detail: string;
  /** Only populated by engines that actually publish it (ElevenLabs characters). */
  quota_left: number | null;
  /** False → render the option disabled. The server decided this, not the UI. */
  selectable: boolean;
}

export interface EngineCatalog {
  active: { tts: string; stt: string };
  tts: EngineRow[];
  stt: EngineRow[];
}

export interface PresetVoice {
  voice_id: string;
  name: string;
  language: string;
  /** Normalized server-side to exactly "male" | "female" | null. */
  gender: "male" | "female" | null;
  description: string | null;
  tags: Record<string, unknown>;
}

export interface VoiceSettings {
  tenant_id: string;
  tts_provider: string | null;
  stt_provider: string | null;
  /** Engine names that have a customer key on file. Never the keys themselves. */
  byok_configured: string[];
  updated_at: string | null;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${VOICE_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    // Surface the server's own message: these endpoints return actionable
    // detail ("quota exhausted on the free plan", "model not available to this
    // account") that a generic "request failed" would throw away.
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = String(body.detail);
    } catch {
      /* non-JSON error body — keep the status line */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export const listEngines = (): Promise<EngineCatalog> => req<EngineCatalog>("/engines");

export const listEngineVoices = (engine: string): Promise<{ engine: string; voices: PresetVoice[] }> =>
  req(`/engines/${encodeURIComponent(engine)}/voices`);

export const getSettings = (): Promise<VoiceSettings> => req<VoiceSettings>("/settings");

export const saveEngines = (body: {
  tts_provider?: string;
  stt_provider?: string;
}): Promise<VoiceSettings> => req<VoiceSettings>("/settings", { method: "PUT", body: JSON.stringify(body) });

export const saveByokKey = (engine: string, apiKey: string): Promise<VoiceSettings> =>
  req<VoiceSettings>(`/settings/byok/${encodeURIComponent(engine)}`, {
    method: "PUT",
    body: JSON.stringify({ api_key: apiKey }),
  });

export const deleteByokKey = (engine: string): Promise<VoiceSettings> =>
  req<VoiceSettings>(`/settings/byok/${encodeURIComponent(engine)}`, { method: "DELETE" });

/** Human label for an engine id. Keeps vendor casing consistent across the UI. */
export const ENGINE_LABELS: Record<string, string> = {
  shielva: "Cloud GPU (Shielva)",
  cartesia: "Cartesia",
  elevenlabs: "ElevenLabs",
  amt: "Cloud GPU (Whisper)",
  groq: "Groq Whisper",
};

export const engineLabel = (id: string): string => ENGINE_LABELS[id] ?? id;
