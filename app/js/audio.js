// Microphone access: list inputs, open one with phone "call" processing turned off.

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
  if (ctx.state === 'suspended') await ctx.resume();
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
