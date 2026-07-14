// Inference routes (synthesize / transcribe / voices / translate / realtime) hit
// the AMT pod directly via the single-origin tunnel — no gateway session needed.
const AMT_BASE = process.env.NEXT_PUBLIC_API_URL || "https://localhost:8000";

// Gateway-auth'd DB routes (metering / history / storage / session / sync /
// live-translation) require the Shielva session cookie, which is host-scoped to
// the identity/gateway host. Calling them there (cross-origin, CORS already
// allows the UI origin) sends the cookie; calling them via AMT_BASE would not.
const GATEWAY_BASE = process.env.NEXT_PUBLIC_IDENTITY_URL || "https://api.shielva.ai";

// ─── Public Session ID ─────────────────────────────────────────────────────────
// Persisted in localStorage. Cleared when the user signs in.
// The gateway scopes public (unauthenticated) voices per session using this ID.

const SESSION_ID_KEY = "amt_public_session_id";
// TTL removed — session is permanent until the user explicitly clears storage.
// Rotating the UUID made all previously registered voices invisible (wrong tenant_id).

export function getPublicSessionId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(SESSION_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_ID_KEY, id);
  }
  return id;
}

/** @deprecated TTL no longer applies — session is permanent. Kept for compatibility. */
export const PUBLIC_SESSION_TTL_MS = 0;
/** @deprecated No expiry. Always returns 0. */
export function getPublicSessionMsRemaining(): number { return 0; }
/** @deprecated No expiry. Always returns far future. */
export function getPublicSessionExpiresAt(): number { return Date.now() + 365 * 24 * 60 * 60 * 1000; }

// Populated by AuthContext once the user is authenticated.
// tenantId comes from user.tenants[0] — used to scope all AMT requests.
// tenantName comes from JWT tenant_name (org_name) — used for human-readable R2 paths.
let _tenantId: string | null = null;
let _tenantName: string | null = null;
// Whether the tenant backs up voice refs + generated audio to R2. Driven by the
// storage mode (cloud → true, local-only → false) via setCloudBackup(). Default
// true so cloud users (the default mode) get R2 backup; the backend also defaults
// X-Cloud-Backup on, so an unset header still backs up.
let _cloudBackup = true;

export function setAmtAuthState(authenticated: boolean, tenantId?: string, tenantName?: string): void {
  _tenantId = authenticated && tenantId ? tenantId : null;
  _tenantName = authenticated && tenantName ? tenantName : null;
}

/** Toggle R2 cloud backup for AMT writes (enroll + synthesis) — driven by storage mode. */
export function setCloudBackup(enabled: boolean): void {
  _cloudBackup = enabled;
}

function amtHeaders(extra?: Record<string, string>): Record<string, string> {
  // X-Cloud-Backup tells the backend whether to persist writes to R2 (cloud) or
  // keep them off-cloud (local-only tenants).
  const backup = { "X-Cloud-Backup": _cloudBackup ? "1" : "0" };
  // Authenticated: pass tenant_id and tenant_name so services use human-readable R2 paths.
  if (_tenantId) {
    return {
      "X-Tenant-ID": _tenantId,
      ...(_tenantName ? { "X-Tenant-Name": _tenantName } : {}),
      ...backup,
      ...extra,
    };
  }
  // Unauthenticated: scope by permanent session UUID.
  return { "X-AMT-Session-ID": getPublicSessionId(), ...backup, ...extra };
}

// ─── Health ───────────────────────────────────────────────────────────────────

export interface ServiceHealth {
  name: string;
  /** online=green, warming=amber (model loading), offline=red, loading=initial check */
  status: "online" | "warming" | "offline" | "loading";
  detail?: string;
}

// Live backend services after the Chatterbox migration.
// Removed: speaker-encoder (resemblyzer) and vocoder (HiFi-GAN) — Chatterbox clones
// zero-shot from a reference clip, so neither a speaker embedding nor a separate
// vocoder exists anymore.
export const SERVICES = [
  { key: "acoustic", label: "Speech-to-Text" },
  { key: "intent", label: "Intent" },
  { key: "shielva-tts", label: "Text-to-Speech" },
  { key: "translator", label: "Translation" },
  { key: "chatterbox", label: "Chatterbox + Indic LoRA" },
  { key: "orpheus", label: "Orpheus (streaming)" },
] as const;

interface AmtHealthResponse {
  services: Record<string, { status: "ok" | "loading" | "offline"; name?: string }>;
}

