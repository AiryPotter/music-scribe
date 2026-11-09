// Audio worklet: copies raw microphone samples to the main thread in 4096-sample chunks.
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(4096);
    this.n = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'flush') {
        if (this.n) this.port.postMessage(this.buf.slice(0, this.n));
        this.n = 0;
        this.port.postMessage({ done: true });
      }
    };
  }

  process(inputs, outputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) {
          this.port.postMessage(this.buf.slice(0));
          this.n = 0;
        }
      }
    }
    // output stays silent
    const out = outputs[0] && outputs[0][0];
    if (out) out.fill(0);
    return true;
  }
}

registerProcessor('ms-capture', Capture);
