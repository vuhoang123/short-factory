export function playOneAudio(active: HTMLAudioElement) {
  active.ownerDocument.querySelectorAll('audio').forEach(audio => { if (audio !== active) audio.pause(); });
}
