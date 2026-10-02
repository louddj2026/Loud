export type ListenerWakeState = "off" | "held" | "background" | "unavailable";

type ScreenLock = {
  release(): Promise<void>;
  addEventListener(type: "release", callback: () => void, options?: { once: boolean }): void;
};

/** A page may hold a screen lock only while visible. Never leak a late grant. */
export function createListenerWakeLock(input: {
  request?: () => Promise<ScreenLock>;
  visible: () => boolean;
  report: (state: ListenerWakeState) => void;
}) {
  let enabled = false;
  let disposed = false;
  let pending = false;
  let generation = 0;
  let lock: ScreenLock | null = null;
  const release = () => {
    const previous = lock;
    lock = null;
    void previous?.release().catch(() => undefined);
  };
  const refresh = async () => {
    if (disposed) return;
    if (!enabled || !input.visible()) {
      generation += 1;
      release();
      input.report(enabled ? "background" : "off");
      return;
    }
    if (!input.request) { input.report("unavailable"); return; }
    if (lock || pending) return;
    pending = true;
    const requestedGeneration = generation;
    try {
      const granted = await input.request();
      if (disposed || !enabled || !input.visible() || generation !== requestedGeneration) {
        await granted.release().catch(() => undefined);
        return;
      }
      lock = granted;
      granted.addEventListener("release", () => {
        if (lock !== granted) return;
        lock = null;
        if (!disposed) input.report(enabled ? (input.visible() ? "unavailable" : "background") : "off");
      }, { once: true });
      input.report("held");
    } catch {
      if (!disposed && enabled && input.visible()) input.report("unavailable");
    } finally {
      pending = false;
      // Visibility may have changed twice while permission was pending.
      if (!disposed && enabled && input.visible() && generation !== requestedGeneration) void refresh();
    }
  };
  return {
    setEnabled(value: boolean) { enabled = value; void refresh(); },
    refresh,
    dispose() { disposed = true; enabled = false; generation += 1; release(); },
  };
}
