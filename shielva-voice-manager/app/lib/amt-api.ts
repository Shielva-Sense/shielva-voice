const AMT_BASE = process.env.NEXT_PUBLIC_API_URL || "https://localhost:8000";

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

export function setAmtAuthState(authenticated: boolean, tenantId?: string, tenantName?: string): void {
  _tenantId = authenticated && tenantId ? tenantId : null;
  _tenantName = authenticated && tenantName ? tenantName : null;
}

function amtHeaders(extra?: Record<string, string>): Record<string, string> {
  // Authenticated: pass tenant_id and tenant_name so services use human-readable R2 paths.
  if (_tenantId) {
    return {
      "X-Tenant-ID": _tenantId,
      ...(_tenantName ? { "X-Tenant-Name": _tenantName } : {}),
      ...extra,
    };
  }
  // Unauthenticated: scope by permanent session UUID.
  return { "X-AMT-Session-ID": getPublicSessionId(), ...extra };
}

const ACOUSTIC = process.env.NEXT_PUBLIC_AMT_ACOUSTIC_URL || "https://localhost:8200";
const INTENT = process.env.NEXT_PUBLIC_AMT_INTENT_URL || "https://localhost:8201";
const SPEAKER = process.env.NEXT_PUBLIC_AMT_SPEAKER_URL || "https://localhost:8202";
const SHIELVA_TTS = process.env.NEXT_PUBLIC_AMT_TTS_URL || "https://localhost:8203";
const VOCODER = process.env.NEXT_PUBLIC_AMT_VOCODER_URL || "https://localhost:8204";
const TRANSLATOR = process.env.NEXT_PUBLIC_AMT_TRANSLATOR_URL || "https://localhost:8205";

// ─── Health ───────────────────────────────────────────────────────────────────

export interface ServiceHealth {
  name: string;
  url: string;
  /** online=green, warming=amber (model loading), offline=red, loading=initial check */
  status: "online" | "warming" | "offline" | "loading";
  detail?: string;
}

export const SERVICES = [
  { key: "acoustic", label: "Acoustic", url: ACOUSTIC },
  { key: "intent", label: "Intent", url: INTENT },
  { key: "speaker", label: "Speaker", url: SPEAKER },
  { key: "shielva-tts", label: "Shielva TTS", url: SHIELVA_TTS },
  { key: "vocoder", label: "Vocoder", url: VOCODER },
  { key: "translator", label: "Translator", url: TRANSLATOR },
] as const;

export async function checkHealth(baseUrl: string): Promise<{ ok: boolean; loading?: boolean; detail?: string }> {
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const data = await res.json();
    // "loading" means the service is up but still warming up models — show as online (amber)
    if (data.status === "loading") return { ok: true, loading: true, detail: `${data.service} (warming up…)` };
    return { ok: data.status === "ok", detail: data.service };
  } catch {
    return { ok: false, detail: "unreachable" };
  }
}

// ─── Engine capabilities (gpu_assist / xtts / indicf5) ───────────────────────

export interface EngineCapabilities {
  gpu_assist: boolean;
  engines: {
    xtts: boolean;
    vits: boolean;
    indicf5: boolean;
    edge_tts: boolean;
  };
}

const DEFAULT_ENGINES: EngineCapabilities = {
  gpu_assist: false,
  engines: { xtts: false, vits: false, indicf5: false, edge_tts: true },
};

