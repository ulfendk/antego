/**
 * One AudioContext for the whole game (voice and sound effects). Browsers only allow audio
 * after a user gesture, so it's created on the first tap (see voice/reader.ts).
 */
let ctx: AudioContext | null = null;

export function unlockAudio(): AudioContext | null {
  if (!ctx) {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function audioContext(): AudioContext | null {
  return ctx;
}
