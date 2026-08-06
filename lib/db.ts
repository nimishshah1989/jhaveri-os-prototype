import Database from 'better-sqlite3';
import { join } from 'node:path';

// ponytail: one shared handle, RW because server actions write outcomes to the
// mock db; the real build swaps this for a Postgres pool behind the same call sites.
declare global {
  var __jhaveriDb: Database.Database | undefined;
}

export function db(): Database.Database {
  if (!globalThis.__jhaveriDb) {
    globalThis.__jhaveriDb = new Database(join(process.cwd(), 'mockdb', 'jhaveri.db'));
    globalThis.__jhaveriDb.pragma('journal_mode = WAL');
  }
  return globalThis.__jhaveriDb;
}
