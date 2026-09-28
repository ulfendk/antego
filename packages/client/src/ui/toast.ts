let host: HTMLElement | null = null;

/** Small, non-blocking message at the top of the screen. */
export function toast(text: string, ms = 3500) {
  if (!host) {
    host = document.createElement('div');
    host.className = 'toasts';
    document.body.append(host);
  }
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  host.append(el);
  setTimeout(() => el.classList.add('out'), ms);
  setTimeout(() => el.remove(), ms + 400);
}
