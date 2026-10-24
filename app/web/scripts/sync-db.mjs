import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { backup, DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dest = path.join(webRoot, "data", "cards.db");
const source = path.resolve(webRoot, "../../data/cards.db");

if (existsSync(source)) {
  mkdirSync(path.dirname(dest), { recursive: true });
  const temporary = `${dest}.${process.pid}.tmp`;
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    await backup(db, temporary);
    const snapshot = new DatabaseSync(temporary);
    try {
      snapshot.prepare("PRAGMA journal_mode=DELETE").get();
    } finally {
      snapshot.close();
    }
    // Run before starting the app, so no reader keeps the old database open.
    rmSync(`${dest}-wal`, { force: true });
    rmSync(`${dest}-shm`, { force: true });
    renameSync(temporary, dest);
  } finally {
    db.close();
    rmSync(temporary, { force: true });
    rmSync(`${temporary}-wal`, { force: true });
    rmSync(`${temporary}-shm`, { force: true });
  }
  console.log(`synced ${source} -> ${dest}`);
} else if (existsSync(dest)) {
  console.log(`using bundled ${dest}`);
} else {
  console.error("cards.db not found. Run the scraper, or commit app/web/data/cards.db.");
  process.exit(1);
}
