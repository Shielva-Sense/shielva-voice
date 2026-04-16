"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { Download, Loader2, Waves } from "lucide-react";

interface Props {
  audioUrl: string;
  name?: string;
  autoPlay?: boolean;
}

/** Format seconds as m:ss.mmm */
function fmtMs(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00.000";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 1000);
  return `${m}:${sec.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;
}

/**
 * Encode an AudioBuffer as a 16-bit PCM WAV Blob.
 * Used when baking speed + tone into the downloaded file via OfflineAudioContext.
 */
function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numCh      = buffer.numberOfChannels;
  const sr         = buffer.sampleRate;
  const numSamples = buffer.length;
  const bps        = 2; // 16-bit
  const dataSize   = numCh * numSamples * bps;
  const ab         = new ArrayBuffer(44 + dataSize);
  const v          = new DataView(ab);

  const str = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  str(0,  "RIFF"); v.setUint32(4,  36 + dataSize, true);
  str(8,  "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true);                     // chunk size
  v.setUint16(20, 1,  true);                     // PCM
  v.setUint16(22, numCh, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * numCh * bps, true);
  v.setUint16(32, numCh * bps, true);
  v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, dataSize, true);

  let off = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const s = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: "audio/wav" });
}

const SPEEDS = [0.2, 0.5, 1, 1.5, 2] as const;
type Speed = typeof SPEEDS[number];

interface TonePreset {
  id: string;
  label: string;
  // Band 1 (primary EQ)
  type?: BiquadFilterType;
  freq?: number;
  gain?: number;
  // Band 2 (extra shaping — only for gender presets)
  type2?: BiquadFilterType;
  freq2?: number;
  gain2?: number;
}

/**
 * Tone presets — all values are mastering-grade EQ curves.
 *
 * Masculine / Feminine are scientifically grounded:
 *  ♂ Male voice energy: 85–180 Hz fundamental + chest resonance below 300 Hz.
 *    → boost low shelf +7 dB @ 130 Hz (weight/body), cut high shelf −3 dB @ 6 kHz
 *      (de-emphasis of sibilance / "thinness" in female-voiced TTS).
 *  ♀ Female voice energy: 165–255 Hz fundamental + formant peaks at 1–4 kHz.
 *    → boost high shelf +5 dB @ 3 kHz (presence/clarity), cut low shelf −4 dB @ 220 Hz
 *      (reduces chest weight, lifts perceived pitch register).
 */
const TONE_PRESETS: TonePreset[] = [
  { id: "natural",  label: "Natural" },
  { id: "warm",     label: "Warm",      type: "lowshelf",  freq: 300,  gain:  5 },
  { id: "crisp",    label: "Crisp",     type: "highshelf", freq: 5000, gain:  6 },
  { id: "deep",     label: "Deep",      type: "lowshelf",  freq: 150,  gain:  8 },
  { id: "airy",     label: "Airy",      type: "highshelf", freq: 9000, gain:  7 },
  // Gender-shaping presets (dual-band)
  { id: "masc",     label: "♂ Masc",
    type:  "lowshelf",  freq:  130, gain:  7,   // chest resonance / body
    type2: "highshelf", freq2: 6000, gain2: -3, // de-emphasise sibilance / thinness
  },
  { id: "fem",      label: "♀ Fem",
    type:  "highshelf", freq:  3000, gain:  5,  // presence / clarity / air
    type2: "lowshelf",  freq2:  220, gain2: -4, // reduce chest weight, lift register
  },
];

export default function SoapBubblePlayer({ audioUrl, name = "Generated Speech", autoPlay = false }: Props) {
  const audioRef    = useRef<HTMLAudioElement>(null);
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const wrapRef     = useRef<HTMLDivElement>(null);
  const animRef     = useRef<number>(0);
  const analyserRef    = useRef<AnalyserNode | null>(null);
  const audioCtxRef    = useRef<AudioContext | null>(null);
  const filterRef      = useRef<BiquadFilterNode | null>(null);  // Band 1 (primary EQ)
  const filterRef2     = useRef<BiquadFilterNode | null>(null);  // Band 2 (gender shaping)
  const noiseHpRef     = useRef<BiquadFilterNode | null>(null);      // high-pass: removes low rumble
  const noiseCompRef   = useRef<DynamicsCompressorNode | null>(null); // gates noise floor
  const phaseRef       = useRef(0);
  const playingRef  = useRef(false);
  const currentTimeRef = useRef(0);
  const durationRef    = useRef(0);

  const [playing,     setPlaying]  = useState(false);
  const [currentTime, setCurrent]  = useState(0);
  const [duration,    setDuration] = useState(0);
  const [ready,       setReady]    = useState(false);
  const [buffering,   setBuffering] = useState(true);   // true until canplaythrough
  const [canvasW,     setCanvasW]  = useState(400);
  const [speed,       setSpeedState]  = useState<Speed>(1);
  const [tone,        setToneState]   = useState("natural");
  const [noiseFilter, setNoiseFilter] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Keep refs in sync
  useEffect(() => { playingRef.current    = playing;     }, [playing]);
  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);
  useEffect(() => { durationRef.current    = duration;    }, [duration]);

  // ── Responsive canvas width via ResizeObserver ──────────────────────────────
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.floor(entry.contentRect.width);
      if (w > 0) setCanvasW(w);
    });
    ro.observe(el);
    setCanvasW(el.getBoundingClientRect().width || 400);
    return () => ro.disconnect();
  }, []);

  // ── Web Audio context ────────────────────────────────────────────────────────
  const initAudioCtx = useCallback(() => {
    if (analyserRef.current || !audioRef.current) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const src = ctx.createMediaElementSource(audioRef.current);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;

      // ① Band-1 EQ (primary tone shaping — shelf / peaking)
      const filter = ctx.createBiquadFilter();
      filter.type = "peaking";
      filter.frequency.value = 1000;
      filter.gain.value = 0;       // transparent by default (Natural)
      filterRef.current = filter;

      // ② Band-2 EQ (extra shaping for gender presets; transparent by default)
      const filter2 = ctx.createBiquadFilter();
      filter2.type = "peaking";
      filter2.frequency.value = 1000;
      filter2.gain.value = 0;
      filterRef2.current = filter2;

      // ③ Noise high-pass — removes low-frequency rumble/hum below 80 Hz.
      //    Start at 1 Hz (transparent) so it's a no-op until noise filter is on.
      const noiseHp = ctx.createBiquadFilter();
      noiseHp.type = "highpass";
      noiseHp.frequency.value = 1;   // OFF = transparent (1 Hz ≈ pass-through)
      noiseHp.Q.value = 0.7;
      noiseHpRef.current = noiseHp;

      // ④ Noise dynamics compressor — gates the noise floor.
      //    Start with settings that make it transparent (threshold near 0 dB).
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = 0;   // OFF = no compression
      comp.knee.value = 40;
      comp.ratio.value = 1;
      comp.attack.value = 0;
      comp.release.value = 0.25;
      noiseCompRef.current = comp;

      // Chain: src → band1 → band2 → noiseHP → noiseComp → analyser → out
      src.connect(filter);
      filter.connect(filter2);
      filter2.connect(noiseHp);
      noiseHp.connect(comp);
      comp.connect(analyser);
      analyser.connect(ctx.destination);

      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
    } catch { /* already connected */ }
  }, []);

  // ── Apply tone preset (dual-band EQ) ─────────────────────────────────────────
  const applyTone = useCallback((toneId: string) => {
    const f1 = filterRef.current;
    const f2 = filterRef2.current;
    if (!f1 || !f2) return;

    const preset = TONE_PRESETS.find(t => t.id === toneId);

    if (!preset || !preset.type) {
      // Natural — explicitly reset both bands to transparent peaking with zero gain
      // (don't just set gain=0; also reset type to avoid stale shelf topology)
      f1.type = "peaking"; f1.frequency.value = 1000; f1.gain.value = 0;
      f2.type = "peaking"; f2.frequency.value = 1000; f2.gain.value = 0;
      return;
    }

    // Band 1: primary tone shaping
    f1.type = preset.type;
    f1.frequency.value = preset.freq ?? 1000;
    f1.gain.value = preset.gain ?? 0;

    // Band 2: extra shaping (gender presets) or transparent bypass
    if (preset.type2) {
      f2.type = preset.type2;
      f2.frequency.value = preset.freq2 ?? 1000;
      f2.gain.value = preset.gain2 ?? 0;
    } else {
      f2.type = "peaking";
      f2.frequency.value = 1000;
      f2.gain.value = 0;
    }
  }, []);

  const handleTone = (toneId: string) => {
    setToneState(toneId);
    applyTone(toneId);
  };

  // ── Noise filter toggle ───────────────────────────────────────────────────────
  const applyNoiseFilter = useCallback((on: boolean) => {
    const hp   = noiseHpRef.current;
    const comp = noiseCompRef.current;
    if (!hp || !comp) return;

    if (on) {
      // Aggressively cut everything below 80 Hz (hum/rumble)
      hp.frequency.value = 80;
      hp.Q.value = 1.2;
      // Compress the noise floor hard: only signals louder than −45 dB pass freely
      comp.threshold.value = -45;
      comp.knee.value = 30;
      comp.ratio.value = 16;
      comp.attack.value = 0.002;
      comp.release.value = 0.15;
    } else {
      // Transparent / bypass
      hp.frequency.value = 1;
      hp.Q.value = 0.7;
      comp.threshold.value = 0;
      comp.knee.value = 40;
      comp.ratio.value = 1;
      comp.attack.value = 0;
      comp.release.value = 0.25;
    }
  }, []);

  const handleNoiseFilter = () => {
    const next = !noiseFilter;
    setNoiseFilter(next);
    applyNoiseFilter(next);
  };

  // ── Apply speed ──────────────────────────────────────────────────────────────
  const handleSpeed = (s: Speed) => {
    setSpeedState(s);
    if (audioRef.current) audioRef.current.playbackRate = s;
  };

  // ── Download: offline-render with speed + tone baked in ──────────────────────
  const handleDownload = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      // Fetch the source WAV
      const res = await fetch(audioUrl);
      const rawBuf = await res.arrayBuffer();

      // Decode into an AudioBuffer
      const tmpCtx = new AudioContext();
      const srcBuf = await tmpCtx.decodeAudioData(rawBuf);
      await tmpCtx.close();

      // Output length is shorter / longer depending on speed
      const outLen = Math.ceil(srcBuf.length / speed);
      const offCtx = new OfflineAudioContext(srcBuf.numberOfChannels, outLen, srcBuf.sampleRate);

      // Source node
      const src = offCtx.createBufferSource();
      src.buffer = srcBuf;
      src.playbackRate.value = speed;

      // ① Tone — band 1 (bypass when Natural)
      const preset = TONE_PRESETS.find(t => t.id === tone);
      let lastNode: AudioNode = src;

      if (preset?.type) {
        const filt = offCtx.createBiquadFilter();
        filt.type = preset.type;
        filt.frequency.value = preset.freq ?? 1000;
        filt.gain.value = preset.gain ?? 0;
        lastNode.connect(filt);
        lastNode = filt;
      }

      // ② Tone — band 2 (only for gender presets)
      if (preset?.type2) {
        const filt2 = offCtx.createBiquadFilter();
        filt2.type = preset.type2;
        filt2.frequency.value = preset.freq2 ?? 1000;
        filt2.gain.value = preset.gain2 ?? 0;
        lastNode.connect(filt2);
        lastNode = filt2;
      }

      // ② Noise filter (high-pass + compressor, only when enabled)
      if (noiseFilter) {
        const hp = offCtx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 80;
        hp.Q.value = 1.2;
        lastNode.connect(hp);
        lastNode = hp;

        const comp = offCtx.createDynamicsCompressor();
        comp.threshold.value = -45;
        comp.knee.value = 30;
        comp.ratio.value = 16;
        comp.attack.value = 0.002;
        comp.release.value = 0.15;
        lastNode.connect(comp);
        lastNode = comp;
      }

      lastNode.connect(offCtx.destination);

      src.start(0);
      const rendered = await offCtx.startRendering();

      // Encode as 16-bit WAV and trigger download
      const wavBlob = audioBufferToWav(rendered);
      const blobUrl = URL.createObjectURL(wavBlob);

      // Build a descriptive filename: name_1.5x_warm.wav
      const speedStr = speed === 1 ? "1x" : `${speed}x`;
      const toneStr  = tone === "natural" ? "" : `_${tone}`;
      const noiseStr = noiseFilter ? "_denoised" : "";
      const filename = `${(name || "shielva-speech").replace(/[^a-z0-9]/gi, "_")}_${speedStr}${toneStr}${noiseStr}.wav`;

      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    } catch {
      // Fallback: download original if offline render fails
      const a = document.createElement("a");
      a.href = audioUrl;
      a.download = `${name || "shielva-speech"}.wav`;
      a.click();
    } finally {
      setDownloading(false);
    }
  }, [audioUrl, name, speed, tone, noiseFilter, downloading]);

  // ── Canvas draw loop ─────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const cx = W / 2;
    const cy = H / 2;
    const BASE_R = Math.min(W, H) * 0.30;

    ctx.clearRect(0, 0, W, H);
    phaseRef.current += 0.018;
    const phase = phaseRef.current;

    // Frequency data
    const freqBins = analyserRef.current?.frequencyBinCount ?? 64;
    const freqData = new Uint8Array(freqBins);
    analyserRef.current?.getByteFrequencyData(freqData);
    const avgFreq = freqData.reduce((a, b) => a + b, 0) / freqBins;
    const normFreq = avgFreq / 255;

    const bubbleR = BASE_R + normFreq * 12;

    // ── Bamboo rings ──────────────────────────────────────────────────────────
    const bambooColors = [
      "rgba(110,165,80,0.32)",
      "rgba(140,195,90,0.20)",
      "rgba(170,210,110,0.10)",
    ];
    for (let i = 0; i < 3; i++) {
      const ringR = bubbleR + 24 + i * 16 + normFreq * 10 * (i + 1);
      const segments = 28 + i * 8;
      const segAngle = (Math.PI * 2) / segments;
      for (let s = 0; s < segments; s++) {
        const a0 = s * segAngle + phase * (i % 2 === 0 ? 0.08 : -0.06);
        const a1 = a0 + segAngle * 0.82;
        ctx.beginPath();
        ctx.arc(cx, cy, ringR, a0, a1);
        ctx.strokeStyle = bambooColors[i];
        ctx.lineWidth = 2.5 - i * 0.5;
        ctx.lineCap = "round";
        ctx.stroke();
        const nodePulse = 0.5 + 0.5 * Math.sin(phase * 3 + s);
        ctx.beginPath();
        ctx.arc(cx + ringR * Math.cos(a0), cy + ringR * Math.sin(a0), 1.2 + normFreq * nodePulse * 2, 0, Math.PI * 2);
        ctx.fillStyle = bambooColors[i].replace(/[\d.]+\)$/, "0.7)");
        ctx.fill();
      }
    }

    // ── Radial freq bars ──────────────────────────────────────────────────────
    if (playingRef.current && analyserRef.current) {
      const barCount = 80;
      for (let i = 0; i < barCount; i++) {
        const angle = (i / barCount) * Math.PI * 2 - Math.PI / 2;
        const fIdx = Math.floor((i / barCount) * freqBins * 0.6);
        const barLen = (freqData[fIdx] / 255) * 32;
        const hueBar = (phase * 30 + i * 4.5) % 360;
        const innerR = bubbleR + 4;
        ctx.beginPath();
        ctx.moveTo(cx + innerR * Math.cos(angle), cy + innerR * Math.sin(angle));
        ctx.lineTo(cx + (innerR + barLen) * Math.cos(angle), cy + (innerR + barLen) * Math.sin(angle));
        ctx.strokeStyle = `hsla(${hueBar}, 85%, 65%, ${0.4 + normFreq * 0.6})`;
        ctx.lineWidth = 1.5;
        ctx.lineCap = "round";
        ctx.stroke();
      }
    }

    // ── Morphing soap bubble ──────────────────────────────────────────────────
    const pts = 128;
    ctx.beginPath();
    for (let i = 0; i <= pts; i++) {
      const angle = (i / pts) * Math.PI * 2;
      const morph =
        Math.sin(angle * 2 + phase) * (10 + normFreq * 20) +
        Math.sin(angle * 3 - phase * 1.4) * (6 + normFreq * 14) +
        Math.sin(angle * 5 + phase * 0.9) * (3 + normFreq * 8) +
        Math.sin(angle * 7 - phase * 0.5) * (1.5 + normFreq * 5);
      const r = bubbleR + morph;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();

    const hueBase = (phase * 18) % 360;
    const bodyGrad = ctx.createRadialGradient(cx - BASE_R * 0.28, cy - BASE_R * 0.28, BASE_R * 0.05, cx, cy, BASE_R * 1.15);
    bodyGrad.addColorStop(0.0,  `hsla(${hueBase}, 75%, 98%, 0.22)`);
    bodyGrad.addColorStop(0.25, `hsla(${(hueBase + 55) % 360}, 70%, 88%, 0.14)`);
    bodyGrad.addColorStop(0.55, `hsla(${(hueBase + 160) % 360}, 65%, 78%, 0.10)`);
    bodyGrad.addColorStop(0.8,  `hsla(${(hueBase + 260) % 360}, 70%, 70%, 0.08)`);
    bodyGrad.addColorStop(1.0,  `hsla(${(hueBase + 310) % 360}, 80%, 60%, 0.04)`);
    ctx.fillStyle = bodyGrad;
    ctx.fill();

    const borderGrad = ctx.createLinearGradient(cx - BASE_R, cy - BASE_R, cx + BASE_R, cy + BASE_R);
    borderGrad.addColorStop(0.0,  `hsla(${hueBase}, 90%, 85%, 0.90)`);
    borderGrad.addColorStop(0.33, `hsla(${(hueBase + 100) % 360}, 88%, 82%, 0.85)`);
    borderGrad.addColorStop(0.66, `hsla(${(hueBase + 220) % 360}, 85%, 80%, 0.80)`);
    borderGrad.addColorStop(1.0,  `hsla(${(hueBase + 330) % 360}, 90%, 85%, 0.90)`);
    ctx.strokeStyle = borderGrad;
    ctx.lineWidth = 1.3 + normFreq * 1.8;
    ctx.stroke();

    // ── Specular glare ────────────────────────────────────────────────────────
    ctx.save();
    ctx.clip();
    const glare1 = ctx.createRadialGradient(cx - BASE_R * 0.38, cy - BASE_R * 0.42, 0, cx - BASE_R * 0.3, cy - BASE_R * 0.32, BASE_R * 0.45);
    glare1.addColorStop(0, "rgba(255,255,255,0.52)");
    glare1.addColorStop(0.5, "rgba(255,255,255,0.12)");
    glare1.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glare1;
    ctx.fill();
    const glare2 = ctx.createRadialGradient(cx + BASE_R * 0.28, cy + BASE_R * 0.30, 0, cx + BASE_R * 0.22, cy + BASE_R * 0.25, BASE_R * 0.28);
    glare2.addColorStop(0, `hsla(${(hueBase + 180) % 360}, 80%, 95%, 0.20)`);
    glare2.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glare2;
    ctx.fill();
    ctx.restore();

    animRef.current = requestAnimationFrame(draw);
  }, []);

  useEffect(() => {
    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [draw]);

  useEffect(() => {
    if (autoPlay && audioRef.current && ready) {
      initAudioCtx();
      audioRef.current.play().catch(() => {});
    }
  }, [autoPlay, ready, initAudioCtx]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    // Initialize / resume AudioContext on every user click (required by browser autoplay policy)
    initAudioCtx();
    if (audioCtxRef.current?.state === "suspended") {
      await audioCtxRef.current.resume().catch(() => {});
    }
    applyTone(tone);
    applyNoiseFilter(noiseFilter);
    audio.playbackRate = speed;
    try {
      if (playing) {
        audio.pause();
      } else {
        if (audio.ended) audio.currentTime = 0;
        await audio.play();
      }
    } catch {
      // AbortError / NotAllowedError — browser blocked autoplay, ignore (user can retry click)
    }
  };

  const CANVAS_H = Math.min(canvasW * 0.55, 300);
  const pct = duration ? (currentTime / duration) * 100 : 0;

  // ── Shared button style helpers ──────────────────────────────────────────────
  const pillBtn = (active: boolean): React.CSSProperties => ({
    padding: "3px 9px",
    borderRadius: 20,
    border: active ? "1px solid rgba(160,240,210,0.55)" : "1px solid var(--border-subtle)",
    background: active ? "rgba(160,240,210,0.14)" : "var(--surface-subtle)",
    color: active ? "rgba(160,240,210,0.95)" : "var(--text-faint)",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.04em",
    cursor: "pointer",
    transition: "all 0.15s",
    whiteSpace: "nowrap" as const,
  });

  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 0 }}>

      {/* Track label */}
      <div style={{
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: "var(--text-faint)",
        textAlign: "center",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        marginBottom: 6,
        padding: "0 8px",
      }}>
        ◆&nbsp;&nbsp;{name}
      </div>

      {/* ── Speed selector ─────────────────────────────────────────────────── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        padding: "0 4px 6px",
        flexWrap: "wrap",
      }}>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", color: "var(--text-faint)", marginRight: 2, textTransform: "uppercase" }}>
          Speed
        </span>
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => handleSpeed(s)}
            style={pillBtn(speed === s)}
          >
            {s === 1 ? "1×" : `${s}×`}
          </button>
        ))}
      </div>

      {/* ── Tone + Noise filter row ─────────────────────────────────────── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        padding: "0 4px 8px",
        flexWrap: "wrap",
      }}>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", color: "var(--text-faint)", marginRight: 2, textTransform: "uppercase" }}>
          Tone
        </span>
        {TONE_PRESETS.map((t) => (
          <button
            key={t.id}
            onClick={() => handleTone(t.id)}
            style={pillBtn(tone === t.id)}
          >
            {t.label}
          </button>
        ))}

        {/* Divider */}
        <span style={{ width: 1, height: 14, background: "var(--border-subtle)", margin: "0 3px", flexShrink: 0 }} />

        {/* Noise filter toggle */}
        <button
          onClick={handleNoiseFilter}
          title={noiseFilter ? "Noise filter ON — click to disable" : "Remove background noise"}
          style={{
            ...pillBtn(noiseFilter),
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            ...(noiseFilter ? {
              background: "rgba(250,200,80,0.14)",
              border: "1px solid rgba(250,200,80,0.55)",
              color: "rgba(250,220,100,0.95)",
            } : {}),
          }}
        >
          <Waves size={10} strokeWidth={2.5} />
          Denoise
          {noiseFilter && (
            <span style={{
              fontSize: 8,
              background: "rgba(250,200,80,0.25)",
              borderRadius: 6,
              padding: "1px 4px",
              letterSpacing: "0.06em",
            }}>ON</span>
          )}
        </button>
      </div>

      {/* Canvas — full width, click to play/pause */}
      <div ref={wrapRef} style={{ width: "100%", position: "relative", cursor: "pointer" }} onClick={togglePlay}>
        <canvas
          ref={canvasRef}
          width={canvasW}
          height={CANVAS_H}
          style={{ display: "block", width: "100%", height: CANVAS_H }}
        />

        {/* Play/Pause/Buffering icon centred over canvas */}
        <div style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
        }}>
          {buffering ? (
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none" style={{ animation: "spin 0.9s linear infinite" }}>
              <circle cx="14" cy="14" r="11" stroke="rgba(255,255,255,0.15)" strokeWidth="2.5" />
              <path d="M14 3 A11 11 0 0 1 25 14" stroke="rgba(160,240,210,0.9)" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          ) : playing ? (
            <svg width="22" height="22" viewBox="0 0 20 20" fill="none">
              <rect x="4" y="3" width="4" height="14" rx="1.5" fill="rgba(255,255,255,0.85)" />
              <rect x="12" y="3" width="4" height="14" rx="1.5" fill="rgba(255,255,255,0.85)" />
            </svg>
          ) : (
            <svg width="26" height="26" viewBox="0 0 22 22" fill="none">
              <path d="M7 4L18 11L7 18V4Z" fill="rgba(255,255,255,0.88)" />
            </svg>
          )}
        </div>

        {/* Speed badge overlay (top-right) */}
        {speed !== 1 && (
          <div style={{
            position: "absolute",
            top: 8,
            right: 8,
            background: "rgba(0,0,0,0.55)",
            border: "1px solid rgba(160,240,210,0.35)",
            borderRadius: 10,
            padding: "2px 7px",
            fontSize: 10,
            fontWeight: 800,
            color: "rgba(160,240,210,0.9)",
            pointerEvents: "none",
            letterSpacing: "0.06em",
          }}>
            {speed}×
          </div>
        )}
      </div>

      {/* Controls row */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 4px 4px",
        width: "100%",
      }}>

        {/* Play / Pause button */}
        <button
          onClick={togglePlay}
          style={{
            flexShrink: 0,
            width: 34,
            height: 34,
            borderRadius: "50%",
            border: "1px solid rgba(160,240,210,0.25)",
            background: "rgba(160,240,210,0.07)",
            color: "rgba(160,240,210,0.85)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(160,240,210,0.15)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(160,240,210,0.07)")}
        >
          {buffering ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ animation: "spin 0.9s linear infinite" }}>
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
              <path d="M7 1.5 A5.5 5.5 0 0 1 12.5 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          ) : playing ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="1" y="1" width="3.5" height="10" rx="1" fill="currentColor"/>
              <rect x="7.5" y="1" width="3.5" height="10" rx="1" fill="currentColor"/>
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 1.5L10.5 6L2 10.5V1.5Z" fill="currentColor"/>
            </svg>
          )}
        </button>

        {/* Current time with ms */}
        <span style={{
          flexShrink: 0,
          fontSize: 10,
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
          color: "var(--text-muted)",
          minWidth: 52,
          letterSpacing: "0.02em",
        }}>
          {fmtMs(currentTime)}
        </span>

        {/* Seek bar — fills remaining space */}
        <div style={{ flex: 1, position: "relative", height: 4, borderRadius: 4, background: "var(--surface-subtle)", cursor: "pointer" }}>
          <div style={{
            position: "absolute",
            left: 0, top: 0, bottom: 0,
            width: `${pct}%`,
            borderRadius: 4,
            background: "linear-gradient(to right, rgba(110,210,160,0.9), rgba(160,240,210,0.7))",
            transition: "width 0.1s linear",
          }} />
          <input
            type="range"
            min={0}
            max={duration || 1}
            step={0.001}
            value={currentTime}
            onChange={(e) => {
              const t = Number(e.target.value);
              setCurrent(t);
              if (audioRef.current) audioRef.current.currentTime = t;
            }}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              opacity: 0,
              cursor: "pointer",
              margin: 0,
            }}
          />
        </div>

        {/* Duration with ms */}
        <span style={{
          flexShrink: 0,
          fontSize: 10,
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
          color: "var(--text-faint)",
          minWidth: 52,
          textAlign: "right",
          letterSpacing: "0.02em",
        }}>
          {fmtMs(duration)}
        </span>

        {/* Download — bakes current speed + tone into the WAV */}
        <button
          onClick={handleDownload}
          disabled={downloading}
          title={
            downloading
              ? "Rendering…"
              : speed === 1 && tone === "natural"
              ? "Download WAV"
              : `Download WAV (${speed === 1 ? "1×" : `${speed}×`}${tone !== "natural" ? ` · ${tone}` : ""})`
          }
          style={{
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: 11,
            fontWeight: 600,
            color: downloading ? "rgba(160,240,210,0.4)" : "rgba(160,240,210,0.7)",
            background: "rgba(160,240,210,0.07)",
            border: "1px solid rgba(160,240,210,0.18)",
            borderRadius: 20,
            padding: "5px 11px 5px 9px",
            cursor: downloading ? "wait" : "pointer",
            letterSpacing: "0.04em",
            transition: "background 0.15s, color 0.15s",
            whiteSpace: "nowrap",
          }}
          onMouseEnter={(e) => {
            if (!downloading) {
              e.currentTarget.style.background = "rgba(160,240,210,0.16)";
              e.currentTarget.style.color = "rgba(160,240,210,1)";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(160,240,210,0.07)";
            e.currentTarget.style.color = downloading ? "rgba(160,240,210,0.4)" : "rgba(160,240,210,0.7)";
          }}
        >
          {downloading
            ? <Loader2 size={13} strokeWidth={2.5} style={{ animation: "spin 1s linear infinite" }} />
            : <Download size={13} strokeWidth={2.5} />
          }
        </button>
      </div>

      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        src={audioUrl}
        preload="auto"
        onPlay={() => { setPlaying(true); setBuffering(false); }}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrent(0); }}
        onTimeUpdate={() => setCurrent(audioRef.current?.currentTime ?? 0)}
        onLoadedMetadata={() => {
          setDuration(audioRef.current?.duration ?? 0);
          setReady(true);
          if (audioRef.current) audioRef.current.playbackRate = speed;
        }}
        onCanPlayThrough={() => setBuffering(false)}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => setBuffering(false)}
        onError={() => {
          setPlaying(false);
          setBuffering(false);
        }}
        style={{ display: "none" }}
      />
    </div>
  );
}
