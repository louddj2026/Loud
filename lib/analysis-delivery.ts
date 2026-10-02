export function trackAnalysisUrl(id: string) {
  return `/api/analysis/${encodeURIComponent(id)}`;
}

export async function fetchTrackAnalysis<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const failure = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(failure.error ?? `Track analysis is unavailable (${response.status})`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error("Track analysis returned the wrong response type");
  }
  return response.json() as Promise<T>;
}
