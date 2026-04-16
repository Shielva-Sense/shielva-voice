"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Play, Pause } from "lucide-react";

interface WaveformRangeSelectorProps {
  /** Float32 PCM samples at sampleRate Hz */
  samples: Float32Array;
  sampleRate: number;
  duration: number;
  /** Callback when range changes — (startSec, endSec) */
  onRangeChange: (startSec: number, endSec: number) => void;
  /** Minimum selection in seconds */
  minRangeSec?: number;
}

const HEIGHT = 80;
const HANDLE_W = 10;

export default function WaveformRangeSelector({
  samples,
  sampleRate,
  duration,
  onRangeChange,
  minRangeSec = 1,
}: WaveformRangeSelectorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const animRef = useRef<number | null>(null);

  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(duration);
  const [dragging, setDragging] = useState<"start" | "end" | "region" | null>(null);
  const [dragOrigin, setDragOrigin] = useState({ x: 0, startVal: 0, endVal: 0 });
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(400);
  const [hoverCursor, setHoverCursor] = useState<string>("default");

  // Measure container width on mount and resize
  useEffect(() => {
    const measure = () => {
      if (containerRef.current) {
        const w = containerRef.current.getBoundingClientRect().width;
        if (w > 0) setCanvasWidth(Math.floor(w));
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Compute waveform peaks (one peak per pixel)
  const [peaks, setPeaks] = useState<Float32Array>(new Float32Array(0));

  useEffect(() => {
    if (canvasWidth <= 0) return;
    const numBars = canvasWidth;
    const samplesPerBar = Math.max(1, Math.floor(samples.length / numBars));
    const p = new Float32Array(numBars);
    for (let i = 0; i < numBars; i++) {
      let max = 0;
      const start = i * samplesPerBar;
      for (let j = start; j < start + samplesPerBar && j < samples.length; j++) {
        const v = Math.abs(samples[j]);
        if (v > max) max = v;
      }
      p[i] = max;
    }
    setPeaks(p);
  }, [samples, canvasWidth]);

  // Notify parent when range changes
  useEffect(() => {
    onRangeChange(rangeStart, rangeEnd);
  }, [rangeStart, rangeEnd, onRangeChange]);

  // Draw waveform
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || peaks.length === 0 || canvasWidth <= 0) return;

    const W = canvasWidth;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = HEIGHT * dpr;

    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = "#0a0f14";
    ctx.fillRect(0, 0, W, HEIGHT);

    const startPx = (rangeStart / duration) * W;
    const endPx = (rangeEnd / duration) * W;

    // Dimmed region outside selection
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, startPx, HEIGHT);
    ctx.fillRect(endPx, 0, W - endPx, HEIGHT);

    // Selected region background
    ctx.fillStyle = "rgba(109,159,55,0.08)";
    ctx.fillRect(startPx, 0, endPx - startPx, HEIGHT);

    // Draw waveform bars
    const barW = Math.max(1, W / peaks.length - 0.5);
    for (let i = 0; i < peaks.length; i++) {
      const x = (i / peaks.length) * W;
      const h = peaks[i] * (HEIGHT - 8);
      const inRange = x >= startPx && x <= endPx;
      ctx.fillStyle = inRange ? "rgba(109,159,55,0.85)" : "rgba(255,255,255,0.15)";
      ctx.fillRect(x, (HEIGHT - h) / 2, barW, Math.max(1, h));
    }

    // Selection border
    ctx.strokeStyle = "rgba(109,159,55,0.6)";
    ctx.lineWidth = 1;
    ctx.strokeRect(startPx, 0, endPx - startPx, HEIGHT);

    // ── Start handle ──
    const drawHandle = (hx: number, color: string) => {
      // Handle bar
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(hx - HANDLE_W / 2, 2, HANDLE_W, HEIGHT - 4, 3);
      ctx.fill();

      // Grip lines (white dashes)
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 1;
      for (let y = HEIGHT / 2 - 10; y <= HEIGHT / 2 + 10; y += 5) {
        ctx.beginPath();
        ctx.moveTo(hx - 2.5, y);
        ctx.lineTo(hx + 2.5, y);
        ctx.stroke();
      }
    };

    drawHandle(startPx, "#6d9f37");
    drawHandle(endPx, "#6d9f37");

    // Playhead
    if (playhead !== null) {
      const px = (playhead / duration) * W;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, HEIGHT);
      ctx.stroke();
    }

    // Time labels at handles
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "10px system-ui, sans-serif";

    // Start time label
    ctx.textAlign = "left";
    const startLabel = formatTime(rangeStart);
    const startLabelX = Math.max(2, startPx + HANDLE_W / 2 + 3);
    ctx.fillText(startLabel, startLabelX, HEIGHT - 4);

    // End time label
    ctx.textAlign = "right";
    const endLabel = formatTime(rangeEnd);
    const endLabelX = Math.min(W - 2, endPx - HANDLE_W / 2 - 3);
    ctx.fillText(endLabel, endLabelX, HEIGHT - 4);

    // Duration label (centered in selection)
    const selDur = rangeEnd - rangeStart;
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(163,201,110,0.9)";
    ctx.font = "bold 11px system-ui, sans-serif";
    ctx.fillText(`${selDur.toFixed(1)}s`, (startPx + endPx) / 2, 14);
  }, [peaks, rangeStart, rangeEnd, duration, playhead, canvasWidth]);

  useEffect(() => {
    draw();
  }, [draw]);

  // ── Mouse handlers ──

  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;

    const startPx = (rangeStart / duration) * rect.width;
    const endPx = (rangeEnd / duration) * rect.width;

    // Priority: check end handle first if start and end overlap
    const distStart = Math.abs(x - startPx);
    const distEnd = Math.abs(x - endPx);

    if (distEnd < HANDLE_W * 2.5 && distEnd <= distStart) {
      setDragging("end");
      setDragOrigin({ x: e.clientX, startVal: rangeStart, endVal: rangeEnd });
    } else if (distStart < HANDLE_W * 2.5) {
      setDragging("start");
      setDragOrigin({ x: e.clientX, startVal: rangeStart, endVal: rangeEnd });
    } else if (x > startPx && x < endPx) {
      setDragging("region");
      setDragOrigin({ x: e.clientX, startVal: rangeStart, endVal: rangeEnd });
    }
    e.preventDefault();
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const dx = e.clientX - dragOrigin.x;
    const dtSec = (dx / rect.width) * duration;

    if (dragging === "start") {
      const newStart = Math.max(0, Math.min(rangeEnd - minRangeSec, dragOrigin.startVal + dtSec));
      setRangeStart(newStart);
    } else if (dragging === "end") {
      const newEnd = Math.min(duration, Math.max(rangeStart + minRangeSec, dragOrigin.endVal + dtSec));
      setRangeEnd(newEnd);
    } else if (dragging === "region") {
      const regionLen = dragOrigin.endVal - dragOrigin.startVal;
      let newStart = dragOrigin.startVal + dtSec;
      let newEnd = dragOrigin.endVal + dtSec;
      if (newStart < 0) { newStart = 0; newEnd = regionLen; }
      if (newEnd > duration) { newEnd = duration; newStart = duration - regionLen; }
      setRangeStart(newStart);
      setRangeEnd(newEnd);
    }
  }, [dragging, dragOrigin, duration, rangeStart, rangeEnd, minRangeSec]);

  const handleMouseUp = useCallback(() => {
    setDragging(null);
  }, []);

  useEffect(() => {
    if (dragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [dragging, handleMouseMove, handleMouseUp]);

  // ── Touch support ──

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = touch.clientX - rect.left;
    const startPx = (rangeStart / duration) * rect.width;
    const endPx = (rangeEnd / duration) * rect.width;

    const distStart = Math.abs(x - startPx);
    const distEnd = Math.abs(x - endPx);

    if (distEnd < HANDLE_W * 3 && distEnd <= distStart) {
      setDragging("end");
      setDragOrigin({ x: touch.clientX, startVal: rangeStart, endVal: rangeEnd });
    } else if (distStart < HANDLE_W * 3) {
      setDragging("start");
      setDragOrigin({ x: touch.clientX, startVal: rangeStart, endVal: rangeEnd });
    } else {
      setDragging("region");
      setDragOrigin({ x: touch.clientX, startVal: rangeStart, endVal: rangeEnd });
    }
    e.preventDefault();
  };

  useEffect(() => {
    if (!dragging) return;
    const onTouchMove = (e: TouchEvent) => {
      handleMouseMove({ clientX: e.touches[0].clientX } as MouseEvent);
    };
    const onTouchEnd = () => handleMouseUp();
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    return () => {
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [dragging, handleMouseMove, handleMouseUp]);

  // ── Playback ──

  const handlePlayRange = () => {
    if (playing) {
      audioRef.current?.pause();
      setPlaying(false);
      setPlayhead(null);
      if (animRef.current) cancelAnimationFrame(animRef.current);
      return;
    }

    const startIdx = Math.floor(rangeStart * sampleRate);
    const endIdx = Math.floor(rangeEnd * sampleRate);
    const slice = samples.slice(startIdx, endIdx);

    const int16 = new Int16Array(slice.length);
    for (let i = 0; i < slice.length; i++) {
      const s = Math.max(-1, Math.min(1, slice[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    const wavBlob = encodeWavBlob(int16, sampleRate);
    const url = URL.createObjectURL(wavBlob);

    const audio = new Audio(url);
    audioRef.current = audio;
    setPlaying(true);

    audio.onended = () => {
      setPlaying(false);
      setPlayhead(null);
      URL.revokeObjectURL(url);
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };

    audio.play().then(() => {
      const tick = () => {
        if (!audio.paused && !audio.ended) {
          setPlayhead(rangeStart + audio.currentTime);
          animRef.current = requestAnimationFrame(tick);
        }
      };
      animRef.current = requestAnimationFrame(tick);
    });
  };

  // Cleanup on unmount
  useEffect(() => () => {
    audioRef.current?.pause();
    if (animRef.current) cancelAnimationFrame(animRef.current);
  }, []);

  // Cursor style based on hover position
  const handleCursorMove = (e: React.MouseEvent) => {
    if (dragging) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const startPx = (rangeStart / duration) * rect.width;
    const endPx = (rangeEnd / duration) * rect.width;

    if (Math.abs(x - startPx) < HANDLE_W * 2.5 || Math.abs(x - endPx) < HANDLE_W * 2.5) {
      setHoverCursor("grab");
    } else if (x > startPx && x < endPx) {
      setHoverCursor("grab");
    } else {
      setHoverCursor("default");
    }
  };

  return (
    <div ref={containerRef} className="vm-fade-in" style={{ marginBottom: 12 }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 6,
      }}>
        <div style={{
          fontSize: 11,
          color: "var(--gray-400)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          fontWeight: 600,
        }}>
          Select audio range — drag handles to trim
        </div>
        <div style={{ fontSize: 11, color: "var(--text-faint)" }}>
          Total: {duration.toFixed(1)}s
        </div>
      </div>

      {/* Waveform canvas */}
      <div style={{
        position: "relative",
        borderRadius: 8,
        overflow: "hidden",
        border: "1px solid var(--border, #1a1a1a)",
        cursor: dragging === "region" ? "grabbing" : dragging ? "grabbing" : hoverCursor,
      }}>
        <canvas
          ref={canvasRef}
          style={{ display: "block", width: "100%", height: HEIGHT }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleCursorMove}
          onTouchStart={handleTouchStart}
        />
      </div>

      {/* Controls row */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginTop: 8,
        flexWrap: "wrap",
      }}>
        <button
          onClick={handlePlayRange}
          className="vm-btn vm-btn-sm"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            color: playing ? "var(--bamboo-400)" : undefined,
            border: playing ? "1px solid rgba(109,159,55,0.4)" : undefined,
          }}
          title={playing ? "Stop" : "Play selected range"}
        >
          {playing ? <Pause size={12} strokeWidth={2.5} /> : <Play size={12} strokeWidth={2.5} />}
          <span>{playing ? "Stop" : "Play Range"}</span>
        </button>

        <div style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", gap: 12, flexWrap: "wrap" }}>
          <span>Start: <strong style={{ color: "var(--bamboo-400)" }}>{rangeStart.toFixed(1)}s</strong></span>
          <span>End: <strong style={{ color: "var(--bamboo-400)" }}>{rangeEnd.toFixed(1)}s</strong></span>
          <span>Duration: <strong style={{ color: "var(--bamboo-400)" }}>{(rangeEnd - rangeStart).toFixed(1)}s</strong></span>
        </div>
      </div>
    </div>
  );
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}:${s.toFixed(1).padStart(4, "0")}` : `${s.toFixed(1)}s`;
}

function encodeWavBlob(samples: Int16Array, sampleRate: number): Blob {
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
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  w(36, "data");
  view.setUint32(40, dataSize, true);
  new Int16Array(buffer, 44).set(samples);
  return new Blob([buffer], { type: "audio/wav" });
}
