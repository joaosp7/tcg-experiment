"use client";

import { catalogNumber } from "@/lib/query";
import type { CardSummary } from "@/lib/cards";
import { useDecks } from "@/components/deck-provider";
import Image from "next/image";
import Link from "next/link";

export function CardTile({ card, priority = false, selectable = false }: { card: CardSummary; priority?: boolean; selectable?: boolean }) {
  const { selectedCards, toggleCard, setSelectedQuantity, builderEnabled, ready } = useDecks();
  const showControls = selectable && builderEnabled;
  const quantity = selectedCards.find((item) => item.cardId === card.card_id)?.quantity ?? 0;
  const selected = showControls && quantity > 0;
  return (
    <div className={`flex h-full min-w-0 flex-col ${selected ? "ring-2 ring-gold ring-offset-2 ring-offset-deep" : ""}`}>
      {showControls ? (
        <div className="flex flex-col gap-2 border border-line bg-mat p-2 text-xs text-stock">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={selected}
            disabled={!ready}
            onChange={() => toggleCard(card.card_id)}
            aria-label={`Select ${card.name} (${catalogNumber(card.card_id)})`}
            className="size-4 shrink-0 accent-gold"
          />
          {selected ? "Selected" : "Select card"}
        </label>
        <label className="flex items-center justify-between gap-2">
          Copies
          <input type="number" min={0} step={1} value={quantity} disabled={!ready} aria-label={`Copies of ${card.name} (${catalogNumber(card.card_id)})`} onChange={(event) => setSelectedQuantity(card.card_id, event.target.value === "" ? 0 : event.target.valueAsNumber)} className="min-h-9 w-16 min-w-0 border border-line bg-deep px-2 text-stock" />
        </label>
        </div>
      ) : null}
    <Link
      href={`/cards/${card.card_id}`}
      className="group flex h-full min-w-0 flex-col overflow-hidden bg-stock text-ink shadow-[0_12px_28px_rgba(0,0,0,0.32)] transition-transform duration-200 hover:-translate-y-1 motion-reduce:transition-none motion-reduce:hover:translate-none"
    >
      <div className="relative aspect-[63/88] shrink-0 bg-[#ddd6c8]">
        {card.image_url ? (
          <Image
            src={card.image_url}
            alt={card.name}
            fill
            sizes="(max-width: 640px) 45vw, 180px"
            className="object-contain"
            priority={priority}
          />
        ) : null}
      </div>
      <div className="grid h-30 shrink-0 grid-rows-[1.25rem_2.5rem_1rem_1rem] gap-1 p-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[0.65rem] tracking-widest text-felt">
            {catalogNumber(card.card_id)}
          </span>
          {card.rarity ? (
            <span className="bg-ink px-1.5 py-0.5 font-mono text-[0.65rem] text-gold">{card.rarity}</span>
          ) : null}
        </div>
        <span title={card.name} className="line-clamp-2 text-sm leading-5 font-medium">{card.name}</span>
        <span className="line-clamp-1 text-xs leading-4 text-ink/70">{card.card_type}</span>
        {card.cost ? <span title={card.cost} className="truncate font-mono text-[0.7rem] leading-4 text-ink/80">{card.cost}</span> : null}
      </div>
    </Link>
    </div>
  );
}
