// Records a MediaStream to a 16kHz mono WAV (what whisper.cpp wants).
// ponytail: ScriptProcessor is deprecated but still works in Electron; swap for AudioWorklet if it's removed.
export function recordWav(stream: MediaStream) {
  const ctx = new AudioContext({ sampleRate: 16000 })
  const src = ctx.createMediaStreamSource(stream)
  const proc = ctx.createScriptProcessor(4096, 1, 1)
  const chunks: Float32Array[] = []
  proc.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)))
  src.connect(proc)
  proc.connect(ctx.destination) // output is silent (we never write to it)

  return async (): Promise<ArrayBuffer> => {
    proc.disconnect()
    src.disconnect()
    stream.getTracks().forEach((t) => t.stop())
    await ctx.close()
    const n = chunks.reduce((a, c) => a + c.length, 0)
    const buf = new ArrayBuffer(44 + n * 2)
    const v = new DataView(buf)
    const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt ')
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
    v.setUint32(24, 16000, true); v.setUint32(28, 32000, true)
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true)
    let o = 44
    for (const c of chunks) for (let i = 0; i < c.length; i++, o += 2) v.setInt16(o, Math.max(-1, Math.min(1, c[i])) * 0x7fff, true)
    return buf
  }
}

// System audio (the interviewer, via Zoom output) through Electron's loopback; Zoom keeps playing normally.
export async function getSystemAudio() {
  await window.electronAPI.enableLoopbackAudio()
  try {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
    s.getVideoTracks().forEach((t) => { t.stop(); s.removeTrack(t) })
    return s
  } finally {
    await window.electronAPI.disableLoopbackAudio()
  }
}

export const getMic = () =>
  navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
