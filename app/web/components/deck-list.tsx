"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useDecks } from "@/components/deck-provider";

export function DeckList() {
  const { decks, ready, error, createDeck, deleteDeck } = useDecks();
  const [name, setName] = useState("");
  const router = useRouter();

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-4xl tracking-wide text-stock">My decks</h1>
        <p className="mt-2 text-sm text-mist">Saved in this browser only. Clearing site data removes your decks.</p>
      </div>
      {error ? <p role="alert" className="border border-gold p-3 text-gold">{error}</p> : null}
      <form className="flex flex-wrap items-end gap-3 rounded border border-line bg-mat p-4" onSubmit={(event) => {
        event.preventDefault();
        const id = createDeck(name.trim());
        if (id) router.push(`/decks/${id}`);
      }}>
        <label className="flex min-w-0 flex-1 flex-col gap-2 text-sm" htmlFor="new-deck-name">
          Deck name
          <input id="new-deck-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} placeholder="My new deck" className="w-full rounded border border-line bg-deep px-3 py-2 text-stock" />
        </label>
        <button disabled={!ready || !name.trim()} className="rounded bg-gold px-4 py-2 text-ink disabled:opacity-40">Create deck</button>
      </form>
      {!ready ? <p>Loading your decks…</p> : decks.length === 0 ? (
        <p className="border border-dashed border-line p-8 text-center">No decks yet. Create one, then select cards from the <Link href="/" className="text-gold underline">catalog</Link>.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {decks.map((deck) => (
            <li key={deck.id} className="flex flex-col gap-4 rounded border border-line bg-mat p-4">
              <Link href={`/decks/${deck.id}`} className="break-words font-display text-2xl text-gold hover:underline">{deck.name}</Link>
              <p className="font-mono text-sm">{deck.cards.reduce((total, card) => total + card.quantity, 0)} cards · {deck.cards.length} unique</p>
              <div className="flex items-center justify-between gap-3 text-sm">
                <Link href={`/decks/${deck.id}`} className="text-gold hover:underline">Edit deck</Link>
                <button type="button" onClick={() => {
                  if (window.confirm(`Delete “${deck.name}”? This cannot be undone.`)) deleteDeck(deck.id);
                }} className="rounded border border-line px-3 py-2 hover:border-gold">Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
