import type { CardSummary } from "@/lib/cards";

export type DeckCardLoad = {
  cards: CardSummary[];
  resolvedIds: number[];
  failedIds: number[];
};

type CardFetch = (url: string, init: { signal?: AbortSignal }) => Promise<Pick<Response, "ok" | "json">>;

/** Resolve catalog details independently of the saved deck, retaining successful batches for retry. */
export async function loadDeckCards(ids: number[], options: {
  fetchCards?: CardFetch;
  signal?: AbortSignal;
  previous?: DeckCardLoad;
  onProgress?: (result: DeckCardLoad) => void;
} = {}): Promise<DeckCardLoad> {
  const fetchCards = options.fetchCards ?? fetch;
  const wanted = new Set(ids);
  const resolved = new Set(options.previous?.resolvedIds.filter((id) => wanted.has(id)));
  const cards = new Map(options.previous?.cards.filter((card) => wanted.has(card.card_id)).map((card) => [card.card_id, card]));
  const failed: number[] = [];
  const pending = [...wanted].filter((id) => !resolved.has(id));
  const snapshot = (): DeckCardLoad => ({ cards: [...cards.values()], resolvedIds: [...resolved], failedIds: [...failed] });

  for (let offset = 0; offset < pending.length; offset += 200) {
    if (options.signal?.aborted) return snapshot();
    const batch = pending.slice(offset, offset + 200);
    try {
      const response = await fetchCards(`/api/cards?ids=${batch.join(",")}`, { signal: options.signal });
      if (!response.ok) throw new Error("Card lookup failed.");
      const body: unknown = await response.json();
      if (!body || typeof body !== "object" || !("cards" in body) || !Array.isArray(body.cards)) {
        throw new Error("Invalid card lookup response.");
      }
      if (options.signal?.aborted) return snapshot();
      const batchIds = new Set(batch);
      for (const card of body.cards as CardSummary[]) {
        if (card && batchIds.has(card.card_id)) cards.set(card.card_id, card);
      }
      batch.forEach((id) => resolved.add(id));
    } catch {
      if (options.signal?.aborted) return snapshot();
      failed.push(...batch);
    }
    options.onProgress?.(snapshot());
  }
  return snapshot();
}
