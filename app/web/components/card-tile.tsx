import { catalogNumber } from "@/lib/query";
import type { CardSummary } from "@/lib/cards";
import Image from "next/image";
import Link from "next/link";

export function CardTile({ card, priority = false }: { card: CardSummary; priority?: boolean }) {
  return (
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
  );
}
