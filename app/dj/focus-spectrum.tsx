"use client";
import { useEffect, useRef } from "react";
import { spectrumBands, spectrumLampAlpha } from "../../lib/spectrum-bands";

export type SpectrumSource = () => { analyser: AnalyserNode; playing: boolean } | null;

export default function FocusSpectrum({ source, deck }: { source: SpectrumSource; deck: "A" | "B" | "C" }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latestSource = useRef(source);
  latestSource.current = source;
  useEffect(() => {
    const surface = canvas.current;
    const paint = surface?.getContext("2d");
    if (!surface || !paint) return;
    let frame = 0, lastPaint = 0, width = 0, height = 0, visible = true;
    let bins = new Float32Array(0);
    const resize = new ResizeObserver(([entry]) => {
      width = entry.contentRect.width;
      height = entry.contentRect.height;
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      surface.width = Math.round(width * scale);
      surface.height = Math.round(height * scale);
      paint.setTransform(scale, 0, 0, scale, 0, 0);
    });
    resize.observe(surface);
    const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
    intersection.observe(surface);
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - lastPaint < 33 || document.hidden || !visible || !width || !height) return;
      lastPaint = now;
      paint.clearRect(0, 0, width, height);
      const signal = latestSource.current();
      if (!signal?.playing || signal.analyser.context.state !== "running") return;
      const analyser = signal.analyser;
      if (bins.length !== analyser.frequencyBinCount) bins = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(bins);
      const levels = spectrumBands(bins, analyser.context.sampleRate, analyser.fftSize);
      const cell = width / levels.length;
      const rows = 24, rowHeight = height / rows;
      const colour = deck === "A" ? "#ff2020" : deck === "B" ? "#1834b8" : "#ffe600";
      for (let band = 0; band < levels.length; band += 1) {
        // Each lamp is driven only by this frequency band's measured power.
        paint.fillStyle = colour;
        const lit = Math.floor(levels[band] * rows);
        for (let row = 0; row < lit; row += 1) {
          paint.globalAlpha = spectrumLampAlpha(levels[band], (row + 1) / rows);
          paint.fillRect(band * cell + 1.5, height - (row + 1) * rowHeight, Math.max(1, cell - 3), Math.max(1, rowHeight - 1));
        }
        if (lit > 0) {
          paint.globalAlpha = spectrumLampAlpha(levels[band], lit / rows);
          paint.shadowColor = colour;
          paint.shadowBlur = 14 * levels[band];
          paint.fillRect(band * cell + 1.5, height - lit * rowHeight, Math.max(1, cell - 3), Math.max(1, rowHeight - 1));
          paint.shadowBlur = 0;
        }
      }
      paint.globalAlpha = 1;
    };
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); resize.disconnect(); intersection.disconnect(); };
  }, [deck]);
  return <canvas ref={canvas} className="focus-spectrum" aria-hidden="true" />;
}
