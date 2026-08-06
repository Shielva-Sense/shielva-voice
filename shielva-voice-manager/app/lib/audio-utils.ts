/**
 * Record microphone audio for up to `maxMs` milliseconds.
 * Returns a WAV blob (16 kHz, mono, int16).
 */
export function recordMic(
  maxMs: number,
  onTick?: (elapsedMs: number) => void,
  onLevel?: (level: number) => void
): { promise: Promise<Blob>; stop: () => void } {
  let resolver: (blob: Blob) => void;
  let stopped = false;

  const promise = new Promise<Blob>((resolve, reject) => {
    resolver = resolve;

    navigator.mediaDevices
      // AEC/NS/AGC on: without echo cancellation the bot's own TTS audio leaks
      // into the mic and self-triggers barge-in.
      .getUserMedia({ audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .then((stream) => {
        const audioCtx = new AudioContext({ sampleRate: 16000 });
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        const recorder = new MediaRecorder(stream);
        const chunks: Blob[] = [];
        const startTime = Date.now();

        // Tick every 100ms for UI updates
        const tickInterval = setInterval(() => {
          const elapsed = Date.now() - startTime;
          onTick?.(elapsed);

          // Audio level for visualizer
          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          analyser.getByteFrequencyData(dataArray);
          const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
          onLevel?.(avg / 255);
        }, 100);

        // Auto-stop at max duration
        const timeout = setTimeout(() => doStop(), maxMs);

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };

        recorder.onstop = async () => {
          clearInterval(tickInterval);
          clearTimeout(timeout);
          stream.getTracks().forEach((t) => t.stop());

          const rawBlob = new Blob(chunks, { type: recorder.mimeType });
          try {
            const wavBlob = await toWav16kMono(rawBlob, audioCtx);
            resolver(wavBlob);
          } catch (err) {
            reject(err);
          } finally {
            audioCtx.close();
          }
        };

        const doStop = () => {
          if (stopped) return;
          stopped = true;
          if (recorder.state === "recording") recorder.stop();
        };

        // Expose stop handle
        stopFn = doStop;
        recorder.start(250); // 250ms chunks
      })
      .catch(reject);
  });

  let stopFn = () => {
    stopped = true;
  };

  return { promise, stop: () => stopFn() };
}

/**
 * Convert any audio blob to 16 kHz mono int16 WAV.
 */
async function toWav16kMono(blob: Blob, audioCtx: AudioContext): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

  // Resample to 16kHz if needed
  let channelData: Float32Array;
  if (audioBuffer.sampleRate !== 16000) {
    const offlineCtx = new OfflineAudioContext(1, audioBuffer.duration * 16000, 16000);
    const bufferSource = offlineCtx.createBufferSource();
    bufferSource.buffer = audioBuffer;
    bufferSource.connect(offlineCtx.destination);
    bufferSource.start();
    const resampled = await offlineCtx.startRendering();
    channelData = resampled.getChannelData(0);
  } else {
    channelData = audioBuffer.getChannelData(0);
  }

  // Float32 → Int16
  const int16 = new Int16Array(channelData.length);
  for (let i = 0; i < channelData.length; i++) {
    const s = Math.max(-1, Math.min(1, channelData[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  return encodeWav(int16, 16000);
}

/**
 * Split an audio blob into equal-length segments.
 * Returns an array of { blob, startSec, endSec, durationSec }.
 */
export async function splitAudio(
  blob: Blob,
  segmentSeconds: number = 5
): Promise<{ blob: Blob; startSec: number; endSec: number; durationSec: number }[]> {
  const audioCtx = new AudioContext({ sampleRate: 16000 });
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    // Resample to 16kHz mono
    let samples: Float32Array;
    if (audioBuffer.sampleRate !== 16000) {
      const offlineCtx = new OfflineAudioContext(1, audioBuffer.duration * 16000, 16000);
      const src = offlineCtx.createBufferSource();
      src.buffer = audioBuffer;
      src.connect(offlineCtx.destination);
      src.start();
      const resampled = await offlineCtx.startRendering();
      samples = resampled.getChannelData(0);
    } else {
      samples = audioBuffer.getChannelData(0);
    }

    const sampleRate = 16000;
    const segmentSamples = Math.floor(segmentSeconds * sampleRate);
    const totalSamples = samples.length;
    const segments: { blob: Blob; startSec: number; endSec: number; durationSec: number }[] = [];

    for (let offset = 0; offset < totalSamples; offset += segmentSamples) {
      const end = Math.min(offset + segmentSamples, totalSamples);
      const slice = samples.slice(offset, end);

      // Float32 → Int16
      const int16 = new Int16Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        const s = Math.max(-1, Math.min(1, slice[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }

      const wavBlob = encodeWav(int16, sampleRate);
      const startSec = offset / sampleRate;
      const endSec = end / sampleRate;

      segments.push({
        blob: wavBlob,
        startSec,
        endSec,
        durationSec: endSec - startSec,
      });
    }

    return segments;
  } finally {
    audioCtx.close();
  }
}

/**
 * Decode any audio blob to Float32 samples at 16 kHz mono.
 * Returns { samples, sampleRate, duration }.
 */
export async function decodeAudioBlob(
  blob: Blob
): Promise<{ samples: Float32Array; sampleRate: number; duration: number }> {
  const audioCtx = new AudioContext({ sampleRate: 16000 });
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    let samples: Float32Array;
    if (audioBuffer.sampleRate !== 16000) {
      const offlineCtx = new OfflineAudioContext(1, audioBuffer.duration * 16000, 16000);
      const src = offlineCtx.createBufferSource();
      src.buffer = audioBuffer;
      src.connect(offlineCtx.destination);
      src.start();
      const resampled = await offlineCtx.startRendering();
      samples = resampled.getChannelData(0);
    } else {
      samples = audioBuffer.getChannelData(0);
    }
    return { samples, sampleRate: 16000, duration: samples.length / 16000 };
  } finally {
    audioCtx.close();
  }
}

/**
 * Duration of an audio blob, in seconds.
 *
 * Voice usage is metered on audio ACTUALLY PRODUCED, so it has to be measured
 * from the synthesized bytes rather than estimated from the input text — a
 * character count says nothing about how long the speech runs, and every
 * engine paces differently.
 *
 * Decodes at the clip's own sample rate (no resample — `decodeAudioBlob` forces
 * 16 kHz for the cloning path, which is wasted work when all we need is a
 * length). Returns 0 rather than throwing: metering is best-effort and must
 * never take down a synthesis that already succeeded.
 */
export async function audioDurationSeconds(blob: Blob): Promise<number> {
  const Ctx =
    typeof AudioContext !== "undefined"
      ? AudioContext
      : (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return 0;
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    return decoded.duration;
  } catch {
    return 0;
  } finally {
    void ctx.close();
  }
}

/**
 * Trim Float32 samples to a range [startSec, endSec] and encode as WAV blob.
 */
export function trimToWav(
  samples: Float32Array,
  sampleRate: number,
  startSec: number,
  endSec: number
): Blob {
  const startIdx = Math.max(0, Math.floor(startSec * sampleRate));
  const endIdx = Math.min(samples.length, Math.floor(endSec * sampleRate));
  const slice = samples.slice(startIdx, endIdx);
  const int16 = new Int16Array(slice.length);
  for (let i = 0; i < slice.length; i++) {
    const s = Math.max(-1, Math.min(1, slice[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return encodeWav(int16, sampleRate);
}

/**
 * Encode int16 samples as a WAV file.
 */
function encodeWav(samples: Int16Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const w = (off: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
  };

  w(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  w(8, "WAVE");
  w(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true); // bits per sample
  w(36, "data");
  view.setUint32(40, dataSize, true);

  new Int16Array(buffer, 44).set(samples);
  return new Blob([buffer], { type: "audio/wav" });
}
