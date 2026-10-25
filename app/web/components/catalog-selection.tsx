"use client";

import { useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { useDecks } from "@/components/deck-provider";

const button = "min-h-10 border border-gold px-3 py-2 text-sm text-gold disabled:cursor-not-allowed disabled:opacity-40";
const field = "min-h-10 min-w-0 border border-line bg-deep px-3 py-2 text-sm text-stock";

export function CatalogSelection() {
  const { decks, ready, error, createDeck, addCards, selectedCards, clearSelection, builderEnabled, setBuilderEnabled } = useDecks();
  const [destination, setDestination] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const id = useId();
  const destinationId = decks.some((deck) => deck.id === destination) ? destination : decks[0]?.id ?? "";
  const copyCount = selectedCards.reduce((total, card) => total + card.quantity, 0);

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const deckId = createDeck(name);
    if (deckId) {
      setDestination(deckId);
      setName("");
      setMessage(`Created “${name.trim()}”. You can now add the selected cards.`);
    }
  }

  function add() {
    setMessage("");
    const deck = decks.find((entry) => entry.id === destinationId);
    if (!deck || !selectedCards.length) return;
    const count = copyCount;
    if (addCards(deck.id, selectedCards)) {
      clearSelection();
      setMessage(`Added ${count} ${count === 1 ? "card" : "cards"} to “${deck.name}”.`);
    }
  }

  return (
    <section aria-label="Build a deck" className="flex flex-col gap-4 border border-line bg-mat p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-display text-xl tracking-wide text-stock">Build a deck</p>
        </div>
        <button type="button" role="switch" aria-label="Build a deck" aria-checked={builderEnabled} aria-controls={`${id}-controls`} onClick={() => setBuilderEnabled(!builderEnabled)} className="flex min-h-10 items-center gap-2 text-sm text-stock">
          <span>{builderEnabled ? "On" : "Off"}</span>
          <span className={`flex h-6 w-11 items-center rounded-full border p-0.5 ${builderEnabled ? "justify-end border-gold bg-gold" : "justify-start border-line bg-deep"}`}>
            <span className={`size-4 rounded-full ${builderEnabled ? "bg-ink" : "bg-mist"}`} />
          </span>
        </button>
      </div>
      {builderEnabled ? <div id={`${id}-controls`} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-mist">Select cards and copies across pages and filters, then add them to a deck.</p>
        <Link href="/decks" className="text-sm text-gold underline-offset-2 hover:underline">My decks</Link>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <p aria-live="polite" className="self-center font-mono text-sm text-stock">{selectedCards.length} selected · {copyCount} copies</p>
        <button type="button" onClick={() => { clearSelection(); setMessage(""); }} disabled={!selectedCards.length} className="min-h-10 px-2 text-sm text-mist underline underline-offset-2 disabled:opacity-40">Clear selection</button>
        <div className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-72">
          <label htmlFor={`${id}-destination`} className="text-xs text-mist">Destination deck</label>
          <select id={`${id}-destination`} value={destinationId} onChange={(event) => { setDestination(event.target.value); setMessage(""); }} disabled={!ready || !decks.length} className={field}>
            {!decks.length ? <option value="">Create a deck below</option> : null}
            {decks.map((deck) => <option key={deck.id} value={deck.id}>{deck.name}</option>)}
          </select>
        </div>
        <button type="button" onClick={add} disabled={!ready || !destinationId || !selectedCards.length} className={button}>Add to deck</button>
      </div>
      <form onSubmit={create} className="flex flex-wrap items-end gap-3 border-t border-line pt-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-72">
          <label htmlFor={`${id}-name`} className="text-xs text-mist">New deck name</label>
          <input id={`${id}-name`} value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required disabled={!ready} placeholder="e.g. Black / Blue" className={field} />
        </div>
        <button type="submit" disabled={!ready || !name.trim()} className={button}>Create deck</button>
      </form>
      {!ready ? <p role="status" className="text-sm text-mist">Loading your decks…</p> : null}
      {error ? <p role="alert" className="text-sm text-gold">{error}</p> : null}
      <p role="status" className="text-sm text-stock empty:hidden">{message}</p>
      <p className="text-xs text-mist">Decks are saved in this browser only. Adding a card keeps it in the catalog.</p>
      </div> : null}
    </section>
  );
}
