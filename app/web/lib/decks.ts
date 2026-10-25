export const DECK_STORAGE_KEY = "script-leo:decks:v1";

export type Deck = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  cards: Array<{ cardId: number; quantity: number }>;
};

export type DeckStorage = { version: 1; decks: Deck[] };
export type DeckAction =
  | { type: "create"; id: string; name: string }
  | { type: "rename"; id: string; name: string }
  | { type: "delete"; id: string }
  | { type: "add"; id: string; cards: Array<{ cardId: number; quantity: number }> }
  | { type: "quantity"; id: string; cardId: number; quantity: number }
  | { type: "move"; id: string; targetId: string; cardId: number; quantity: number };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function validName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 100;
}

export function parseDeckStorage(raw: string | null): DeckStorage {
  if (raw === null) return { version: 1, decks: [] };
  const invalid = () => new Error("Saved decks could not be read. Your stored data has been preserved.");
  let data: unknown;
  try { data = JSON.parse(raw); } catch { throw invalid(); }
  if (!record(data) || data.version !== 1 || !Array.isArray(data.decks)) throw invalid();
  const deckIds = new Set<string>();
  for (const deck of data.decks) {
    if (!record(deck) || typeof deck.id !== "string" || !deck.id || deckIds.has(deck.id)
      || !validName(deck.name) || typeof deck.createdAt !== "string" || !Number.isFinite(Date.parse(deck.createdAt))
      || typeof deck.updatedAt !== "string" || !Number.isFinite(Date.parse(deck.updatedAt)) || !Array.isArray(deck.cards)) throw invalid();
    deckIds.add(deck.id);
    const cardIds = new Set<number>();
    for (const card of deck.cards) {
      if (!record(card) || !positiveInt(card.cardId) || !positiveInt(card.quantity) || cardIds.has(card.cardId)) throw invalid();
      cardIds.add(card.cardId);
    }
  }
  return data as DeckStorage;
}

export function applyDeckAction(decks: Deck[], action: DeckAction, now = new Date().toISOString()): Deck[] {
  if (action.type === "create") {
    const name = action.name.trim();
    if (!validName(name)) throw new Error("Enter a deck name with 1–100 characters.");
    if (!action.id || decks.some((deck) => deck.id === action.id)) throw new Error("This deck already exists.");
    return [...decks, { id: action.id, name, createdAt: now, updatedAt: now, cards: [] }];
  }
  const source = decks.find((deck) => deck.id === action.id);
  if (!source) throw new Error("This deck no longer exists.");
  if (action.type === "delete") return decks.filter((deck) => deck.id !== action.id);
  const next = decks.map((deck) => ({ ...deck, cards: deck.cards.map((card) => ({ ...card })) }));
  const deck = next.find((item) => item.id === action.id)!;
  deck.updatedAt = now;
  if (action.type === "rename") {
    const name = action.name.trim();
    if (!validName(name)) throw new Error("Enter a deck name with 1–100 characters.");
    deck.name = name;
  } else if (action.type === "add") {
    for (const { cardId, quantity } of action.cards) {
      if (!positiveInt(cardId)) throw new Error("Invalid card identifier.");
      if (!positiveInt(quantity)) throw new Error("Enter a valid card quantity.");
      const card = deck.cards.find((item) => item.cardId === cardId);
      if (card) {
        if (!Number.isSafeInteger(card.quantity + quantity)) throw new Error("Card quantity is too large.");
        card.quantity += quantity;
      } else deck.cards.push({ cardId, quantity });
    }
  } else if (action.type === "quantity") {
    if (!positiveInt(action.cardId) || !Number.isSafeInteger(action.quantity) || action.quantity < 0) throw new Error("Enter a valid card quantity.");
    const card = deck.cards.find((item) => item.cardId === action.cardId);
    if (!card) throw new Error("This card is no longer in the deck.");
    if (action.quantity === 0) deck.cards = deck.cards.filter((item) => item.cardId !== action.cardId);
    else card.quantity = action.quantity;
  } else {
    const target = next.find((item) => item.id === action.targetId);
    if (!target || target.id === deck.id) throw new Error("Choose a different destination deck.");
    const card = deck.cards.find((item) => item.cardId === action.cardId);
    if (!card || !positiveInt(action.quantity) || action.quantity > card.quantity) throw new Error("Enter a quantity available in the source deck.");
    const targetCard = target.cards.find((item) => item.cardId === action.cardId);
    if (targetCard) {
      if (!Number.isSafeInteger(targetCard.quantity + action.quantity)) throw new Error("Card quantity is too large.");
      targetCard.quantity += action.quantity;
    } else target.cards.push({ cardId: action.cardId, quantity: action.quantity });
    card.quantity -= action.quantity;
    deck.cards = deck.cards.filter((item) => item.quantity > 0);
    target.updatedAt = now;
  }
  return next;
}

export function persistDeckAction(storage: Pick<Storage, "getItem" | "setItem">, action: DeckAction): Deck[] {
  const current = parseDeckStorage(storage.getItem(DECK_STORAGE_KEY));
  const decks = applyDeckAction(current.decks, action);
  storage.setItem(DECK_STORAGE_KEY, JSON.stringify({ version: 1, decks } satisfies DeckStorage));
  return decks;
}
