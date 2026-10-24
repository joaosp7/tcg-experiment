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

function where(query: CardQuery): { sql: string; params: Array<string | number> } {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (query.q) {
    const pattern = likePattern(query.q);
    const parts = [
      "name LIKE ? ESCAPE '\\'",
      "effect_text LIKE ? ESCAPE '\\'",
      "flavor_text LIKE ? ESCAPE '\\'",
      "illustrator LIKE ? ESCAPE '\\'",
    ];
    params.push(pattern, pattern, pattern, pattern);
    if (/^\d+$/.test(query.q) && query.q.length < 16) {
      parts.push("card_id = ?");
      params.push(Number(query.q));
    }
    clauses.push(`(${parts.join(" OR ")})`);
  }
  if (query.type) {
    clauses.push("card_type = ?");
    params.push(query.type);
  }
  if (query.rarity) {
    clauses.push("rarity = ?");
    params.push(query.rarity);
  }
  if (query.set) {
    clauses.push("set_name = ?");
    params.push(query.set);
  }
  if (query.attribute) {
    const escaped = query.attribute.replace(/[\\%_]/g, (char) => `\\${char}`);
    clauses.push(
      "(attributes = ? OR attributes LIKE ? ESCAPE '\\' OR attributes LIKE ? ESCAPE '\\' OR attributes LIKE ? ESCAPE '\\')",
    );
    params.push(query.attribute, `${escaped}/%`, `%/${escaped}`, `%/${escaped}/%`);
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
      `SELECT ${SUMMARY_COLUMNS.join(", ")} FROM cards ${filter.sql} ORDER BY card_id LIMIT ? OFFSET ?`,
    )
    .all(...filter.params, PAGE_SIZE, offset)
    .map(summary);

  return { cards, total, page, pageCount };
}

export function getCard(cardId: number): CardDetail | null {
  const row = getDb()
    .prepare(`SELECT ${DETAIL_COLUMNS.join(", ")} FROM cards WHERE card_id = ?`)
    .get(cardId);
  if (!row) return null;
  return {
    ...summary(row),
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
    .sort((a, b) => a.localeCompare(b, "ja"));

  const counts = new Map<string, number>();
  for (const row of db.prepare("SELECT attributes FROM cards WHERE attributes != ''").all()) {
    for (const token of text(row.attributes).split("/")) {
      if (!token) continue;
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  const attributes = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"))
    .map(([token]) => token);

  const facets = { total, types, rarities, sets, attributes };
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
