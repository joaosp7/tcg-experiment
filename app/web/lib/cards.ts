import type { SQLOutputValue } from "node:sqlite";
import { getDb } from "@/lib/db";
import { PAGE_SIZE, ROLES, type CardQuery, type Facets, type RoleKey } from "@/lib/query";

const ROLE_COLUMNS: Record<RoleKey, string> = {
  territory: "is_territory",
  unit: "is_unit",
  action: "is_action",
  ace: "is_ace",
  buster: "is_buster",
  shot: "is_shot",
};

const SUMMARY_COLUMNS = [
  "card_id",
  "name",
  "card_type",
  "attributes",
  "cost",
  "rarity",
  "image_url",
  "set_name",
] as const;

const DETAIL_COLUMNS = [
  ...SUMMARY_COLUMNS,
  "effect_text",
  "flavor_text",
  "power",
  "hit",
  "illustrator",
  "back_image_url",
  "is_territory",
  "is_unit",
  "is_action",
  "is_ace",
  "is_buster",
  "is_shot",
  "official_url",
] as const;

const TRANSLATABLE = ["name", "card_type", "attributes", "cost", "set_name", "effect_text", "flavor_text"] as const;
type Translatable = (typeof TRANSLATABLE)[number];

let availableColumns: Set<string> | undefined;

function hasEnglish(field: string): boolean {
  availableColumns ??= new Set(
    getDb().prepare("PRAGMA table_info(cards)").all().map((row) => text(row.name)),
  );
  return availableColumns.has(`${field}_en`);
}

function localizedColumn(field: string): string {
  return hasEnglish(field) ? `COALESCE(NULLIF(TRIM(${field}_en), ''), ${field}) AS ${field}` : field;
}

function selectColumns(columns: readonly string[]): string {
  return columns.map((field) => TRANSLATABLE.includes(field as Translatable) ? localizedColumn(field) : field).join(", ");
}

export type CardSummary = {
  card_id: number;
  name: string;
  card_type: string;
  attributes: string;
  cost: string;
  rarity: string;
  image_url: string;
  set_name: string;
};

export type CardDetail = CardSummary & {
  japanese: Record<Translatable, string>;
  hasTranslation: boolean;
  effect_text: string;
  flavor_text: string;
  power: string;
  hit: string;
  illustrator: string;
  back_image_url: string;
  is_territory: number;
  is_unit: number;
  is_action: number;
  is_ace: number;
  is_buster: number;
  is_shot: number;
  official_url: string;
};

export type CardPage = {
  cards: CardSummary[];
  total: number;
  page: number;
  pageCount: number;
};

const RARITY_ORDER = [
  "N",
  "R",
  "R+",
  "RR",
  "SR",
  "SR+",
  "SSR",
  "UR",
  "BR",
  "BT",
  "PR",
  "PR+",
  "SC",
  "SD",
  "SD+",
  "MT",
];

const globalForFacets = globalThis as unknown as { cardFacets?: Facets };

function text(value: SQLOutputValue | undefined): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return "";
}

function num(value: SQLOutputValue | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  return 0;
}

function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function filterValues(value: string, labels: Record<string, string>): string[] {
  const normalized = value.toLocaleLowerCase("en");
  return [...new Set([
    value,
    ...Object.entries(labels)
      .filter(([, label]) => label.toLocaleLowerCase("en") === normalized)
      .map(([original]) => original),
  ])];
}

