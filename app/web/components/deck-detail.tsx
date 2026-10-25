"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useDecks } from "@/components/deck-provider";
import type { CardSummary } from "@/lib/cards";
import { catalogNumber } from "@/lib/query";

const control = "rounded border border-line bg-deep px-3 py-2 text-sm text-stock disabled:opacity-40";

export function DeckDetail({ deckId }: { deckId: string }) {
  const { decks, ready, error, renameDeck, deleteDeck, setQuantity, moveCards } = useDecks();
  const deck = decks.find((item) => item.id === deckId);
  const [result, setResult] = useState<{ key: string; cards: CardSummary[]; error?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState("");
  const router = useRouter();
  // Quantity changes do not require another catalog request.
  const ids = deck?.cards.map((item) => item.cardId).sort((a, b) => a - b).join(",") ?? "";
  const requestKey = `${deckId}:${ids}:${attempt}`;

  useEffect(() => {
    if (!ready || !ids) return;
    const controller = new AbortController();
    async function load() {
      try {
        const cardIds = ids.split(",");
        const cards: CardSummary[] = [];
        for (let offset = 0; offset < cardIds.length; offset += 200) {
          const response = await fetch(`/api/cards?ids=${cardIds.slice(offset, offset + 200).join(",")}`, { signal: controller.signal });
          if (!response.ok) throw new Error("Unable to load card details. Your saved deck is unchanged.");
          const body = await response.json() as { cards: CardSummary[] };
          if (!Array.isArray(body.cards)) throw new Error("Unable to load card details. Please retry.");
          cards.push(...body.cards);
        }
        if (!controller.signal.aborted) setResult({ key: requestKey, cards });
      } catch (failure) {
        if (!controller.signal.aborted) setResult({ key: requestKey, cards: [], error: failure instanceof Error ? failure.message : "Unable to load card details." });
      }
    }
    void load();
    return () => controller.abort();
  }, [ready, ids, requestKey]);

  if (!ready) return <p>Loading your deck…</p>;
  if (!deck) return (
    <section className="flex flex-col gap-4">
      <h1 className="font-display text-3xl text-stock">Deck not found</h1>
      <p>This deck is not available in this browser.</p>
      {error ? <p role="alert" className="text-gold">{error}</p> : null}
      <Link href="/decks" className="text-gold underline">Back to my decks</Link>
    </section>
  );

  const targets = decks.filter((item) => item.id !== deckId);
  const loaded = result?.key === requestKey ? result : null;
  const cardsById = new Map(loaded?.cards.map((card) => [card.card_id, card]));

  return (
    <section className="flex flex-col gap-6">
      <Link href="/decks" className="text-sm text-gold hover:underline">← My decks</Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="break-words font-display text-4xl tracking-wide text-stock">{deck.name}</h1>
          <p className="mt-2 font-mono text-sm">{deck.cards.reduce((total, item) => total + item.quantity, 0)} cards · {deck.cards.length} unique</p>
        </div>
        <Link href="/" className="rounded bg-gold px-4 py-2 text-ink">Add cards from catalog</Link>
      </div>
      <p className="text-sm text-mist">Changes are saved automatically in this browser.</p>
      {error ? <p role="alert" className="border border-gold p-3 text-gold">{error}</p> : null}
      <p role="status" className="empty:hidden">{notice}</p>
      <form key={`${deck.id}:${deck.name}`} className="flex flex-wrap items-end gap-3" onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        if (renameDeck(deck.id, String(data.get("name") ?? "").trim())) setNotice("Deck renamed.");
      }}>
        <label className="flex min-w-0 flex-1 flex-col gap-2 text-sm" htmlFor="deck-name">Deck name
          <input id="deck-name" name="name" defaultValue={deck.name} required maxLength={100} className={control} />
        </label>
        <button className={control}>Rename</button>
        <button type="button" className={control} onClick={() => {
          if (window.confirm(`Delete “${deck.name}”? This cannot be undone.`) && deleteDeck(deck.id)) router.push("/decks");
        }}>Delete deck</button>
      </form>
      {deck.cards.length === 0 ? <p className="border border-dashed border-line p-8 text-center">This deck is empty. Select cards in the catalog to get started.</p> : !loaded ? <p role="status">Loading card details…</p> : loaded.error ? (
        <div role="alert" className="border border-gold p-4"><p>{loaded.error}</p><button type="button" onClick={() => setAttempt((value) => value + 1)} className={`${control} mt-3`}>Retry</button></div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {deck.cards.map((item) => {
            const card = cardsById.get(item.cardId);
            const name = card?.name ?? `Unavailable card ${catalogNumber(item.cardId)}`;
            return (
              <li key={item.cardId} className="min-w-0 rounded border border-line bg-mat p-4">
                <div className="flex gap-4">
                  {card?.image_url ? <Link href={`/cards/${item.cardId}`} className="relative block aspect-[63/88] w-20 shrink-0 self-start bg-stock"><Image src={card.image_url} alt={card.name} fill sizes="80px" className="object-contain" /></Link> : null}
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    {card ? <Link href={`/cards/${item.cardId}`} className="break-words text-stock hover:text-gold">{name}</Link> : <p className="text-gold">{name}</p>}
                    <p className="text-xs text-mist">{card ? `${catalogNumber(item.cardId)} · ${card.card_type}` : "This card no longer exists in the catalog. You can remove it from your deck."}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" aria-label={`Decrease quantity of ${name}`} onClick={() => setQuantity(deckId, item.cardId, item.quantity - 1)} className={control}>−</button>
                      <span className="font-mono text-sm" aria-label={`Quantity of ${name}`}>{item.quantity}</span>
                      <button type="button" aria-label={`Increase quantity of ${name}`} onClick={() => setQuantity(deckId, item.cardId, item.quantity + 1)} className={control}>+</button>
                      <button type="button" aria-label={`Remove ${name}`} onClick={() => setQuantity(deckId, item.cardId, 0)} className={control}>Remove</button>
                    </div>
                  </div>
                </div>
                {targets.length > 0 ? <form key={`${item.cardId}:${item.quantity}`} className="mt-4 flex flex-wrap items-end gap-2 border-t border-line pt-3" onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  const target = String(data.get("target") ?? "");
                  const quantity = Number(data.get("quantity"));
                  if (moveCards(deckId, target, item.cardId, quantity)) setNotice(`Moved ${quantity} × ${name} to ${targets.find((entry) => entry.id === target)?.name ?? "deck"}.`);
                }}>
                  <label className="flex flex-col gap-1 text-xs">Copies
                    <input name="quantity" type="number" min={1} max={item.quantity} defaultValue={1} required aria-label={`Copies of ${name} to move`} className={`${control} w-20`} />
                  </label>
                  <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs">Destination
                    <select name="target" required defaultValue="" aria-label={`Destination for ${name}`} className={`${control} w-full`}><option value="" disabled>Choose deck</option>{targets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}</select>
                  </label>
                  <button className={control}>Move</button>
                </form> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
