import Database from 'better-sqlite3';
import { statSync } from 'node:fs';
import { join } from 'node:path';

// ponytail: one shared handle, RW because server actions write outcomes to the
// mock db; the real build swaps this for a Postgres pool behind the same call sites.
// seed.ts rmSync-recreates the file, so a long-running dev server's handle can go
// stale (SQLITE_IOERR on a deleted inode) — track the inode and reopen on change.
declare global {
  var __jhaveriDb: { conn: Database.Database; ino: bigint } | undefined;
}

const DB_PATH = join(process.cwd(), 'mockdb', 'jhaveri.db');

export function db(): Database.Database {
  const ino = statSync(DB_PATH, { bigint: true }).ino;
  if (globalThis.__jhaveriDb && (!globalThis.__jhaveriDb.conn || globalThis.__jhaveriDb.ino !== ino)) {
    try {
      globalThis.__jhaveriDb.conn?.close();
    } catch {
      // stale handle from a replaced file or an older module shape — discard
    }
    globalThis.__jhaveriDb = undefined;
  }
  if (!globalThis.__jhaveriDb) {
    const conn = new Database(DB_PATH);
    conn.pragma('journal_mode = WAL');
    globalThis.__jhaveriDb = { conn, ino };
  }
  return globalThis.__jhaveriDb.conn;
}
