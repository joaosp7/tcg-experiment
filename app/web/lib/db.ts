import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const globalForDb = globalThis as unknown as { cardsDb?: DatabaseSync };

export function getDb(): DatabaseSync {
  if (!globalForDb.cardsDb) {
    const file = path.join(process.cwd(), "data", "cards.db");
    globalForDb.cardsDb = new DatabaseSync(file, { readOnly: true });
  }
  return globalForDb.cardsDb;
}
