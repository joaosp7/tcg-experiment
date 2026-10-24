import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dest = path.join(webRoot, "data", "cards.db");
const source = path.resolve(webRoot, "../../data/cards.db");

if (existsSync(source)) {
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(source, dest);
  const db = new DatabaseSync(dest);
  db.prepare("PRAGMA journal_mode=DELETE").get();
  db.close();
  rmSync(`${dest}-wal`, { force: true });
  rmSync(`${dest}-shm`, { force: true });
  console.log(`synced ${source} -> ${dest}`);
} else if (existsSync(dest)) {
  console.log(`using bundled ${dest}`);
} else {
  console.error("cards.db not found. Run the scraper, or commit app/web/data/cards.db.");
  process.exit(1);
}