export async function getEngineCapabilities(): Promise<EngineCapabilities> {
  // Route through gateway (port 8000) so browser only needs one trusted cert.
  // Direct fetch to shielva-tts (port 8203) would require the user to accept that cert separately.
  try {
    const res = await fetch(`${AMT_BASE}/amt/v1/engines`, {
      headers: amtHeaders(),
      credentials: "include",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return DEFAULT_ENGINES;
    const data = await res.json();
    return {
      gpu_assist: data.gpu_assist ?? false,
      engines: data.engines ?? DEFAULT_ENGINES.engines,
    };
  } catch {
    return DEFAULT_ENGINES;
  }
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

export async function phonemize(text: string): Promise<{ phonemes: string[] }> {
  const res = await fetch(`${AMT_BASE}/amt/v1/phonemize`, {
    method: "POST",
    headers: amtHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ text }),
    credentials: "include",
  });
  await handleQuotaError(res);
  if (!res.ok) throw new Error("Phonemization failed");
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

// ─── Speaker Encoder (Voices) ─────────────────────────────────────────────────

export interface VoiceInfo {
  voice_id: string;
  tenant_id: string;
  embedding_dim?: number;
  sample_duration_ms?: number;
  created_at?: string;
  // Extended metadata (stored locally + returned by training endpoint)
  name?: string;
  language?: string;
  training_status?: "untrained" | "training" | "trained";
  rvc_trained?: boolean;  // backend-verified: true if RVC model exists in MongoDB/R2
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
    const res = await fetch(`${AMT_BASE}/amt/v1/session`, {
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

export async function registerVoice(voiceId: string, audioBlob: Blob): Promise<VoiceInfo> {
  const form = new FormData();
  form.append("audio", audioBlob, "voice-sample.wav");

  const res = await fetch(`${AMT_BASE}/amt/v1/voices/register`, {
    method: "POST",
    headers: amtHeaders({ "X-Voice-ID": voiceId }),
    body: form,
    credentials: "include",
  });
  await handleQuotaError(res);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Voice registration failed: ${err}`);
  }
  return res.json();
}

export async function fetchVoiceAudio(voiceId: string): Promise<Blob> {
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
  rvc_models_dir: string;
  path_exists: boolean;
  free_gb: number | null;
  total_gb: number | null;
  cdn_service_url: string;
  rvc_models_bucket: string;
}

export async function getStorageConfig(): Promise<StorageConfig> {
  const res = await fetch(`${AMT_BASE}/amt/v1/storage`, {
    headers: amtHeaders(),
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch storage config");
  return res.json();
}

export async function setStorageConfig(rvcModelsDir: string): Promise<StorageConfig & { ok: boolean }> {
  const res = await fetch(`${AMT_BASE}/amt/v1/storage`, {
    method: "POST",
    headers: { ...amtHeaders(), "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ rvc_models_dir: rvcModelsDir }),
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
  voiceId?: string;
  voiceName?: string;
  tenantName?: string;
  fastMode?: boolean;
  sampleRate?: number;
  voiceMode?: "natural" | "cloned";
  ttsEngine?: string;
  gender?: "male" | "female";
  whisperModel?: string;  // "tiny"|"base"|"small"|"medium"|"large-v2"|"large-v3"
}

export interface AcousticModels {
  default: string;
  loaded: string[];
  available: string[];
  allow_download: boolean;  // false in production — models must be pre-provisioned on volume
  model_root: string;       // where models are stored (SSD path in dev, volume path in prod)
}

export async function getAcousticModels(): Promise<AcousticModels> {
  const res = await fetch(`${AMT_BASE}/amt/v1/acoustic/models`, {
    headers: amtHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Trigger background pre-load of a Whisper model size on the acoustic service.
 *  Returns "loading" (started) | "already_loaded" (ready immediately) | throws on error.
 */
export async function preloadAcousticModel(modelSize: string): Promise<"loading" | "already_loaded"> {
  const res = await fetch(`${AMT_BASE}/amt/v1/acoustic/models/load`, {
    method: "POST",
    headers: { ...amtHeaders(), "X-Whisper-Model": modelSize },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.status as "loading" | "already_loaded";
}

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
      fast_mode: config.fastMode !== false,  // default true
      sample_rate: config.sampleRate || 16000,
      voice_mode: config.voiceMode || "natural",
      tts_engine: config.ttsEngine || "auto",
      gender: config.gender || "female",
      whisper_model: config.whisperModel || null,
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

// ─── Shielva TTS (Text-to-Speech) ─────────────────────────────────────────────

export interface SynthesizeResult {
  /** "mel" = HiFi-GAN vocoder input; "wav" = direct audio, skip vocoder */
  type?: "mel" | "wav";
  // mel path
  mel_data_b64?: string;
  n_mel?: number;
  n_frames?: number;
  // wav path (direct TTS — no vocoder artefacts)
  wav_data_b64?: string;
}

export async function synthesize(phonemes: string[], voiceId: string, text = ""): Promise<SynthesizeResult> {
  const res = await fetch(`${AMT_BASE}/amt/v1/synthesize`, {
    method: "POST",
    headers: amtHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ phonemes, voice_id: voiceId, text }),
    credentials: "include",
  });
  await handleQuotaError(res);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Synthesis failed: ${err}`);
  }
  return res.json();
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

/**
 * Neural TTS synthesis — returns a complete WAV blob.
 * The server computes the full audio in memory before sending (Content-Length set),
 * which ensures blob URLs support seek / range operations in the browser.
 * The server uploads to R2 as a background task after the response is sent.
 */
export async function synthesizeStream(
  phonemes: string[],
  voiceId: string,
  text: string,
  lang = "en",
  edgeVoice = "",
  voiceMode: "natural" | "cloned" = "cloned",
  ttsEngine = "auto",
  voiceName = "",
  gender: "male" | "female" = "female",
): Promise<Blob> {
  const res = await fetch(`${AMT_BASE}/amt/v1/synthesize/stream`, {
    method: "POST",
    headers: amtHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ phonemes, voice_id: voiceId, voice_name: voiceName, text, lang, edge_voice: edgeVoice, voice_mode: voiceMode, tts_engine: ttsEngine, gender }),
    credentials: "include",
  });
  await handleQuotaError(res);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Streaming synthesis failed: ${err}`);
  }

  // Collect response body (may be chunked or single response)
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }

  // Patch WAV header to match actual received bytes (guards against any truncation)
  return patchWavHeader(chunks);
}

/**
 * SSE-based synthesis — streams stage progress events from the backend,
 * calling onStage() for each, then returns the final WAV Blob.
 * Falls back to synthesizeStream() if SSE is unavailable.
 */
export async function synthesizeWithProgress(
  text: string,
  voiceId: string,
  onStage: (stage: string, percent: number) => void,
  lang = "en",
  edgeVoice = "",
  voiceMode: "natural" | "cloned" = "cloned",
  ttsEngine = "auto",
  voiceName = "",
  gender: "male" | "female" = "female",
): Promise<Blob> {
  const res = await fetch(`${AMT_BASE}/amt/v1/synthesize/progress`, {
    method: "POST",
    headers: amtHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ phonemes: [], voice_id: voiceId, voice_name: voiceName, text, lang, edge_voice: edgeVoice, voice_mode: voiceMode, tts_engine: ttsEngine, gender }),
    credentials: "include",
  });

  await handleQuotaError(res);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Progress synthesis failed: ${err}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let audioBase64: string | null = null;
  let audioMime = "audio/wav";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // SSE events are separated by double newlines
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data: ")) continue;
      try {
        const event = JSON.parse(line.slice(6));
        if (event.type === "stage") {
          onStage(event.stage as string, event.percent as number);
        } else if (event.type === "audio") {
          audioBase64 = event.data as string;
          audioMime = (event.mime as string) || "audio/wav";
          onStage("Audio ready", 100);
        } else if (event.type === "error") {
          throw new Error(event.message as string);
        }
      } catch (e) {
        if (e instanceof SyntaxError) continue; // partial JSON, skip
        throw e;
      }
    }
  }

  if (!audioBase64) throw new Error("No audio received from synthesis");

  // Decode base64 audio → Blob (WAV or MP3 depending on backend)
  const bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
  if (audioMime === "audio/wav") {
    return patchWavHeader([bytes]);
  }
  return new Blob([bytes], { type: audioMime });
}

// ─── Sentence-level streaming TTS ─────────────────────────────────────────────

/**
 * SSE-based sentence-level streaming synthesis.
 * The backend splits text into sentences and streams each sentence's audio
 * as it becomes available, enabling gapless playback that starts after
 * the very first sentence is synthesized.
 */
export async function synthesizeStreamSentences(
  text: string,
  voiceId: string,
  onSentenceStart: (index: number, total: number, sentenceText: string) => void,
  onSentenceAudio: (index: number, audioBlob: Blob, durationMs: number) => void,
  onComplete: (totalSentences: number) => void,
  onError: (error: string) => void,
  lang = "en",
  edgeVoice = "",
  voiceMode: "natural" | "cloned" = "cloned",
  ttsEngine = "auto",
  voiceName = "",
  gender: "male" | "female" = "female",
): Promise<void> {
  const res = await fetch(`${AMT_BASE}/amt/v1/synthesize/sentence-stream`, {
    method: "POST",
    headers: amtHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ text, voice_id: voiceId, voice_name: voiceName, lang, edge_voice: edgeVoice, voice_mode: voiceMode, tts_engine: ttsEngine, gender }),
    credentials: "include",
  });

  await handleQuotaError(res);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sentence-stream synthesis failed: ${err}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // SSE events are separated by double newlines
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data: ")) continue;
      try {
        const event = JSON.parse(line.slice(6));
        if (event.type === "sentence_start") {
          onSentenceStart(event.index as number, event.total as number, event.text as string);
        } else if (event.type === "sentence_audio") {
          // Decode base64 audio data into a Blob
          const bytes = Uint8Array.from(atob(event.data as string), (c) => c.charCodeAt(0));
          const blob = new Blob([bytes], { type: (event.mime as string) || "audio/mpeg" });
          onSentenceAudio(event.index as number, blob, event.duration_ms as number);
        } else if (event.type === "complete") {
          onComplete(event.total_sentences as number);
        } else if (event.type === "error") {
          onError(event.message as string);
        }
      } catch (e) {
        if (e instanceof SyntaxError) continue; // partial JSON, skip
        throw e;
      }
    }
  }
}

// ─── WebSocket TTS Streaming (Week 4 — binary frames, lowest latency) ────────

export interface WsTtsConfig {
  voiceId?: string;
  voiceName?: string;
  lang?: string;
  edgeVoice?: string;
  translateTo?: string;
  tenantId?: string;
  tenantName?: string;
  voiceMode?: "natural" | "cloned";
  ttsEngine?: string;
  gender?: "male" | "female";
  accent?: string;
}

export interface WsTtsCallbacks {
  onReady?: () => void;
  onSentenceStart?: (index: number, total: number, text: string) => void;
  onSentenceAudio?: (index: number, audioBlob: Blob, durationMs: number) => void;
  onComplete?: (totalSentences: number, requestId: string) => void;
  onError?: (message: string) => void;
  onDisconnect?: () => void;
}

/**
 * Open a persistent WebSocket connection for TTS streaming.
 *
 * Binary audio frames are sent directly (no base64 encoding = 40% less bandwidth).
 * Multiple synthesize requests can be sent over the same connection.
 * Auto-reconnects on disconnect (with exponential backoff).
 *
 * @example
 * ```ts
 * const tts = openTtsWebSocket(
 *   { voiceId: "vivek", lang: "en" },
 *   {
 *     onSentenceAudio: (i, blob) => playAudio(blob),
 *     onComplete: () => console.log("done"),
 *   }
 * );
 * tts.synthesize("Hello world. How are you?");
 * // Later...
 * tts.close();
 * ```
 */
export function openTtsWebSocket(
  config: WsTtsConfig,
  callbacks: WsTtsCallbacks,
): {
  synthesize: (text: string, requestId?: string, overrides?: Partial<WsTtsConfig>) => void;
  close: () => void;
  isConnected: () => boolean;
} {
  const wsBase = AMT_BASE.replace(/^http/, "ws");
  let ws: WebSocket | null = null;
  let connected = false;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  // Track pending binary frame per sentence (binary comes before sentence_end)
  let pendingBinary: Blob | null = null;
  let pendingSentenceIndex = -1;

  function connect() {
    if (closed) return;
    ws = new WebSocket(`${wsBase}/amt/v1/tts/ws`);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      reconnectAttempt = 0;
      // Send config handshake
      ws!.send(JSON.stringify({
        type: "config",
        tenant_id: config.tenantId || "public",
        tenant_name: config.tenantName || "",
        session_id: getPublicSessionId(),
        voice_id: config.voiceId || "",
        voice_name: config.voiceName || "",
        lang: config.lang || "en",
        edge_voice: config.edgeVoice || "",
        translate_to: config.translateTo || "",
        voice_mode: config.voiceMode || "cloned",
        tts_engine: config.ttsEngine || "auto",
        gender: config.gender || "female",
        accent: config.accent || "",
      }));
    };

    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        // Binary frame = raw WAV audio bytes
        pendingBinary = new Blob([e.data], { type: "audio/wav" });
        return;
      }

      // Text frame = JSON control event
      try {
        const event = JSON.parse(e.data as string);

        switch (event.type) {
          case "ready":
            connected = true;
            callbacks.onReady?.();
            break;

          case "sentence_start":
            pendingSentenceIndex = event.index as number;
            pendingBinary = null; // reset for this sentence
            callbacks.onSentenceStart?.(
              event.index as number,
              event.total as number,
              event.text as string,
            );
            break;

          case "sentence_end":
            // Binary frame was received just before this — match them
            if (pendingBinary && callbacks.onSentenceAudio) {
              callbacks.onSentenceAudio(
                event.index as number,
                pendingBinary,
                event.duration_ms as number,
              );
            }
            pendingBinary = null;
            break;

          case "complete":
            callbacks.onComplete?.(
              event.total_sentences as number,
              event.request_id as string || "",
            );
            break;

          case "error":
            callbacks.onError?.(event.message as string);
            break;

          case "pong":
            // keepalive acknowledged
            break;
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onerror = () => {
      callbacks.onError?.("WebSocket connection error");
    };

    ws.onclose = () => {
      connected = false;
      if (!closed) {
        callbacks.onDisconnect?.();
        // Auto-reconnect with exponential backoff (max 30s)
        const delay = Math.min(1000 * 2 ** reconnectAttempt, 30000);
        reconnectAttempt++;
        reconnectTimer = setTimeout(connect, delay);
      }
    };
  }

  // Start connection
  connect();

  // Keepalive ping every 25s
  const pingInterval = setInterval(() => {
    if (ws && connected) {
      ws.send(JSON.stringify({ type: "ping" }));
    }
  }, 25000);

  return {
    synthesize(text: string, requestId?: string, overrides?: Partial<WsTtsConfig>) {
      if (!ws || !connected) {
        callbacks.onError?.("WebSocket not connected");
        return;
      }
      const msg: Record<string, unknown> = {
        type: "synthesize",
        text,
      };
      if (requestId) msg.request_id = requestId;
      if (overrides?.lang) msg.lang = overrides.lang;
      if (overrides?.voiceId) msg.voice_id = overrides.voiceId;
      if (overrides?.edgeVoice) msg.edge_voice = overrides.edgeVoice;
      if (overrides?.translateTo) msg.translate_to = overrides.translateTo;
      if (overrides?.voiceMode) msg.voice_mode = overrides.voiceMode;
      ws.send(JSON.stringify(msg));
    },

    close() {
      closed = true;
      clearInterval(pingInterval);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
    },

    isConnected() {
      return connected;
    },
  };
}

// ─── Vocoder ──────────────────────────────────────────────────────────────────

export async function vocode(melB64: string, nMel: number, nFrames: number): Promise<Blob> {
  const melBytes = Uint8Array.from(atob(melB64), (c) => c.charCodeAt(0));

  if (melBytes.byteLength === 0) {
    throw new Error("Vocoder conversion failed: mel data is empty");
  }

  const res = await fetch(`${AMT_BASE}/amt/v1/vocoder/convert`, {
    method: "POST",
    headers: amtHeaders({
      "Content-Type": "application/octet-stream",
      "X-N-Mel": String(nMel),
      "X-N-Frames": String(nFrames),
    }),
    body: melBytes,
    credentials: "include",
  });
  await handleQuotaError(res);
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Vocoder conversion failed (${res.status}): ${errText}`);
  }

  // The vocoder now returns a fully-formed WAV file (audio/wav).
  // Use the blob directly — no frontend PCM→WAV conversion needed.
  const wavBlob = await res.blob();
  if (wavBlob.size < 44) {
    throw new Error("Vocoder returned empty audio — check backend logs");
  }
  return new Blob([wavBlob], { type: "audio/wav" });
}

