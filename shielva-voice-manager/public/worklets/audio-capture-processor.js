/**
 * AudioWorklet processor — runs in the dedicated audio rendering thread.
 *
 * Responsibilities:
 *  1. Receive 128-sample float32 frames from WebAudio engine (process())
 *  2. Accumulate frames into an internal ring buffer
 *  3. When CHUNK_SAMPLES (1024 samples = 64ms @ 16kHz) are ready, post
 *     a Float32Array to the main thread via MessagePort
 *
 * Lock-free design: the ring buffer is single-producer (audio thread) /
 * single-consumer (main thread via postMessage), so no Atomics needed —
 * the JS event loop serialises the postMessage delivery.
 *
 * Why AudioWorklet over ScriptProcessorNode:
 *  - Runs on a dedicated thread → no main-thread GC / layout jank
 *  - Deterministic 128-sample callbacks → lower jitter
 *  - Not deprecated (ScriptProcessorNode is)
 */

const CHUNK_SAMPLES = 1024; // 64 ms × 16000 Hz / 1000

class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Pre-allocate ring buffer: hold 4× chunk to absorb callback bursts
    this._buf = new Float32Array(CHUNK_SAMPLES * 4);
    this._writeHead = 0; // samples written into _buf
    this._rms = 0;
    this.port.onmessage = (e) => {
      if (e.data?.type === "stop") {
        this._stopped = true;
      }
    };
    this._stopped = false;
  }

  process(inputs) {
    if (this._stopped) return false;

    const channel = inputs[0]?.[0];
    if (!channel) return true;

    // Append 128 new samples to ring buffer
    for (let i = 0; i < channel.length; i++) {
      this._buf[this._writeHead++] = channel[i];
    }

    // Compute running RMS for energy meter (cheap: over last 128 samples)
    let sumSq = 0;
    for (let i = 0; i < channel.length; i++) sumSq += channel[i] * channel[i];
    this._rms = Math.sqrt(sumSq / channel.length);

    // Emit complete chunks
    while (this._writeHead >= CHUNK_SAMPLES) {
      // Copy chunk out
      const chunk = new Float32Array(this._buf.buffer, 0, CHUNK_SAMPLES);
      const out = new Float32Array(CHUNK_SAMPLES);
      out.set(chunk);

      // Shift remaining samples to front (memmove equivalent)
      const remaining = this._writeHead - CHUNK_SAMPLES;
      if (remaining > 0) {
        this._buf.copyWithin(0, CHUNK_SAMPLES, this._writeHead);
      }
      this._writeHead = remaining;

      // Post to main thread (transferable: zero-copy)
      this.port.postMessage({ type: "chunk", samples: out, rms: this._rms }, [out.buffer]);
    }

    return true; // keep processor alive
  }
}

registerProcessor("audio-capture-processor", AudioCaptureProcessor);
