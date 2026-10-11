/** True when the address answers with a PDF (its first bytes), without following a redirect off the portal. */
export async function probePdf(url: string, sameOrigin: boolean): Promise<boolean> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20_000);
  try {
    const r = await fetch(url, { headers: { range: 'bytes=0-2047' }, redirect: sameOrigin ? 'manual' : 'follow', mode: sameOrigin ? 'same-origin' : 'cors', credentials: 'omit', signal: ctl.signal });
    if (r.status !== 200 && r.status !== 206) return false;
    const reader = r.body?.getReader();
    if (!reader) return false;
    let head = '';
    while (head.length < 1024) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      head += new TextDecoder('latin1').decode(value.slice(0, 2048));
    }
    void reader.cancel().catch(() => undefined);
    return head.includes('%PDF');
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
