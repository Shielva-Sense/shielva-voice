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
  /**
   * ISO codes this engine can actually speak, from the server.
   *
   * Deliberately NOT derived from the voice catalog: the vendor caps a voice
   * listing at 100, so sampling it hides most of the languages — which is how
   * the picker ended up offering a handful for an engine that speaks forty.
   */
  languages?: string[];
}

export interface EngineCatalog {
  active: { tts: string; stt: string };
  tts: EngineRow[];
  stt: EngineRow[];
}

/**
 * Store a generated clip so it can be replayed from Voice Analytics.
 *
 * Synthesis streams the audio and keeps nothing, so every generation showed up
 * in the history with a dash and no play button. Only deliberate generations
 * are uploaded — picker previews are cached in the browser and never stored.
 */
export async function uploadClip(
  audio: Blob,
  meta: { feature?: string; text?: string; language?: string; voiceId?: string; durationMs?: number },
): Promise<string> {
  const form = new FormData();
  form.append("audio", audio, "generated.wav");
  form.append("feature", meta.feature ?? "text_to_speech");
  form.append("text", (meta.text ?? "").slice(0, 200));
  form.append("language", meta.language ?? "");
  form.append("voice_id", meta.voiceId ?? "");
  form.append("duration_ms", String(Math.round(meta.durationMs ?? 0)));

  const res = await fetch(`${VOICE_BASE}/clips`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  if (!res.ok) throw new Error(await detail(res));
  const body = (await res.json()) as { url: string };
  return body.url;
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

/**
 * Preset voices published by one engine.
 *
 * `language` filters server-side — the picker must only ever offer voices that
 * can actually speak the selected output language, and every vendor's catalog
 * is far larger than one language's slice of it.
 */
export const listEngineVoices = (
  engine: string,
  opts?: { language?: string; limit?: number; owned?: boolean },
): Promise<{ engine: string; voices: PresetVoice[] }> => {
  const qs = new URLSearchParams();
  if (opts?.language) qs.set("language", opts.language);
  if (opts?.limit) qs.set("limit", String(opts.limit));
  // Vendors keep the public library and the account's own clones in separate
  // lists, so a cloned voice is invisible unless it is asked for by name.
  if (opts?.owned) qs.set("owned", "true");
  const query = qs.toString();
  return req(`/engines/${encodeURIComponent(engine)}/voices${query ? `?${query}` : ""}`);
};

export interface ClonedVoice {
  voice_id: string;
  provider: string;
  status: string;
  name: string;
  language: string;
}

/** presence-core's clone router. Separate prefix from /voice — it predates it. */
const CLONE_BASE = `${GATEWAY_BASE}/presence/api/v1/voice-clone`;

async function detail(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (body?.detail) return String(body.detail);
  } catch {
    /* non-JSON error body — fall through to the status line */
  }
  return `HTTP ${res.status}`;
}

/**
 * Clone a voice from a reference clip using the tenant's active engine.
 *
 * The UI used to post this at the GPU pod's `/amt/v1/voices/train`. That host
 * is not deployed in every environment — in prod it does not even resolve — so
 * cloning died at the network layer ("Failed to fetch") for anyone on a hosted
 * engine, even though the engine they had selected could clone perfectly well.
 *
 * This calls presence-core's EXISTING `/voice-clone/upload`, which the desktop
 * client has always used and which already dispatches per tenant — there was
 * never a reason to add a second clone endpoint. `persist=false` because that
 * flag stamps the voice onto a Presence *persona*, which is a desktop-delegate
 * concept this UI has nothing to do with.
 */
export async function cloneVoice(params: {
  audio: Blob;
  name: string;
  language?: string;
  durationMs?: number;
  /** Identifies the caller to the vendor; the tenant scopes storage. */
  userId?: string;
}): Promise<ClonedVoice> {
  const form = new FormData();
  const mime = (params.audio.type || "audio/wav").split(";")[0];
  const ext = (mime.split("/")[1] || "wav");
  form.append("sample", params.audio, `reference.${ext}`);
  form.append("user_id", params.userId || "voice-manager");
  form.append("display_name", params.name);
  form.append("language", params.language ?? "en");
  form.append("mime_type", mime);
  form.append("duration_ms", String(Math.round(params.durationMs ?? 0)));
  form.append("persist", "false");

  // No Content-Type header — the browser sets the multipart boundary itself.
  const res = await fetch(`${CLONE_BASE}/upload`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  if (!res.ok) throw new Error(await detail(res));
  const body = (await res.json()) as { voice_id: string; provider: string; status: string };
  return {
    voice_id: body.voice_id,
    provider: body.provider,
    status: body.status,
    name: params.name,
    language: params.language ?? "en",
  };
}

/**
 * Delete a cloned voice at the provider AND drop our stored reference clip.
 *
 * Deleting used to go to the cloud-GPU stores regardless of engine, so on a
 * hosted engine it simply failed ("Delete failed"). The provider call is what
 * matters: if it fails, nothing local is removed either, so the library never
 * shows a voice as gone while it is still live — and billing — at the vendor.
 */
export async function deleteClonedVoice(voiceId: string): Promise<void> {
  const res = await fetch(`${VOICE_BASE}/voices/${encodeURIComponent(voiceId)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error(await detail(res));
}

/** URL of the customer's own recording for a cloned voice. 404 if none kept. */
export const voiceSampleUrl = (voiceId: string): string =>
  `${VOICE_BASE}/voices/${encodeURIComponent(voiceId)}/sample`;

/** Fetch the stored reference clip. Returns null when none was kept. */
export async function fetchVoiceSample(voiceId: string): Promise<Blob | null> {
  const res = await fetch(voiceSampleUrl(voiceId), { credentials: "include" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await detail(res));
  return res.blob();
}

export interface SynthesizeParams {
  text: string;
  /** Preset or cloned voice. Empty → the engine's first preset for `language`. */
  voiceId?: string;
  language?: string;
  speakingRate?: number;
}

export interface SynthesizeResult {
  blob: Blob;
  /** Which engine actually produced the audio, straight from the response. */
  provider: string;
}

/**
 * Synthesize through presence-core rather than the cloud-GPU pod directly.
 *
 * presence resolves BOTH the engine and the model per tenant, so this is the
 * only call site that honours what the tenant chose in Settings. Calling
 * `/amt/v1/synthesize` instead pins every tenant to the GPU stack — which is
 * not deployed in every environment, where it simply 404s.
 *
 * The response is raw audio bytes (not JSON), so it is read as a blob.
 */
export async function synthesize(params: SynthesizeParams): Promise<SynthesizeResult> {
  const res = await fetch(`${VOICE_BASE}/synthesize`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: params.text,
      voice_id: params.voiceId ?? "",
      language: params.language ?? "en",
      speaking_rate: params.speakingRate ?? 1.0,
    }),
  });
  if (!res.ok) {
    // These carry actionable detail ("no voice_id supplied and the active
    // provider exposes no preset voices") — surface it rather than a status.
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = String(body.detail);
    } catch {
      /* non-JSON error body — keep the status line */
    }
    throw new Error(detail);
  }
  return {
    blob: await res.blob(),
    provider: res.headers.get("X-Voice-Provider") ?? "",
  };
}

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