/**
 * Fetch aggregate health for every AMT service in ONE request.
 *
 * The tunnel routes `${AMT_BASE}/amt/v1/health` to the TTS pod, which probes the
 * four pod services (acoustic/intent/shielva-tts/translator) over loopback. This
 * replaces four per-service `https://localhost:820x/health` calls the browser
 * could never reach through the single-origin tunnel. Always resolves — a failed
 * request marks every service offline rather than throwing.
 */
export async function fetchAmtHealth(): Promise<Record<string, ServiceHealth>> {
  const result: Record<string, ServiceHealth> = {};
  try {
    const res = await fetch(`${AMT_BASE}/amt/v1/health`, { signal: AbortSignal.timeout(10000) });
    const data: AmtHealthResponse = res.ok ? await res.json() : { services: {} };
    for (const svc of SERVICES) {
      const status = data.services?.[svc.key]?.status;
      result[svc.key] = {
        name: svc.label,
        status: status === "ok" ? "online" : status === "loading" ? "warming" : "offline",
      };
    }
  } catch {
    for (const svc of SERVICES) {
      result[svc.key] = { name: svc.label, status: "offline" };
    }
  }
  return result;
}

// ─── 429 handler ──────────────────────────────────────────────────────────────

async function handleQuotaError(res: Response): Promise<void> {
  if (res.status === 429) {
    const data = await res.json();
    const err = new Error("Usage limit exceeded") as any;
    err.quota = data;
    throw err;
  }
}

// ─── Acoustic (Speech-to-Text) ────────────────────────────────────────────────

export interface TranscribeResult {
  text: string;
  phonemes: string[];
  detected_lang?: string;
  [key: string]: unknown;
}

