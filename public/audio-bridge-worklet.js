/** Interleave master L/R and cue L/R as one packet; never render to browser speakers. */
class LoudAudioBridge extends AudioWorkletProcessor {
  constructor() { super(); this.packet = new Float32Array(512 * 4); this.frames = 0; this.enabled = false;
    this.port.onmessage = event => { this.enabled = event.data === 'start'; this.frames = 0; };
  }
  process(inputs, outputs) {
    for (const output of outputs) for (const channel of output) channel.fill(0);
    if (!this.enabled) return true;
    const input = inputs[0] || [];
    const frames = outputs[0]?.[0]?.length || 128;
    for (let frame = 0; frame < frames; frame++) {
      for (let ch = 0; ch < 4; ch++) this.packet[this.frames * 4 + ch] = input[ch]?.[frame] || 0;
      if (++this.frames === 512) {
        this.port.postMessage(this.packet.buffer, [this.packet.buffer]);
        this.packet = new Float32Array(512 * 4); this.frames = 0;
      }
    }
    return true;
  }
}
registerProcessor('loud-audio-bridge', LoudAudioBridge);
