"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CONTROL_HELP_DELAY_MS, CONTROL_HELP_STORAGE_KEY, describeControl, dismissControlHelp, parseHelpPreferences, type ControlHelp, type HelpPreferences } from "../../lib/control-help";

export function useControlHelpPreferences() {
  const [preferences, setPreferences] = useState<HelpPreferences>({ enabled: true, dismissed: [] });
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { try { setPreferences(parseHelpPreferences(localStorage.getItem(CONTROL_HELP_STORAGE_KEY))); } catch {} setLoaded(true); }, []);
  useEffect(() => { if (loaded) { try { localStorage.setItem(CONTROL_HELP_STORAGE_KEY, JSON.stringify(preferences)); } catch {} } }, [loaded, preferences]);
  const setEnabled = useCallback((enabled: boolean) => setPreferences(p => ({ ...p, enabled })), []);
  const dismiss = useCallback((id: string) => setPreferences(p => dismissControlHelp(p, id)), []);
  const reset = useCallback(() => setPreferences({ enabled: true, dismissed: [] }), []);
  return { preferences, setEnabled, dismiss, reset };
}
const selector = ".booth-frame button, .booth-frame a, .booth-frame input[type=range], .booth-frame [role=button], .transition-preview-studio button, .transition-preview-studio input, .transition-preview-studio select";
export default function ControlHelpBubbles({ preferences, setEnabled, dismiss }: Pick<ReturnType<typeof useControlHelpPreferences>, "preferences" | "setEnabled" | "dismiss">) {
  const [shown, setShown] = useState<{ tip: ControlHelp; target: HTMLElement; x: number; y: number } | null>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const shownRef = useRef(shown); shownRef.current = shown;
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    let openTimer: ReturnType<typeof setTimeout> | undefined;
    let candidate: HTMLElement | null = null;
    const managed = new Set<HTMLElement>();
    const clearOpen = () => { clearTimeout(openTimer); openTimer = undefined; };
    const close = () => { clearOpen(); clearTimeout(closeTimer.current); candidate = null; setShown(null); };
    // Suppress native title bubbles, including when help is switched off.
    const prepare = (el: HTMLElement) => { if (el.hasAttribute("title")) { el.dataset.controlHelpTitle = el.getAttribute("title") ?? ""; el.removeAttribute("title"); managed.add(el); } };
    document.querySelectorAll<HTMLElement>(selector).forEach(prepare);
    const observer = new MutationObserver(records => { for (const r of records) {
      if (r.type === "attributes" && r.target instanceof HTMLElement && r.target.matches(selector)) prepare(r.target);
      for (const n of r.addedNodes) if (n instanceof HTMLElement) { if (n.matches(selector)) prepare(n); n.querySelectorAll<HTMLElement>(selector).forEach(prepare); }
    } if (shownRef.current && !shownRef.current.target.isConnected) close(); });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["title"] });
    const targetAt = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>(selector) : null;
    const schedule = (el: HTMLElement | null) => {
      if (!el) return;
      clearTimeout(closeTimer.current);
      if (!preferences.enabled || candidate === el) return;
      clearOpen(); setShown(null); candidate = el;
      const label = el.getAttribute("aria-label") || el.textContent?.trim() || "";
      const tip = describeControl({ label, title: el.dataset.controlHelpTitle || "", classes: el.getAttribute("class") || "", context: el.parentElement?.getAttribute("class") || "", preview: Boolean(el.closest(".transition-preview-studio")) });
      if (preferences.dismissed.includes(tip.id)) return;
      openTimer = setTimeout(() => {
        if (!el.isConnected) return;
        const rect = el.getBoundingClientRect();
        setShown({ tip, target: el, x: Math.max(8, Math.min(rect.left, window.innerWidth - 340)), y: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 200)) });
      }, CONTROL_HELP_DELAY_MS);
    };
    const over = (event: PointerEvent) => { if (event.pointerType === "touch" || event.buttons) return; schedule(targetAt(event.target)); };
    const leave = (event: PointerEvent | FocusEvent) => {
      const origin = targetAt(event.target);
      if (origin !== candidate && !(event.target instanceof Node && bubble.current?.contains(event.target))) return;
      const next = event.relatedTarget;
      if (next instanceof Node && (candidate?.contains(next) || bubble.current?.contains(next))) return;
      clearOpen(); candidate = null;
      clearTimeout(closeTimer.current); closeTimer.current = setTimeout(() => setShown(null), 250);
    };
    const focus = (event: FocusEvent) => schedule(targetAt(event.target));
    const press = (event: PointerEvent) => { if (!(event.target instanceof Node && bubble.current?.contains(event.target))) close(); };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && shownRef.current) { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === "F1" && shownRef.current) { event.preventDefault(); bubble.current?.querySelector<HTMLButtonElement>("button")?.focus(); }
    };
    document.addEventListener("pointerover", over); document.addEventListener("pointerout", leave);
    document.addEventListener("focusin", focus); document.addEventListener("focusout", leave);
    document.addEventListener("pointerdown", press, true); document.addEventListener("keydown", key, true);
    window.addEventListener("resize", close); window.addEventListener("scroll", close, true);
    return () => {
      clearOpen(); clearTimeout(closeTimer.current); observer.disconnect(); setShown(null);
      document.removeEventListener("pointerover", over); document.removeEventListener("pointerout", leave);
      document.removeEventListener("focusin", focus); document.removeEventListener("focusout", leave);
      document.removeEventListener("pointerdown", press, true); document.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", close); window.removeEventListener("scroll", close, true);
      managed.forEach(el => { if (el.isConnected && !el.hasAttribute("title")) el.setAttribute("title", el.dataset.controlHelpTitle ?? ""); });
    };
  }, [preferences]);
  useEffect(() => {
    if (!shown) return;
    const previous = shown.target.getAttribute("aria-describedby");
    shown.target.setAttribute("aria-describedby", [previous, "loud-control-help-copy"].filter(Boolean).join(" "));
    const rect = bubble.current?.getBoundingClientRect();
    if (rect && rect.bottom > window.innerHeight - 8) setShown(current => current ? { ...current, y: Math.max(8, window.innerHeight - rect.height - 8) } : null);
    return () => { if (previous) shown.target.setAttribute("aria-describedby", previous); else shown.target.removeAttribute("aria-describedby"); };
  }, [shown?.target, shown?.tip.id]);
  if (!shown || !preferences.enabled) return null;
  return <div ref={bubble} className="control-help-bubble" role="dialog" aria-label={shown.tip.heading + " help"} style={{ left: shown.x, top: shown.y }} onPointerEnter={() => clearTimeout(closeTimer.current)} onPointerLeave={() => { closeTimer.current = setTimeout(() => setShown(null), 250); }} onFocusCapture={() => clearTimeout(closeTimer.current)}>
    <b>{shown.tip.heading}</b><p id="loud-control-help-copy">{shown.tip.body}</p>
    <div><button type="button" onClick={() => { dismiss(shown.tip.id); setShown(null); }}>Don't show this again</button><button type="button" onClick={() => { setEnabled(false); setShown(null); }}>Turn off all tips</button></div>
    <small>Esc closes · F1 focuses these options</small>
  </div>;
}
