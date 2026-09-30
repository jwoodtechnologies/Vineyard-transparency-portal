/**
 * Safe file names and storage keys.
 *
 * File names come from untrusted sources (URL paths, Content-Disposition headers, link text), so
 * they are reduced to a conservative character set before they are ever used on disk or as an
 * object key. Keys are validated again by every StorageProvider (defence in depth against path
 * traversal: "..", absolute paths, backslashes, NUL, control characters).
 */

const MAX_FILE_NAME = 120;

/** Reduce an untrusted file name to [A-Za-z0-9._-], preserving a short extension. */
export function sanitizeFileName(input: string | null | undefined, fallback = 'document'): string {
  let name = (input ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  name = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\u0000-\u001f\u007f]/g, '');
  const extMatch = /\.([A-Za-z0-9]{1,5})$/.exec(name);
  const ext = extMatch ? `.${extMatch[1].toLowerCase()}` : '';
  let stem = extMatch ? name.slice(0, -extMatch[0].length) : name;
  stem = stem.replace(/\s+/g, '_').replace(/[^A-Za-z0-9._-]/g, '_').replace(/_+/g, '_');
  stem = stem.replace(/\.{2,}/g, '.').replace(/^[._-]+/, '').replace(/[._-]+$/, '');
  if (!stem) stem = fallback;
  if (stem.length + ext.length > MAX_FILE_NAME) stem = stem.slice(0, MAX_FILE_NAME - ext.length);
  return `${stem}${ext}`;
}

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/]*$/;

export function isSafeKey(key: string): boolean {
  if (!key || key.length > 512 || !KEY_RE.test(key)) return false;
  if (key.includes('//')) return false;
  return key.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

export function assertSafeKey(key: string): void {
  if (!isSafeKey(key)) throw new Error(`Unsafe storage key rejected: ${JSON.stringify(key)}`);
}

/** Content-addressed key for a stored file. */
export function contentKey(sha256: string, fileName: string): string {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('contentKey requires a hex SHA-256');
  const key = `documents/${sha256.slice(0, 2)}/${sha256}/${sanitizeFileName(fileName)}`;
  assertSafeKey(key);
  return key;
}

/** Parse a filename from a Content-Disposition header (RFC 6266 filename* preferred). */
export function fileNameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    } catch {
      /* fall through */
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(header);
  return plain ? (plain[2] ?? plain[1]).trim() : null;
}
