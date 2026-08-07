import Database from 'better-sqlite3';
import { statSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ponytail: one shared handle, RW because server actions write outcomes to the
// mock db; the real build swaps this for a Postgres pool behind the same call sites.
// seed.ts rmSync-recreates the file, so a long-running dev server's handle can go
// stale (SQLITE_IOERR on a deleted inode) — track the inode and reopen on change.
declare global {
  var __jhaveriDb: { conn: Database.Database; ino: bigint } | undefined;
}

const BUNDLED = join(process.cwd(), 'mockdb', 'jhaveri.db');

/**
 * A serverless filesystem is read-only apart from /tmp, and this prototype writes
 * — closing an action, launching a campaign, generating a pack. So on a deploy the
 * seeded database is copied to /tmp once per instance and opened there. Writes work
 * and are visible for the life of that instance, then reset on a cold start.
 * That is the honest behaviour for a review deployment: every button does the real
 * thing, and nobody's clicking permanently alters what the next reviewer sees.
 */
function resolvePath(): string {
  if (!process.env.VERCEL) return BUNDLED;
  const scratch = '/tmp/jhaveri.db';
  if (!existsSync(scratch)) copyFileSync(BUNDLED, scratch);
  return scratch;
}

export function db(): Database.Database {
  const path = resolvePath();
  const ino = statSync(path, { bigint: true }).ino;
  if (globalThis.__jhaveriDb && (!globalThis.__jhaveriDb.conn || globalThis.__jhaveriDb.ino !== ino)) {
    try {
      globalThis.__jhaveriDb.conn?.close();
    } catch {
      // stale handle from a replaced file or an older module shape — discard
    }
    globalThis.__jhaveriDb = undefined;
  }
  if (!globalThis.__jhaveriDb) {
    const conn = new Database(path);
    conn.pragma('journal_mode = WAL');
    globalThis.__jhaveriDb = { conn, ino };
  }
  return globalThis.__jhaveriDb.conn;
}