function pcmToWavBlob(samples: Int16Array, sampleRate: number): Blob {
  const numChannels = 1;
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  const out = new Int16Array(buffer, 44);
  out.set(samples);
  return new Blob([buffer], { type: "audio/wav" });
}

// ─── Translator ───────────────────────────────────────────────────────────────

export interface TranslateResult {
  translated_text: string;
  src_lang: string;
  tgt_lang: string;
}

export async function translate(
  text: string,
  srcLang: string,
  tgtLang: string
): Promise<TranslateResult> {
  const res = await fetch(`${AMT_BASE}/amt/v1/translate`, {
    method: "POST",
    headers: amtHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ text, src_lang: srcLang, tgt_lang: tgtLang }),
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
  const res = await fetch(`${AMT_BASE}/amt/v1/history?${params}`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch history");
  return res.json();
}

export async function deleteHistoryItem(id: string): Promise<void> {
  const res = await fetch(`${AMT_BASE}/amt/v1/history/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to delete item");
}

export async function getHistoryStats(): Promise<HistoryStats> {
  const res = await fetch(`${AMT_BASE}/amt/v1/history/stats`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch stats");
  return res.json();
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
  const res = await fetch(`${AMT_BASE}/amt/v1/sync`, {
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

  const res = await fetch(`${AMT_BASE}/amt/v1/live-translation/clips`, {
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

// ── Voice Training ────────────────────────────────────────────────────────────

export interface VoiceTrainingResult {
  voice_id: string;
  status: "complete" | "registered" | "training";
  duration_sec?: number;
  engines_ready?: string[];
  encoder_registered?: boolean;
  r2_uploaded?: boolean;
  rvc_uploaded?: boolean;
}

export interface VoiceTrainingStatus {
  status: "processing" | "complete" | "failed";
  progress: number;
  message?: string;
  voice_id?: string;
  duration_sec?: number;
  engines_ready?: string[];
  encoder_registered?: boolean;
  r2_uploaded?: boolean;
  rvc_uploaded?: boolean;
}

/**
 * Submit audio clips and stream training progress via SSE.
 * The backend returns text/event-stream with JSON progress events.
 * onProgress is called for each event (upload phase uses XHR progress, then SSE for backend steps).
 * Resolves with the final VoiceTrainingResult when status=complete.
 */
export function submitVoiceTraining(
  voiceId: string,
  voiceName: string,
  language: string,
  audioBlobs: { blob: Blob; filename: string }[],
  onProgress?: (status: VoiceTrainingStatus) => void,
): Promise<VoiceTrainingResult> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("voice_id", voiceId);
    form.append("voice_name", voiceName);
    form.append("language", language);
    audioBlobs.forEach(({ blob, filename }, i) => {
      form.append(`audio_${i}`, blob, filename);
    });

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${AMT_BASE}/amt/v1/voices/train`);
    xhr.withCredentials = true;

    const hdrs = amtHeaders();
    Object.entries(hdrs).forEach(([k, v]) => xhr.setRequestHeader(k, v));

    // Phase 1: Upload progress (0–15%)
    const fmtBytes = (b: number) => b < 1024 * 1024
      ? `${(b / 1024).toFixed(0)} KB`
      : `${(b / (1024 * 1024)).toFixed(1)} MB`;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        const ratio = e.loaded / e.total;
        const uploadPct = Math.round(ratio * 15);
        const loaded = fmtBytes(e.loaded);
        const total = fmtBytes(e.total);
        onProgress({
          status: "processing",
          progress: uploadPct,
          message: ratio < 1
            ? `Uploading clips… ${loaded} / ${total}`
            : `Upload complete — waiting for server…`,
        });
      }
    };

    xhr.upload.onload = () => {
      onProgress?.({ status: "processing", progress: 15, message: "Audio received — processing clips…" });
    };

    // Phase 2: SSE stream from backend (15–100%)
    let lastResult: VoiceTrainingResult | null = null;
    let sseBuffer = "";

    xhr.onprogress = () => {
      // XHR streams text/event-stream — parse SSE events incrementally
      const text = xhr.responseText.substring(sseBuffer.length);
      sseBuffer = xhr.responseText;
      const lines = text.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data: VoiceTrainingStatus = JSON.parse(line.slice(6));
            onProgress?.(data);
            if (data.status === "complete") {
              lastResult = {
                voice_id: data.voice_id || voiceId,
                status: "complete",
                duration_sec: data.duration_sec,
                engines_ready: data.engines_ready,
                encoder_registered: data.encoder_registered,
                r2_uploaded: data.r2_uploaded,
                rvc_uploaded: data.rvc_uploaded,
              };
            }
          } catch { /* skip malformed events */ }
        }
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        if (lastResult) {
          resolve(lastResult);
        } else {
          // Fallback: try parsing as plain JSON (backwards compat)
          try { resolve(JSON.parse(xhr.responseText)); }
          catch { reject(new Error("No valid training result received")); }
        }
      } else {
        reject(new Error(`Voice training failed (${xhr.status}): ${xhr.responseText}`));
      }
    };

    xhr.onerror = () => reject(new Error("Network error during voice training"));
    xhr.ontimeout = () => reject(new Error("Voice training timed out"));
    xhr.timeout = 180_000; // 3 min max

    xhr.send(form);
  });
}

