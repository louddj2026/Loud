/** Measured FFT power in logarithmic bass-to-treble bands. Silence stays zero.
 * Fixed -90 to -30 dB display range: no automatic normalization between frames. */
export function spectrumBands(bins: Float32Array, sampleRate: number, fftSize: number, count = 48): number[] {
  const ceilingHz = Math.min(20000, sampleRate / 2);
  if (!bins.length || !(sampleRate > 0) || !(fftSize > 0) || ceilingHz <= 30) return Array(count).fill(0);
  const hzPerBin = sampleRate / fftSize;
  return Array.from({ length: count }, (_, band) => {
    const from = 30 * (ceilingHz / 30) ** (band / count);
    const to = 30 * (ceilingHz / 30) ** ((band + 1) / count);
    const first = Math.max(1, Math.min(bins.length - 1, Math.floor(from / hzPerBin)));
    const last = Math.max(first, Math.min(bins.length - 1, Math.ceil(to / hzPerBin) - 1));
    let power = 0;
    for (let index = first; index <= last; index += 1) {
      if (Number.isFinite(bins[index])) power += 10 ** (bins[index] / 10);
    }
    if (!power) return 0;
    const db = 10 * Math.log10(power / (last - first + 1));
    return Math.max(0, Math.min(1, (db + 90) / 60));
  });
}

/** Fixed brightness response, with no automatic gain or invented idle activity. */
export function spectrumLampAlpha(level: number, heightFraction: number): number {
  if (!(level > 0) || !Number.isFinite(level)) return 0;
  const strength = Math.min(1, level);
  const height = Math.max(0, Math.min(1, heightFraction));
  return (.25 + .75 * Math.sqrt(strength)) * (.65 + .35 * height);
}
