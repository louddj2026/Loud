"use client";
import { useCallback, useEffect, useRef } from "react";
import { fineTempoStepBpm, FINE_TEMPO_REPEAT_DELAY_MS, FINE_TEMPO_REPEAT_INTERVAL_MS } from "../../lib/tempo-adjustment";
import { PitchDownIcon, PitchUpIcon } from "./transport-icons";

export default function TempoStepButton({ deck, direction, disabled, onStep }: {
  deck: string;
  direction: -1 | 1;
  disabled: boolean;
  onStep: (direction: -1 | 1, deltaBpm: number) => void;
}) {
  const startedAt = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const step = useRef(onStep);
  step.current = onStep;
  const stop = useCallback(() => {
    if (timer.current !== null) clearInterval(timer.current);
    timer.current = null;
    startedAt.current = null;
  }, []);
  const start = () => {
    if (disabled || startedAt.current !== null) return;
    startedAt.current = performance.now();
    step.current(direction, fineTempoStepBpm(0));
    timer.current = setInterval(() => {
      if (startedAt.current === null) return;
      const elapsed = performance.now() - startedAt.current;
      if (elapsed >= FINE_TEMPO_REPEAT_DELAY_MS) step.current(direction, fineTempoStepBpm(elapsed));
    }, FINE_TEMPO_REPEAT_INTERVAL_MS);
  };
  useEffect(() => { if (disabled) stop(); }, [disabled, stop]);
  useEffect(() => {
    const visibilityChanged = () => { if (document.hidden) stop(); };
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      stop();
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [stop]);
  return <button className="wave-tempo-step" disabled={disabled}
    aria-label={`Deck ${deck} ${direction < 0 ? "decrease" : "increase"} BPM by 0.001; hold to accelerate`}
    title={`${direction < 0 ? "−" : "+"}0.001 BPM · hold to adjust faster`}
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      start();
    }}
    onPointerUp={(event) => {
      stop();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={stop} onLostPointerCapture={stop} onBlur={stop}
    onKeyDown={(event) => {
      if (event.key === " " || event.key === "Enter") { event.preventDefault(); if (!event.repeat) start(); }
    }}
    onKeyUp={(event) => {
      if (event.key === " " || event.key === "Enter") { event.preventDefault(); stop(); }
    }}
    onClick={(event) => { if (event.detail === 0 && startedAt.current === null) step.current(direction, fineTempoStepBpm(0)); }}>
    <span className="cdj-icon-bezel">{direction < 0 ? <PitchDownIcon /> : <PitchUpIcon />}</span>
  </button>;
}
