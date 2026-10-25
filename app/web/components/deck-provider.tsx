"use client";

import { createContext, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { DECK_STORAGE_KEY, parseDeckStorage, persistDeckAction, type Deck, type DeckAction } from "@/lib/decks";

type SelectedCard = { cardId: number; quantity: number };
type Snapshot = { decks: Deck[]; ready: boolean; error: string | null; selectedCards: SelectedCard[]; builderEnabled: boolean };
const initial: Snapshot = { decks: [], ready: false, error: null, selectedCards: [], builderEnabled: false };

function createStore() {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  function publish(change: Partial<Snapshot>) {
    snapshot = { ...snapshot, ...change };
    listeners.forEach((listener) => listener());
  }
  function failure(error: unknown) {
    publish({ ready: true, error: error instanceof Error ? error.message : "Could not access local deck storage." });
  }
  function reload() {
    try {
      const { decks } = parseDeckStorage(window.localStorage.getItem(DECK_STORAGE_KEY));
      publish({ decks, ready: true, error: null });
    } catch (error) { failure(error); }
  }
  function storageChanged(event: StorageEvent) {
    if (event.key === null || event.key === DECK_STORAGE_KEY) reload();
  }
  function commit(action: DeckAction): boolean {
    if (!snapshot.ready) return false;
    try {
      const decks = persistDeckAction(window.localStorage, action);
      publish({ decks, error: null });
      return true;
    } catch (error) {
      failure(error);
      return false;
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) {
        window.addEventListener("storage", storageChanged);
        reload();
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) window.removeEventListener("storage", storageChanged);
      };
    },
    createDeck(name: string): string | null {
      try {
        const id = crypto.randomUUID();
        return commit({ type: "create", id, name }) ? id : null;
      } catch (error) { failure(error); return null; }
    },
    renameDeck: (id: string, name: string) => commit({ type: "rename", id, name }),
    deleteDeck: (id: string) => commit({ type: "delete", id }),
    addCards: (id: string, cards: SelectedCard[]) => commit({ type: "add", id, cards }),
    setQuantity: (id: string, cardId: number, quantity: number) => commit({ type: "quantity", id, cardId, quantity }),
    moveCards: (id: string, targetId: string, cardId: number, quantity: number) => commit({ type: "move", id, targetId, cardId, quantity }),
    toggleCard(id: number) {
      if (!Number.isSafeInteger(id) || id < 1) return;
      publish({ selectedCards: snapshot.selectedCards.some((item) => item.cardId === id) ? snapshot.selectedCards.filter((item) => item.cardId !== id) : [...snapshot.selectedCards, { cardId: id, quantity: 1 }] });
    },
    setSelectedQuantity(cardId: number, quantity: number) {
      if (!Number.isSafeInteger(cardId) || cardId < 1 || !Number.isSafeInteger(quantity) || quantity < 0) return;
      const cards = snapshot.selectedCards.filter((item) => item.cardId !== cardId);
      publish({ selectedCards: quantity ? [...cards, { cardId, quantity }] : cards });
    },
    setBuilderEnabled: (builderEnabled: boolean) => publish({ builderEnabled }),
    clearSelection: () => publish({ selectedCards: [] }),
  };
}

type DeckContextValue = Snapshot & Pick<ReturnType<typeof createStore>, "createDeck" | "renameDeck" | "deleteDeck" | "addCards" | "setQuantity" | "moveCards" | "toggleCard" | "setSelectedQuantity" | "setBuilderEnabled" | "clearSelection">;
const DeckContext = createContext<DeckContextValue | null>(null);

export function DeckProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createStore);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, () => initial);
  const value = useMemo(() => ({ ...store, ...snapshot }), [store, snapshot]);
  return <DeckContext.Provider value={value}>{children}</DeckContext.Provider>;
}

export function useDecks(): DeckContextValue {
  const context = useContext(DeckContext);
  if (!context) throw new Error("useDecks must be used inside DeckProvider.");
  return context;
}
