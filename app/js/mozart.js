// Little Mozart mascot: switches CSS animation states on the inline SVG.
// States: idle | listening | scribbling | squint | bow | asleep

const BUBBLES = {
  idle: '',
  listening: '♪?',
  scribbling: '',
  squint: 'Hm…',
  bow: 'Bravo!',
  asleep: 'z z',
};

export class Mozart {
  constructor(svg) {
    this.svg = svg;
    this.text = svg.querySelector('#bubbleText');
    this.state = null;
    Object.keys(BUBBLES).forEach((s) => svg?.classList.remove(s));
    this.set('asleep');
  }

  /** Show custom text in the speech bubble ('' hides it). */
  say(text) {
    this.svg.classList.toggle('has-bubble', !!text);
    if (this.text) this.text.textContent = text;
  }

  set(state) {
    if (state === this.state || !this.svg) return;
    this.svg.classList.remove(this.state);
    this.svg.classList.add(state);
    this.state = state;
    const bubble = BUBBLES[state] || '';
    this.svg.classList.toggle('has-bubble', !!bubble);
    if (this.text) this.text.textContent = bubble;
  }
}