function where(query: CardQuery): { sql: string; params: Array<string | number> } {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (query.q) {
    const pattern = likePattern(query.q);
    const parts: string[] = [];
    for (const field of [...TRANSLATABLE, "illustrator"]) {
      parts.push(`${field} LIKE ? ESCAPE '\\'`);
      params.push(pattern);
      if (hasEnglish(field)) {
        parts.push(`${field}_en LIKE ? ESCAPE '\\'`);
        params.push(pattern);
      }
    }
    if (/^\d+$/.test(query.q) && query.q.length < 16) {
      parts.push("card_id = ?");
      params.push(Number(query.q));
    }
    clauses.push(`(${parts.join(" OR ")})`);
  }
  function exactFilter(field: string, value: string, labels: Record<string, string>) {
    const values = filterValues(value, labels);
    const placeholders = values.map(() => "?").join(", ");
    const columns = hasEnglish(field) ? [field, `${field}_en`] : [field];
    clauses.push(`(${columns.map((column) => `${column} IN (${placeholders})`).join(" OR ")})`);
    columns.forEach(() => params.push(...values));
  }
  if (query.type) {
    exactFilter("card_type", query.type, getFacets().typeLabels);
  }
  if (query.rarity) {
    clauses.push("rarity = ?");
    params.push(query.rarity);
  }
  if (query.set) {
    exactFilter("set_name", query.set, getFacets().setLabels);
  }
  if (query.attribute) {
    const parts: string[] = [];
    const columns = hasEnglish("attributes") ? ["attributes", "attributes_en"] : ["attributes"];
    for (const value of filterValues(query.attribute, getFacets().attributeLabels)) {
      const escaped = value.replace(/[\\%_]/g, (char) => `\\${char}`);
      for (const column of columns) {
        parts.push(`(${column} = ? OR ${column} LIKE ? ESCAPE '\\' OR ${column} LIKE ? ESCAPE '\\' OR ${column} LIKE ? ESCAPE '\\')`);
        params.push(value, `${escaped}/%`, `%/${escaped}`, `%/${escaped}/%`);
      }
    }
    clauses.push(`(${parts.join(" OR ")})`);
  }
  for (const role of query.roles) {
    clauses.push(`${ROLE_COLUMNS[role]} = 1`);
  }

  return {
    sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

function summary(row: Record<string, SQLOutputValue>): CardSummary {
  return {
    card_id: num(row.card_id),
    name: text(row.name),
    card_type: text(row.card_type),
    attributes: text(row.attributes),
    cost: text(row.cost),
    rarity: text(row.rarity),
    image_url: text(row.image_url),
    set_name: text(row.set_name),
  };
}

export function searchCards(query: CardQuery): CardPage {
  const db = getDb();
  const filter = where(query);
  const total = num(
    db.prepare(`SELECT COUNT(*) AS total FROM cards ${filter.sql}`).get(...filter.params)?.total,
  );
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = query.page;
  const offset = (page - 1) * PAGE_SIZE;
  const cards = db
    .prepare(
      `SELECT ${selectColumns(SUMMARY_COLUMNS)} FROM cards ${filter.sql} ORDER BY card_id LIMIT ? OFFSET ?`,
    )
    .all(...filter.params, PAGE_SIZE, offset)
    .map(summary);

  return { cards, total, page, pageCount };
}

export function getCard(cardId: number): CardDetail | null {
  const row = getDb()
    .prepare(`SELECT ${selectColumns(DETAIL_COLUMNS)}, ${TRANSLATABLE.map((f) => `${f} AS ${f}_ja`).join(", ")} FROM cards WHERE card_id = ?`)
    .get(cardId);
  if (!row) return null;
  return {
    ...summary(row),
    japanese: Object.fromEntries(TRANSLATABLE.map((field) => [field, text(row[`${field}_ja`])])) as Record<Translatable, string>,
    hasTranslation: TRANSLATABLE.some((field) => text(row[field]) !== text(row[`${field}_ja`])),
    effect_text: text(row.effect_text),
    flavor_text: text(row.flavor_text),
    power: text(row.power),
    hit: text(row.hit),
    illustrator: text(row.illustrator),
    back_image_url: text(row.back_image_url),
    is_territory: num(row.is_territory),
    is_unit: num(row.is_unit),
    is_action: num(row.is_action),
    is_ace: num(row.is_ace),
    is_buster: num(row.is_buster),
    is_shot: num(row.is_shot),
    official_url: text(row.official_url),
  };
}

export function getFacets(): Facets {
  if (globalForFacets.cardFacets) return globalForFacets.cardFacets;

  const db = getDb();
  const total = num(db.prepare("SELECT COUNT(*) AS total FROM cards").get()?.total);
  const types = db
    .prepare(
      "SELECT card_type AS value, COUNT(*) AS n FROM cards GROUP BY card_type ORDER BY n DESC, value",
    )
    .all()
    .map((row) => text(row.value))
    .filter(Boolean);
  const typeLabels: Record<string, string> = {};
  const setLabels: Record<string, string> = {};
  const attributeLabels: Record<string, string> = {};
  for (const row of db.prepare(`SELECT card_type AS original, ${localizedColumn("card_type")} FROM cards ORDER BY card_id`).all()) {
    if (!typeLabels[text(row.original)] || text(row.card_type) !== text(row.original)) {
      typeLabels[text(row.original)] = text(row.card_type);
    }
  }
  for (const row of db.prepare(`SELECT set_name AS original, ${localizedColumn("set_name")} FROM cards ORDER BY card_id`).all()) {
    if (!setLabels[text(row.original)] || text(row.set_name) !== text(row.original)) {
      setLabels[text(row.original)] = text(row.set_name);
    }
  }
  const rarityRows = db
    .prepare("SELECT DISTINCT rarity AS value FROM cards WHERE rarity != ''")
    .all()
    .map((row) => text(row.value));
  const rarities = [...rarityRows].sort((a, b) => {
    const ai = RARITY_ORDER.indexOf(a);
    const bi = RARITY_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  const sets = db
    .prepare("SELECT DISTINCT set_name AS value FROM cards WHERE set_name != ''")
    .all()
    .map((row) => text(row.value))
    .sort((a, b) => (setLabels[a] || a).localeCompare(setLabels[b] || b, "en"));

  const counts = new Map<string, number>();
  for (const row of db.prepare(`SELECT attributes AS original, ${localizedColumn("attributes")} FROM cards WHERE attributes != '' ORDER BY card_id`).all()) {
    const translated = text(row.attributes).split("/");
    for (const [index, token] of text(row.original).split("/").entries()) {
      if (!token) continue;
      counts.set(token, (counts.get(token) ?? 0) + 1);
      if (!attributeLabels[token] || translated[index] !== token) {
        attributeLabels[token] = translated[index] || token;
      }
    }
  }
  const attributes = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (attributeLabels[a[0]] || a[0]).localeCompare(attributeLabels[b[0]] || b[0], "en"))
    .map(([token]) => token);

  const facets = { total, types, rarities, sets, attributes, typeLabels, setLabels, attributeLabels };
  globalForFacets.cardFacets = facets;
  return facets;
}

export function roleLabels(card: CardDetail): string[] {
  const flags: Record<RoleKey, number> = {
    territory: card.is_territory,
    unit: card.is_unit,
    action: card.is_action,
    ace: card.is_ace,
    buster: card.is_buster,
    shot: card.is_shot,
  };
  return ROLES.filter((role) => flags[role.key] === 1).map((role) => role.label);
}