/**
 * Poll training job status for VITS async training jobs.
 * Not needed for XTTS v2 (status is "registered" immediately).
 */
export async function getVoiceTrainingStatus(
  voiceId: string,
): Promise<VoiceTrainingStatus> {
  const res = await fetch(`${AMT_BASE}/amt/v1/voices/${encodeURIComponent(voiceId)}/train/status`, {
    credentials: "include",
    headers: amtHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch training status");
  return res.json();
}

/**
 * Subscribe to real-time training progress via SSE.
 * Returns a cleanup function — call it to close the connection.
 */
export function subscribeVoiceTrainingStatus(
  voiceId: string,
  onEvent: (status: VoiceTrainingStatus) => void,
  onDone?: () => void,
): () => void {
  // EventSource doesn't support custom headers; pass tenant via query param for public sessions.
  // For authenticated users the JWT cookie is sent automatically (withCredentials).
  const sessionId = _tenantId ? null : getPublicSessionId();
  const qs = sessionId ? `?sid=${encodeURIComponent(sessionId)}` : "";
  const url = `${AMT_BASE}/amt/v1/voices/${encodeURIComponent(voiceId)}/train/status/stream${qs}`;
  const es = new EventSource(url, { withCredentials: true });
  es.onmessage = (e) => {
    try {
      const data: VoiceTrainingStatus = JSON.parse(e.data);
      onEvent(data);
      // Terminal states: complete, failed, not_found, registered (no active job)
      if (data.status === "complete" || data.status === "failed" ||
          data.status === "not_found" || data.status === "registered") {
        es.close();
        onDone?.();
      }
    } catch {}
  };
  es.onerror = () => { es.close(); onDone?.(); };
  return () => es.close();
}

/**
 * Manually trigger RVC model training for an already-registered voice.
 * The speaker_ref.wav must exist on the server (uploaded during initial registration).
 * Training runs in the background; subscribe to subscribeVoiceTrainingStatus for progress.
 */
export async function cancelRvcTraining(voiceId: string): Promise<{ status: string; message?: string }> {
  try {
    const res = await fetch(`${AMT_BASE}/amt/v1/voices/${encodeURIComponent(voiceId)}/rvc/train`, {
      method: "DELETE",
      headers: amtHeaders(),
      credentials: "include",
    });
    if (!res.ok) return { status: "error", message: `HTTP ${res.status}` };
    return res.json();
  } catch (e) {
    return { status: "error", message: String(e) };
  }
}

export async function triggerRvcTraining(
  voiceId: string,
  options: { nSteps?: number; f0UpKey?: number; indexRate?: number } = {}
): Promise<{ status: string; message: string }> {
  const params = new URLSearchParams();
  params.set("n_steps", String(options.nSteps ?? 1500));
  if (options.f0UpKey !== undefined) params.set("f0_up_key", String(options.f0UpKey));
  if (options.indexRate !== undefined) params.set("index_rate", String(options.indexRate));
  const res = await fetch(
    `${AMT_BASE}/amt/v1/voices/${encodeURIComponent(voiceId)}/rvc/train?${params}`,
    {
      method: "POST",
      headers: amtHeaders(),
      credentials: "include",
    }
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(detail || `HTTP ${res.status}`);
  }
  return res.json();
}
