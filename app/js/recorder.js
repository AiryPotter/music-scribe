// Holds the take in memory while you play, only so the accurate pass can read it.
// It is never saved, uploaded or exported; main.js discards it as soon as the notes are written.

export class Recorder {
  static async create(ctx, sourceNode) {
    await ctx.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url));
    const r = new Recorder();
    r.ctx = ctx;
    r.chunks = [];
    r.node = new AudioWorkletNode(ctx, 'ms-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: 'explicit',
    });
    r.mute = ctx.createGain();
    r.mute.gain.value = 0;
    r.node.port.onmessage = (e) => {
      if (e.data instanceof Float32Array) r.chunks.push(e.data);
      else if (e.data && e.data.done && r._resolveFlush) r._resolveFlush();
    };
    sourceNode.connect(r.node);
    r.node.connect(r.mute).connect(ctx.destination); // keeps the worklet running; silent
    r.source = sourceNode;
    r.startTime = ctx.currentTime;
    return r;
  }

  /** Stop recording; resolves to { samples: Float32Array, sampleRate, startTime }. */
  async stop() {
    const flushed = new Promise((res) => { this._resolveFlush = res; });
    this.node.port.postMessage('flush');
    await Promise.race([flushed, new Promise((res) => setTimeout(res, 500))]);
    try { this.source.disconnect(this.node); } catch { /* already gone */ }
    this.node.disconnect();
    this.mute.disconnect();
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const samples = new Float32Array(total);
    let off = 0;
    for (const c of this.chunks) { samples.set(c, off); off += c.length; }
    this.chunks = [];
    return { samples, sampleRate: this.ctx.sampleRate, startTime: this.startTime };
  }
}
