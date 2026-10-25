import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const query = { q: "", type: "", rarity: "", set: "", attribute: "", roles: [], page: 1 };
const translatedFields = ["name", "card_type", "attributes", "effect_text", "flavor_text", "cost", "set_name"];

async function withArchive(english, check) {
  const folder = mkdtempSync(path.join(tmpdir(), "build-divide-cards-"));
  const previousCwd = process.cwd();
  mkdirSync(path.join(folder, "data"));
  const db = new DatabaseSync(path.join(folder, "data/cards.db"));
  try {
    db.exec(`CREATE TABLE cards (
      card_id INTEGER PRIMARY KEY, name TEXT, card_type TEXT, attributes TEXT,
      effect_text TEXT, flavor_text TEXT, cost TEXT, set_name TEXT,
      rarity TEXT DEFAULT 'N', image_url TEXT DEFAULT '', back_image_url TEXT DEFAULT '',
      power TEXT DEFAULT '1000', hit TEXT DEFAULT '1', illustrator TEXT DEFAULT '',
      official_url TEXT DEFAULT '', is_territory INTEGER DEFAULT 0,
      is_unit INTEGER DEFAULT 1, is_action INTEGER DEFAULT 0, is_ace INTEGER DEFAULT 0,
      is_buster INTEGER DEFAULT 0, is_shot INTEGER DEFAULT 0
    )`);
    if (english) {
      for (const field of translatedFields) db.exec(`ALTER TABLE cards ADD COLUMN ${field}_en TEXT`);
    }
    const insert = db.prepare("INSERT INTO cards(card_id,name,card_type,attributes,effect_text,flavor_text,cost,set_name) VALUES(?,?,?,?,?,?,?,?)");
    insert.run(1, "日本の名前", "ユニット", "人間/魔族", "１枚引く", "物語", "(黒1)", "日本セット");
    insert.run(2, "未訳の名前", "ユニット", "人間", "２枚引く", "別の物語", "(無2)", "日本セット");
    insert.run(3, "別名%_", "コマンド", "ヒト/機械", "別の効果", "三つ目の物語", "(赤3)", "別セット");
    if (english) {
      db.prepare(`UPDATE cards SET name_en=?,card_type_en=?,attributes_en=?,effect_text_en=?,flavor_text_en=?,cost_en=?,set_name_en=? WHERE card_id=1`)
        .run("Translated Name", "Unit", "Human/Demon", "Draw 1 card.", "A short story.", "(Black 1)", "Starter Set");
      db.prepare("UPDATE cards SET name_en='   ',effect_text_en='',flavor_text_en='  ' WHERE card_id=2").run();
      db.prepare("UPDATE cards SET card_type_en='Command',attributes_en='Human/Machine',set_name_en='Other Set' WHERE card_id=3").run();
    }
    // Execute the real query module against an isolated SQLite fixture; resolve Next's aliases locally.
    for (const name of ["db", "query", "cards"]) {
      const source = readFileSync(path.join(webRoot, "lib", `${name}.ts`), "utf8")
        .replaceAll('"@/lib/db"', '"./db.mjs"')
        .replaceAll('"@/lib/query"', '"./query.mjs"');
      writeFileSync(path.join(folder, `${name}.mjs`), stripTypeScriptTypes(source));
    }
    process.chdir(folder);
    delete globalThis.cardsDb;
    delete globalThis.cardFacets;
    const cards = await import(pathToFileURL(path.join(folder, "cards.mjs")).href);
    const queries = await import(pathToFileURL(path.join(folder, "query.mjs")).href);
    await check(cards, queries);
  } finally {
    globalThis.cardsDb?.close();
    delete globalThis.cardsDb;
    delete globalThis.cardFacets;
    db.close();
    process.chdir(previousCwd);
    rmSync(folder, { recursive: true, force: true });
  }
}

test("English is displayed by default while the Japanese originals remain available", async () => {
  await withArchive(true, ({ getCard, searchCards }) => {
    const card = getCard(1);
    assert.equal(card.name, "Translated Name");
    assert.equal(card.card_type, "Unit");
    assert.equal(card.attributes, "Human/Demon");
    assert.equal(card.effect_text, "Draw 1 card.");
    assert.equal(card.flavor_text, "A short story.");
    assert.equal(card.cost, "(Black 1)");
    assert.equal(card.set_name, "Starter Set");
    assert.equal(card.japanese.name, "日本の名前");
    assert.equal(card.hasTranslation, true);
    assert.equal(searchCards(query).cards[0].name, "Translated Name");
  });
});

