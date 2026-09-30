/**
 * Output-safety helpers. Archived metadata and extracted text are untrusted.
 */

/** Allows only http(s) URLs (and same-origin relative paths). Anything else becomes null. */
export function safeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
  try {
    const u = new URL(trimmed);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Hostname for display, e.g. "www.utah.gov". */
export function displayHost(raw: string | null | undefined): string | null {
  const url = safeUrl(raw);
  if (!url || url.startsWith('/')) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** Sanitizes a file name used for downloads: no paths, control chars, or reserved characters. */
export function safeFileName(name: string | null | undefined, fallback = 'document'): string {
  const base = (name ?? '')
    .split(/[\\/]/)
    .pop()!
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"|?*]+/g, '')
    .replace(/^\.+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150);
  return base || fallback;
}

/** Strips control/bidi-override characters that can visually spoof text. */
export function cleanText(s: string | null | undefined): string {
  // eslint-disable-next-line no-control-regex
  return (s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g, '');
}
