export const PAGE_SIZE = 48;

export const ROLES = [
  { key: "territory", label: "Territory" },
  { key: "unit", label: "Unit" },
  { key: "action", label: "Action" },
  { key: "ace", label: "Ace" },
  { key: "buster", label: "Buster" },
  { key: "shot", label: "Shot" },
] as const;

export type RoleKey = (typeof ROLES)[number]["key"];

export type Facets = {
  total: number;
  types: string[];
  rarities: string[];
  sets: string[];
  attributes: string[];
};

export type CardQuery = {
  q: string;
  type: string;
  rarity: string;
  set: string;
  attribute: string;
  roles: RoleKey[];
  page: number;
};

const ROLE_KEYS = new Set<string>(ROLES.map((role) => role.key));

function one(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim().slice(0, 200) ?? "";
}

function many(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function parseCardQuery(
  searchParams: Record<string, string | string[] | undefined>,
): CardQuery {
  const page = Number(one(searchParams.page));
  const roles = many(searchParams.role).filter((role): role is RoleKey =>
    ROLE_KEYS.has(role),
  );
  return {
    q: one(searchParams.q),
    type: one(searchParams.type),
    rarity: one(searchParams.rarity),
    set: one(searchParams.set),
    attribute: one(searchParams.attribute),
    roles,
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

export function toSearchParams(query: CardQuery, page = query.page): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.type) params.set("type", query.type);
  if (query.rarity) params.set("rarity", query.rarity);
  if (query.set) params.set("set", query.set);
  if (query.attribute) params.set("attribute", query.attribute);
  for (const role of query.roles) params.append("role", role);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

export function catalogNumber(cardId: number): string {
  return `#${String(cardId).padStart(4, "0")}`;
}