test("null, empty and whitespace translations fall back independently to Japanese", async () => {
  await withArchive(true, ({ getCard }) => {
    const card = getCard(2);
    assert.equal(card.name, "未訳の名前");
    assert.equal(card.card_type, "ユニット");
    assert.equal(card.effect_text, "２枚引く");
    assert.equal(card.flavor_text, "別の物語");
    assert.equal(card.hasTranslation, false);
  });
});

test("search finds Japanese and English across all translated fields", async () => {
  await withArchive(true, ({ searchCards }) => {
    for (const value of ["Translated Name", "日本の名前", "Draw 1 card.", "A short story.", "Unit", "Human", "Starter Set", "Black 1"]) {
      assert(searchCards({ ...query, q: value }).cards.some((card) => card.card_id === 1), value);
    }
  });
});

test("English type and set filters include untranslated cards with the same Japanese value", async () => {
  await withArchive(true, ({ searchCards }) => {
    for (const type of ["Unit", "unit", "ユニット"]) assert.equal(searchCards({ ...query, type }).total, 2);
    for (const set of ["Starter Set", "日本セット"]) assert.equal(searchCards({ ...query, set }).total, 2);
    assert.equal(searchCards({ ...query, type: "Unit", set: "Other Set" }).total, 0);
  });
});

test("attribute filters match whole tokens and all originals sharing an English label", async () => {
  await withArchive(true, ({ searchCards }) => {
    assert.equal(searchCards({ ...query, attribute: "Human" }).total, 3);
    assert.equal(searchCards({ ...query, attribute: "人間" }).total, 2);
    assert.equal(searchCards({ ...query, attribute: "Demon" }).total, 1);
    assert.equal(searchCards({ ...query, attribute: "Hum" }).total, 0);
    assert.equal(searchCards({ ...query, type: "Unit", attribute: "Machine" }).total, 0);
  });
});

test("filter labels prefer English, retain stable Japanese values and accept English URLs", async () => {
  await withArchive(true, ({ getFacets }, { facetValue }) => {
    const facets = getFacets();
    assert.equal(facets.typeLabels["ユニット"], "Unit");
    assert.equal(facets.setLabels["日本セット"], "Starter Set");
    assert.equal(facets.attributeLabels["人間"], "Human");
    assert.equal(facetValue("Unit", facets.typeLabels), "ユニット");
    assert.equal(facetValue("starter set", facets.setLabels), "日本セット");
    assert.equal(facetValue("Human", facets.attributeLabels), "Human");
    assert.equal(facetValue("unknown", facets.typeLabels), "unknown");
  });
});

test("literal search characters and filter values cannot broaden SQL queries", async () => {
  await withArchive(true, ({ searchCards }) => {
    assert.equal(searchCards({ ...query, q: "%_" }).total, 1);
    assert.equal(searchCards({ ...query, q: "' OR 1=1 --" }).total, 0);
    assert.equal(searchCards({ ...query, type: "Unit' OR 1=1 --" }).total, 0);
    assert.equal(searchCards({ ...query, attribute: "%" }).total, 0);
  });
});

test("databases without English columns still support display, search and filters", async () => {
  await withArchive(false, ({ getCard, getFacets, searchCards }) => {
    assert.equal(getCard(1).name, "日本の名前");
    assert.equal(getCard(1).hasTranslation, false);
    assert.equal(getFacets().typeLabels["ユニット"], "ユニット");
    assert.equal(searchCards({ ...query, type: "ユニット", attribute: "人間" }).total, 2);
    assert.equal(searchCards({ ...query, q: "日本の名前" }).total, 1);
  });
});

test("deck lookups return current summaries, omit missing cards and validate IDs", async () => {
  await withArchive(true, ({ getCardsByIds }) => {
    assert.deepEqual(getCardsByIds([]), []);
    const cards = getCardsByIds([2, 1, 1, 999]);
    assert.deepEqual(cards.map((card) => card.card_id), [1, 2]);
    assert.equal(cards[0].name, "Translated Name");
    for (const ids of [[-1], [1.2], [NaN], Array.from({ length: 201 }, (_, i) => i + 1)]) {
      assert.throws(() => getCardsByIds(ids));
    }
  });
});
