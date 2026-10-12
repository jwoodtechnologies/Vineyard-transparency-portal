// node:sqlite and node:crypto, as far as the test helpers use them (the tests run in Node; the Worker types have no Node modules).
declare module 'node:sqlite' {
  export interface StatementSync {
    all(...params: unknown[]): Record<string, unknown>[];
    get(...params: unknown[]): Record<string, unknown> | undefined;
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  }
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
  }
}

declare module 'node:crypto' {
  export function createHash(algorithm: 'sha256'): { update(data: string): { digest(): Uint8Array } };
}
