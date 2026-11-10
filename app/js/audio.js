// Microphone access: list inputs, open one with phone "call" processing turned off.

/** iPhone / iPad (iPadOS reports itself as a Mac, so also check for touch). */
export const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Running as an installed home-screen app (not in a browser tab). */
export const IS_STANDALONE = navigator.standalone === true
  || window.matchMedia?.('(display-mode: standalone)').matches === true;

/**
 * Safari (iOS 16.4+): tell the phone what kind of audio this is.
 * 'playback' = plays even with the ring/silent switch on (hearing notes while editing);
 * 'play-and-record' = mic and loudspeaker together (recording with the click).
 * Does nothing in browsers without the Audio Session API.
 */
export function setAudioSession(type) {
  try {
    if (navigator.audioSession && navigator.audioSession.type !== type) navigator.audioSession.type = type;
  } catch { /* not supported */ }
}

/** Resume an AudioContext without hanging if the browser wants a tap first (iPhone). */
export async function wake(ctx) {
  if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return;
  try { await Promise.race([ctx.resume(), new Promise((res) => setTimeout(res, 400))]); } catch { /* needs a tap */ }
}

export async function listMics() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'audioinput');
}

const RAW_AUDIO = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
};

async function getStream(deviceId) {
  const audio = { ...RAW_AUDIO };
  if (deviceId) audio.deviceId = { exact: deviceId };
  return navigator.mediaDevices.getUserMedia({ audio });
}

/**
 * Open a microphone. Falls back to the default mic if the chosen one is gone.
 * Returns { ctx, stream, analyser, deviceId, label, close() }.
 */
export async function openMic(deviceId) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser cannot use the microphone here. On a phone it needs HTTPS (or localhost).');
  }
  setAudioSession('play-and-record');
  let stream;
  try {
    stream = await getStream(deviceId);
  } catch (err) {
    if (deviceId && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
      stream = await getStream('');
    } else {
      throw err;
    }
  }

  const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  await wake(ctx); // if the iPhone still wants a tap, main.js resumes it on the next touch
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 4096; // ~85 ms window at 48 kHz: enough for low E (82 Hz)
  analyser.smoothingTimeConstant = 0;
  source.connect(analyser);

  const track = stream.getAudioTracks()[0];
  const settings = track?.getSettings?.() || {};

  return {
    ctx,
    stream,
    analyser,
    source,
    deviceId: settings.deviceId || deviceId || '',
    label: track?.label || 'Microphone',
    close() {
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
    },
  };
}

/** True if a mic label looks like a Bluetooth headset (laggy, low quality). */
export function looksBluetooth(label = '') {
  return /bluetooth|hands-?free|airpods|buds|headset \(bt|bt\b/i.test(label);
}