export async function transcribe(audioBlob: Blob, language?: string): Promise<TranscribeResult> {
  const form = new FormData();
  form.append("audio", audioBlob, "recording.wav");

  const res = await fetch(`${AMT_BASE}/amt/v1/transcribe`, {
    method: "POST",
    headers: amtHeaders(language ? { "X-Language": language } : undefined),
    body: form,
    credentials: "include",
  });

  await handleQuotaError(res);

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Transcription failed: ${err}`);
  }
  return res.json();
}

// ─── Intent ───────────────────────────────────────────────────────────────────

export interface IntentResult {
  intent: string;
  confidence: number;
  all_scores: Record<string, number>;
}

export async function classifyIntent(text: string): Promise<IntentResult> {
  const res = await fetch(`${AMT_BASE}/amt/v1/classify`, {
    method: "POST",
    headers: amtHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ text }),
    credentials: "include",
  });
  await handleQuotaError(res);
  if (!res.ok) throw new Error("Intent classification failed");
  return res.json();
}

// ─── Voices (Chatterbox zero-shot reference clips) ───────────────────────────────
//
// A "voice" is a stored reference clip that Chatterbox clones zero-shot. There is
// no training, no speaker embedding, and no trained/untrained status — every
// enrolled voice is immediately usable for synthesis.

export interface VoiceInfo {
  voice_id: string;
  tenant_id: string;
  sample_duration_ms?: number;
  created_at?: string;
  name?: string;
  language?: string;
  /** Transcript of the reference clip — improves zero-shot cloning fidelity. */
  ref_text?: string;
}

export interface SessionTiming {
  created_at_ms: number;
  expires_at_ms: number;
  ms_remaining: number;
  server_now_ms: number;
  is_public: boolean;
}

/**
 * Fetch server-authoritative session timing.
 */
export async function fetchSessionTiming(): Promise<SessionTiming | null> {
  try {
    const res = await fetch(`${GATEWAY_BASE}/amt/v1/session`, {
      headers: amtHeaders(),
      credentials: "include",
    });
    if (!res.ok) return null;
    const data: SessionTiming = await res.json();

    return data;
  } catch {
    return null;
  }
}

export async function listVoices(): Promise<{ voices: VoiceInfo[]; total: number }> {
  const res = await fetch(`${AMT_BASE}/amt/v1/voices`, {
    headers: amtHeaders(),
    credentials: "include",
  });
  await handleQuotaError(res);
  if (!res.ok) throw new Error("Failed to list voices");
  const data = await res.json();
  return { ...data, voices: data.voices || [] };
}

/** A single progress frame emitted by the enroll SSE stream. */
export interface EnrollProgressEvent {
  progress?: number;
  message?: string;
  status?: string;
  voice_id?: string;
}

export interface EnrollVoiceParams {
  voiceId: string;
  name: string;
  /** ISO language code of the reference clip. Defaults to "en". */
  language?: string;
  /** Transcript of the clip — optional, speeds up Chatterbox synthesis. */
  refText?: string;
  /** One or more reference clips (WAV). At least one is required. */
  clips: Blob[];
  /** Invoked for each progress frame streamed during enrollment. */
  onProgress?: (event: EnrollProgressEvent) => void;
}

/**
 * Enroll a voice for Chatterbox zero-shot cloning via a single multipart POST.
 *
 * The endpoint responds with a Server-Sent Events stream (`text/event-stream`):
 * each `data: {…}` line is a JSON progress frame, ending with a final frame
 * carrying `status: "complete"` plus the stored VoiceInfo. We read the stream,
 * forward each frame to `onProgress`, and resolve with the final frame — calling
 * `res.json()` on this body would choke on the `data: ` prefix.
 * Tenant scoping (incl. the human-readable R2 path via X-Tenant-Name) comes from
 * `amtHeaders()`, which the caller must have populated via `setAmtAuthState`.
 */
export async function enrollVoice(params: EnrollVoiceParams): Promise<VoiceInfo> {
  const form = new FormData();
  form.append("voice_id", params.voiceId);
  form.append("voice_name", params.name);
  form.append("language", params.language || "en");
  if (params.refText) form.append("ref_text", params.refText);
  params.clips.forEach((blob, i) => form.append(`audio_${i}`, blob, `clip_${i}.wav`));

  const res = await fetch(`${AMT_BASE}/amt/v1/voices/train`, {
    method: "POST",
    // No Content-Type — the browser sets the multipart boundary itself.
    headers: amtHeaders(),
    body: form,
    credentials: "include",
  });
  await handleQuotaError(res);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Voice enrollment failed: ${err}`);
  }

  // No stream (shouldn't happen) — fall back to a single JSON parse.
  if (!res.body) return res.json();

  // Parse the SSE stream line-by-line: forward each `data: {…}` frame to
  // onProgress and capture the final `status: "complete"` frame as the result.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalEvent: (EnrollProgressEvent & Partial<VoiceInfo>) | null = null;

  const consume = (rawLine: string): void => {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) return; // skip blank lines + SSE comments
    const payload = line.slice(5).trim();
    if (!payload) return;
    let evt: EnrollProgressEvent & Partial<VoiceInfo>;
    try {
      evt = JSON.parse(payload);
    } catch {
      return; // ignore malformed frames
    }
    params.onProgress?.(evt);
    if (evt.status === "complete") finalEvent = evt;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      consume(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  }
  buffer += decoder.decode();
  if (buffer) consume(buffer);

  if (!finalEvent) throw new Error("Voice enrollment did not complete");
  return finalEvent as VoiceInfo;
}

export async function fetchVoiceAudio(voiceId: string): Promise<Blob> {
  // The enrolling POD owns the reference clip (disk-first, R2 fallback), so the
  // audio is served from AMT_BASE (voice.shielva.ai → :8203) — NOT the cluster
  // amt-api, which never saw pod-enrolled voices and 404s. No cookie needed.
  const res = await fetch(`${AMT_BASE}/amt/v1/voices/${voiceId}/audio`, {
    headers: amtHeaders(),
    credentials: "include",
  });
  if (res.status === 404) throw new Error("no_audio");
  if (!res.ok) throw new Error("Failed to fetch voice audio");
  return res.blob();
}

export async function deleteVoice(voiceId: string): Promise<void> {
  const res = await fetch(`${AMT_BASE}/amt/v1/voices/${voiceId}`, {
    method: "DELETE",
    headers: amtHeaders(),
    credentials: "include",
  });
  await handleQuotaError(res);
  if (!res.ok) throw new Error("Failed to delete voice");
}

/** Delete a trained voice from ALL storage layers:
 *  local files, speaker-encoder (MongoDB), R2, RVC model. */
