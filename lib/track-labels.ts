type TrackLabelSource = {
  name?: string | null;
  album?: string | null;
};

const GENERIC_ALBUMS = new Set(["", "user upload", "user uploads", "uploaded", "uploads", "unknown"]);

function clean(value: string | null | undefined) {
  return (value ?? "").replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function withoutTrackNumber(value: string) {
  return value.replace(/^\s*\d{1,3}\s*[-._)]*\s*/, "").trim();
}

export function focusWaveTrackLabel(track: TrackLabelSource | null | undefined) {
  const originalName = (track?.name ?? "").replace(/_/g, " ").trim();
  const rawName = clean(originalName);
  const rawAlbum = clean(track?.album);
  if (!rawName) return { artist: "NO ARTIST", title: "NO TRACK LOADED" };

  const albumIsGeneric = GENERIC_ALBUMS.has(rawAlbum.toLowerCase());
  const parts = rawName.split(/\s+-\s+/).map(clean).filter(Boolean);
  const numberedPart = parts.findIndex((part) => /^\d{1,3}(?:\D|$)/.test(part));

  if (albumIsGeneric && numberedPart >= 1) {
    const compilation = /^(?:va|various(?: artists)?)$/i.test(parts[0]);
    const artist = compilation ? parts[numberedPart + 1] : parts[0];
    const titleParts = compilation ? parts.slice(numberedPart + 2) : parts.slice(numberedPart + 1);
    return {
      artist: clean(artist) || "UNKNOWN ARTIST",
      title: clean(titleParts.join(" - ")) || withoutTrackNumber(parts[numberedPart]) || rawName,
    };
  }

  if (albumIsGeneric) {
    const numberedArtistTitle = rawName.match(/^\d{1,3}\s*[-._)]*\s*(.+?)\s+-\s+(.+)$/);
    if (numberedArtistTitle) return { artist: clean(numberedArtistTitle[1]), title: clean(numberedArtistTitle[2]) };
    const artistNumberTitle = rawName.match(/^(.+?)\s+\d{1,3}\s*[-._)]\s*(.+)$/);
    if (artistNumberTitle) return { artist: clean(artistNumberTitle[1]), title: clean(artistNumberTitle[2]) };
    if (parts.length >= 2) return { artist: parts[0], title: parts.slice(1).join(" - ") };
    return { artist: "UNKNOWN ARTIST", title: withoutTrackNumber(rawName) || rawName };
  }

  const albumParts = rawAlbum.split(/\s+-\s+/).map(clean).filter(Boolean);
  const compilation = /^(?:va|various(?: artists)?)$/i.test(albumParts[0] ?? "");
  const strippedName = withoutTrackNumber(rawName);
  if (compilation) {
    const namedParts = withoutTrackNumber(originalName).split(/\s{2,}|\s+-\s+/).map(clean).filter(Boolean);
    if (namedParts.length >= 2) return { artist: namedParts[0], title: namedParts.slice(1).join(" - ") };
  }
  return {
    artist: albumParts[0] || "UNKNOWN ARTIST",
    title: strippedName || rawName,
  };
}

export function clippedFocusWaveLabel(value: string, limit: number) {
  const label = clean(value);
  return label.length <= limit ? label : `${label.slice(0, Math.max(1, limit - 1)).trimEnd()}…`;
}
