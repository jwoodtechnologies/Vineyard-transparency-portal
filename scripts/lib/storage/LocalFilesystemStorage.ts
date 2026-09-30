/** StorageProvider backed by a local directory (default: data/archive/files). */
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertSafeKey } from './keys';
import type { StoredObject, StorageProvider } from './StorageProvider';

export class LocalFilesystemStorage implements StorageProvider {
  readonly id = 'local-filesystem';
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = path.resolve(rootDir);
  }

  /** Resolve a key to a path, refusing anything that escapes the root directory. */
  private resolve(key: string): string {
    assertSafeKey(key);
    const full = path.resolve(this.root, ...key.split('/'));
    if (!full.startsWith(this.root + path.sep)) throw new Error(`Storage key escapes archive root: ${key}`);
    return full;
  }

  describe(key: string): string {
    return this.resolve(key);
  }

  async stat(key: string): Promise<{ size: number } | null> {
    try {
      const s = await stat(this.resolve(key));
      return s.isFile() ? { size: s.size } : null;
    } catch {
      return null;
    }
  }

  async put(key: string, data: Uint8Array, meta?: { contentType: string }): Promise<StoredObject> {
    // The filesystem does not keep a content type; the served type comes from the archive record.
    void meta;
    const full = this.resolve(key);
    const existing = await this.stat(key);
    if (existing && existing.size === data.byteLength) {
      return { key, size: existing.size, location: full };
    }
    if (existing) {
      // Content-addressed keys make this impossible unless the file was tampered with.
      throw new Error(`Refusing to overwrite ${key}: existing file has a different size (${existing.size} vs ${data.byteLength}). Run validate-archive.`);
    }
    await mkdir(path.dirname(full), { recursive: true });
    const tmp = `${full}.partial-${process.pid}`;
    await writeFile(tmp, data, { mode: 0o644 });
    await rename(tmp, full);
    return { key, size: data.byteLength, location: full };
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.resolve(key)));
    } catch {
      return null;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const out: string[] = [];
    const start = prefix ? this.resolve(prefix.replace(/\/+$/, '')) : this.root;
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.isFile() && !entry.name.includes('.partial-')) out.push(path.relative(this.root, full).split(path.sep).join('/'));
      }
    };
    await walk(start);
    return out.sort();
  }
}