export async function deleteVoiceFull(voiceId: string, voiceName?: string): Promise<{
  local_deleted: boolean;
  encoder_deleted: boolean;
  r2_deleted: boolean;
  rvc_deleted: boolean;
}> {
  const extraHeaders: Record<string, string> = voiceName ? { "X-Voice-Name": voiceName } : {};
  const res = await fetch(`${AMT_BASE}/amt/v1/voices/${voiceId}/full`, {
    method: "DELETE",
    headers: { ...amtHeaders(), ...extraHeaders },
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to delete voice");
  return res.json();
}

// ─── Storage config ───────────────────────────────────────────────────────────

export interface StorageConfig {
  voice_refs_dir: string;
  path_exists: boolean;
  free_gb: number | null;
  total_gb: number | null;
  cdn_service_url: string;
  voice_bucket: string;
}

export async function getStorageConfig(): Promise<StorageConfig> {
  const res = await fetch(`${GATEWAY_BASE}/amt/v1/storage/config`, {
    headers: amtHeaders(),
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch storage config");
  return res.json();
}

export async function setStorageConfig(voiceRefsDir: string): Promise<StorageConfig & { ok: boolean }> {
  const res = await fetch(`${GATEWAY_BASE}/amt/v1/storage`, {
    method: "POST",
    headers: { ...amtHeaders(), "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ voice_refs_dir: voiceRefsDir }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to update storage config");
  }
  return res.json();
}

// ─── Phase 2: Voice optimisation (pre-compute conditioning cache) ─────────────

/** Kick off background pre-computation of speaker conditioning for fast TTS. */
export async function optimizeVoice(voiceId: string): Promise<{ status: string }> {
  const res = await fetch(`${AMT_BASE}/amt/v1/voices/${voiceId}/optimize`, {
    method: "POST",
    headers: amtHeaders(),
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Optimisation failed: ${err}`);
  }
  return res.json();
}

/** Poll optimisation status. Returns true when ready. */
export async function getOptimizeStatus(voiceId: string): Promise<{ optimized: boolean }> {
  const res = await fetch(`${AMT_BASE}/amt/v1/voices/${voiceId}/optimize-status`, {
    headers: amtHeaders(),
    credentials: "include",
  });
  if (!res.ok) return { optimized: false };
  return res.json();
}

// ─── Phase 3: Real-time WebSocket pipeline ────────────────────────────────────

export interface RealtimeConfig {
  srcLang: string;
  tgtLang: string;
  /** Cloned/registered voice for Chatterbox. Omit for the default reference. */
  voiceId?: string;
  voiceName?: string;
  tenantName?: string;
  sampleRate?: number;
  /** Translation engine — "qwen" (commercial-safe, default) or "nllb" (faster). */
  engine?: TranslateEngine;
  /** TTS engine for the spoken output — "chatterbox" (clones, all languages) or
   *  "orpheus" (fast English streaming). Empty → server default (chatterbox). */
  ttsEngine?: TtsEngine;
}

// NOTE: the realtime pipeline transcribes in-process on the TTS router with a fixed
// faster-whisper model (ASR_WHISPER_MODEL_SIZE, default large-v3-turbo) — it is not
// switchable per session, so the acoustic-model list/preload endpoints on :8200 are
// intentionally not consumed here.

export interface RealtimeEvent {
  type: "ready" | "audio" | "transcript" | "translation" | "error" | "ping";
  wav_b64?: string;
  text?: string;
  message?: string;
  fast_mode?: boolean;
}

/**
 * Open a real-time voice translation WebSocket.
 *
 * @param config    Pipeline configuration (src/tgt lang, voice, fast_mode)
 * @param onEvent   Callback for each server event (audio, transcript, error…)
 * @returns         { sendChunk(pcm16: ArrayBuffer): void, close(): void }
 */
export function openRealtimeSession(
  config: RealtimeConfig,
  onEvent: (event: RealtimeEvent) => void,
  tenantId?: string,
): { sendChunk: (pcm16: ArrayBuffer) => void; close: () => void } {
  const wsBase = AMT_BASE.replace(/^http/, "ws");
  const ws = new WebSocket(`${wsBase}/amt/v1/realtime`);
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    // Send handshake config as first message
    ws.send(JSON.stringify({
      tenant_id: tenantId || "public",
      tenant_name: config.tenantName || "",
      session_id: getPublicSessionId(),
      src_lang: config.srcLang,
      tgt_lang: config.tgtLang,
      voice_id: config.voiceId || "",
      voice_name: config.voiceName || "",
      sample_rate: config.sampleRate || 16000,
      translate_engine: config.engine || "qwen",
      tts_engine: config.ttsEngine || "chatterbox",
    }));
  };

  ws.onmessage = (e) => {
    try {
      const event: RealtimeEvent = JSON.parse(e.data as string);
      onEvent(event);
    } catch {
      // ignore parse errors
    }
  };

  ws.onerror = () => {
    onEvent({ type: "error", message: "WebSocket connection error" });
  };

  ws.onclose = () => {
    // optional: caller can re-open
  };

  return {
    sendChunk: (pcm16: ArrayBuffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(pcm16);
      }
    },
    close: () => ws.close(),
  };
}

// ─── Text-to-Speech (Chatterbox + Orpheus) ────────────────────────────────────
//
// Two engines (F5-base and IndicF5 both retired):
//   chatterbox — Chatterbox Multilingual + Indic LoRA. Zero-shot voice cloning from a short
//                reference clip + 23 global languages + 8 Indian languages (Hindi, Telugu,
//                Kannada, Bengali, Tamil, Malayalam, Marathi, Gujarati). The DEFAULT for
//                everything. No reference transcript needed.
//   orpheus    — real-time token-streaming TTS (~350 ms first audio, preset English voice),
//                opted into for lowest-latency English (live translation / voice bot).
// A single POST returns a finished WAV clip; /stream yields it chunk-by-chunk.

/** TTS engine: Chatterbox (clone + 23 global + 8 Indian langs, default) or Orpheus (fast English). */
export type TtsEngine = "chatterbox" | "orpheus";

// Chatterbox: 23 base multilingual languages + 8 Indian (via Indic LoRA).
// Not supported (dropped): Punjabi, Odia, Assamese, Urdu, Sanskrit.
export const CHATTERBOX_TTS_LANGS: readonly string[] = [
  // base multilingual (23)
  "en", "hi", "ar", "da", "de", "el", "es", "fi", "fr", "he", "it", "ja",
  "ko", "ms", "nl", "no", "pl", "pt", "ru", "sv", "sw", "tr", "zh",
  // Indian via LoRA (hi already above)
  "te", "kn", "bn", "ta", "ml", "mr", "gu",
];
export const ORPHEUS_TTS_LANGS: readonly string[] = ["en"];
export const SUPPORTED_TTS_LANGS: readonly string[] = CHATTERBOX_TTS_LANGS;

/** Engine for an output language. Chatterbox is universal (clones + every supported language);
 *  Orpheus is opted into explicitly when low-latency English streaming is wanted. */
export function engineForLang(_lang: string): TtsEngine {
  return "chatterbox";
}

export interface SynthesizeParams {
  /** Text to speak. The engine renders whatever script it is given. */
  text: string;
  /** A registered/cloned voice from the Voice Library. Omit for the default reference. */
  voiceId?: string;
  /** Inline base64 reference clip (used instead of a stored voice_id). */
  voiceAudioB64?: string;
  /** Transcript of the inline reference clip — accepted for compatibility (Chatterbox
   *  clones directly from the audio and does not need it). */
  refText?: string;
  /** Synthesis engine — routes to the matching sidecar. Defaults to "chatterbox". */
  engine?: TtsEngine;
  /** Output language (ISO code). Chatterbox speaks it; unknown codes fall back to English. */
  lang?: string;
}

/**
 * Synthesize speech with Chatterbox. Returns a finished WAV blob.
 *
 * The server computes the full clip in memory before responding (Content-Length
 * set), so the resulting blob/data URL supports seek + range in the browser.
 */
export interface SynthesizeResult {
  /** The finished audio, ready for a data/object URL. */
  blob: Blob;
  /** Server-relative URL to replay this clip later (Recent Items). Empty if not stored. */
  audioUrl?: string;
}

export async function synthesizeSpeech(params: SynthesizeParams): Promise<SynthesizeResult> {
  const body: Record<string, unknown> = { text: params.text, engine: params.engine ?? "chatterbox" };
  if (params.voiceId) body.voice_id = params.voiceId;
  if (params.voiceAudioB64) body.voice_audio_b64 = params.voiceAudioB64;
  if (params.refText) body.ref_text = params.refText;
  if (params.lang) body.lang = params.lang;

  const res = await fetch(`${AMT_BASE}/amt/v1/synthesize`, {
    method: "POST",
    headers: amtHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
    credentials: "include",
  });
  await handleQuotaError(res);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Synthesis failed: ${err}`);
  }

  // `/amt/v1/synthesize` returns JSON: { type: "wav", wav_data_b64: "<base64 WAV>" }.
  // Decode the base64 payload into the actual audio bytes — reading the response as
  // a raw byte stream would hand the <audio> element the JSON text, not a WAV.
  const data: { type?: string; wav_data_b64?: string; audio_url?: string } = await res.json();
  const b64 = typeof data.wav_data_b64 === "string" ? data.wav_data_b64 : "";
  if (!b64) throw new Error("Synthesis returned no audio");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  // Reuse the RIFF/data size-guard, then wrap as an audio/wav Blob.
  return { blob: patchWavHeader([bytes]), audioUrl: data.audio_url || undefined };
}

/**
 * Patch a WAV buffer so its RIFF + data chunk size fields match the actual byte length.
 * Guards against truncated responses where the WAV header claims more bytes than received.
 */
function patchWavHeader(chunks: Uint8Array[]): Blob {
  const totalSize = chunks.reduce((s, c) => s + c.length, 0);
  const combined = new Uint8Array(totalSize);
  let off = 0;
  for (const c of chunks) { combined.set(c, off); off += c.length; }

  // Only patch if it looks like a RIFF WAV ("RIFF" at offset 0, "WAVE" at offset 8)
  if (
    combined.length >= 44 &&
    combined[0] === 0x52 && combined[1] === 0x49 && combined[2] === 0x46 && combined[3] === 0x46 &&
    combined[8] === 0x57 && combined[9] === 0x41 && combined[10] === 0x56 && combined[11] === 0x45
  ) {
    const view = new DataView(combined.buffer);
    // Patch RIFF chunk size at bytes 4-7
    view.setUint32(4, totalSize - 8, true);
    // Walk chunks to find the "data" sub-chunk and patch its size
    let pos = 12;
    while (pos + 8 <= totalSize) {
      const id = String.fromCharCode(combined[pos], combined[pos+1], combined[pos+2], combined[pos+3]);
      if (id === "data") {
        view.setUint32(pos + 4, totalSize - pos - 8, true);
        break;
      }
      const chunkSize = view.getUint32(pos + 4, true);
      pos += 8 + chunkSize;
    }
  }
  return new Blob([combined], { type: "audio/wav" });
}

// ─── Translator ───────────────────────────────────────────────────────────────

/**
 * Translation engine. "qwen" is commercial-safe (Apache-2.0) and the default;
 * "nllb" (NLLB-200) is faster but non-commercial (CC-BY-NC).
 */
export type TranslateEngine = "qwen" | "nllb";

export interface TranslateResult {
  translated_text: string;
  src_lang: string;
  tgt_lang: string;
  /** Which engine actually produced the translation (qwen may fall back to nllb). */
  engine_used?: TranslateEngine;
}

export async function translate(
  text: string,
  srcLang: string,
  tgtLang: string,
  engine: TranslateEngine = "qwen",
): Promise<TranslateResult> {
  const res = await fetch(`${AMT_BASE}/amt/v1/translate`, {
    method: "POST",
    headers: amtHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ text, src_lang: srcLang, tgt_lang: tgtLang, engine }),
    credentials: "include",
  });
  await handleQuotaError(res);
  if (!res.ok) throw new Error("Translation failed");
  return res.json();
}

export async function getLanguages(): Promise<string[]> {
  const res = await fetch(`${AMT_BASE}/amt/v1/translate/languages`, { headers: amtHeaders(), credentials: "include" });
  await handleQuotaError(res);
  if (!res.ok) throw new Error("Failed to fetch languages");
  const data = await res.json();
  return data.languages;
}

// ─── History / Processed Items ───────────────────────────────────────────────

export interface ProcessedItem {
  id: string;
  tenant_id: string;
  feature: string;
  feature_label: string;
  type: "text" | "audio";
  input_summary: string;
  input_url: string | null;
  input_key: string | null;
  input_size_bytes: number | null;
  output_summary: string;
  output_data: Record<string, unknown> | null;
  audio_url: string | null;
  audio_key: string | null;
  audio_bucket: string;
  audio_size_bytes: number | null;
  created_at: string;
}

export interface HistoryResponse {
  items: ProcessedItem[];
  total: number;
  skip: number;
  limit: number;
}

export interface HistoryStats {
  total_processed: number;
  features_used: number;
  feature_counts: Record<string, number>;
  text_chars_used: number;
  voice_minutes_used: number;
  period: string;
}

export async function getHistory(skip = 0, limit = 10, feature?: string): Promise<HistoryResponse> {
  const params = new URLSearchParams({ skip: String(skip), limit: String(limit) });
  if (feature) params.set("feature", feature);
  const res = await fetch(`${GATEWAY_BASE}/amt/v1/history?${params}`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch history");
  return res.json();
}

export async function deleteHistoryItem(id: string): Promise<void> {
  const res = await fetch(`${GATEWAY_BASE}/amt/v1/history/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to delete item");
}

export async function getHistoryStats(): Promise<HistoryStats> {
  const res = await fetch(`${GATEWAY_BASE}/amt/v1/history/stats`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch stats");
  return res.json();
}

export interface RecordUsageParams {
  feature: string;
  featureLabel?: string;
  type?: string;
  inputSummary?: string;
  outputSummary?: string;
  /** Characters synthesised/translated — increments the text-usage quota. */
  textChars?: number;
  /** Seconds of audio transcribed/spoken — increments the voice-usage quota. */
  voiceSeconds?: number;
  /** Server-relative URL of the stored clip, so Recent Items can replay it. */
  audioUrl?: string;
}

/**
 * Record a completed operation for Voice Analytics + usage metering. Inference
 * runs on the standalone pod (no cluster DB access), so the authenticated client
 * reports each op to the gateway-backed metering DB. Best-effort — a failure
 * here must never surface to the user or block their result.
 */
export async function recordUsage(p: RecordUsageParams): Promise<void> {
  try {
    await fetch(`${GATEWAY_BASE}/amt/v1/history/record`, {
      method: "POST",
      headers: amtHeaders({ "Content-Type": "application/json" }),
      credentials: "include",
      body: JSON.stringify({
        feature: p.feature,
        feature_label: p.featureLabel,
        type: p.type,
        input_summary: p.inputSummary,
        output_summary: p.outputSummary,
        text_chars: p.textChars,
        voice_seconds: p.voiceSeconds,
        audio_url: p.audioUrl,
      }),
    });
  } catch {
    // analytics recording is best-effort — swallow errors
  }
}

// ── Global Sync ───────────────────────────────────────────────────────────────

export interface SyncResult {
  synced:        number;   // files downloaded from R2 → local disk
  already_local: number;   // files that were already on local disk
  cloud_only:    number;   // no local dir configured for these items
  failed:        string[]; // item IDs that failed to download
  total:         number;   // total items with audio in MongoDB
}

/**
 * Validate every MongoDB processed_item against configured local paths.
 * Downloads any file missing locally from R2, for all features
 * (TTS, STT, live_translation, vocoder, etc.).
 */
export async function syncToLocal(): Promise<SyncResult> {
  const res = await fetch(`${GATEWAY_BASE}/amt/v1/sync`, {
    method:      "POST",
    headers:     amtHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Sync failed: ${await res.text()}`);
  return res.json();
}

// ── Live Translation persistence ─────────────────────────────────────────────

export interface SaveLTClipResult {
  id: string;
  cloud_url?: string;
  local_path?: string;
}

/**
 * Upload a live-translation WAV clip to R2 + MongoDB (processed_items).
 * Fire-and-forget — caller does NOT need to await for playback to work.
 */
export async function saveLiveTranslationClip(
  wavBlob: Blob,
  meta: {
    srcLang: string;
    tgtLang: string;
    transcript: string;
    translation: string;
    timestamp: number;
  },
): Promise<SaveLTClipResult> {
  const form = new FormData();
  form.append("audio",       wavBlob, "clip.wav");
  form.append("src_lang",    meta.srcLang);
  form.append("tgt_lang",    meta.tgtLang);
  form.append("transcript",  meta.transcript);
  form.append("translation", meta.translation);
  form.append("timestamp",   String(meta.timestamp));

  const res = await fetch(`${GATEWAY_BASE}/amt/v1/live-translation/clips`, {
    method:      "POST",
    headers:     amtHeaders(),   // tenant auth headers (no Content-Type — let browser set multipart boundary)
    body:        form,
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Live-translation save failed: ${await res.text()}`);
  return res.json();
}

/**
 * Fetch previously saved live-translation clips from the cloud.
 * Uses the existing history API filtered by feature="live_translation".
 */
export async function getLiveTranslationClips(skip = 0, limit = 50): Promise<HistoryResponse> {
  return getHistory(skip, limit, "live_translation");
}
