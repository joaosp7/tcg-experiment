import { getCard, roleLabels } from "@/lib/cards";
import { catalogNumber } from "@/lib/query";
import { CardTurn } from "@/components/card-turn";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

type CardRouteProps = PageProps<"/cards/[cardId]">;

export async function generateMetadata({ params }: CardRouteProps): Promise<Metadata> {
  const cardId = cardIdFrom(await params);
  const card = cardId === null ? null : getCard(cardId);
  return { title: card?.name || "Card" };
}

export default function Page({ params }: CardRouteProps) {
  return (
    <Suspense fallback={<p className="text-mist">Loading card…</p>}>
      <CardView params={params} />
    </Suspense>
  );
}

async function CardView({ params }: Pick<CardRouteProps, "params">) {
  const cardId = cardIdFrom(await params);
  const card = cardId === null ? null : getCard(cardId);
  if (!card) notFound();
  const roles = roleLabels(card);
  const stats = [
    ["Power", card.power],
    ["Hit", card.hit],
    ["Cost", card.cost],
    ["Attributes", card.attributes],
    ["Illustrator", card.illustrator],
    ["Set", card.set_name],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));

  return (
    <article className="grid gap-8 md:grid-cols-[minmax(0,18rem)_1fr]">
      <CardTurn name={card.name} front={card.image_url} back={card.back_image_url} />
      <div className="flex flex-col gap-5">
        <div>
          <p className="font-mono text-sm tracking-widest text-gold">{catalogNumber(card.card_id)}</p>
          <h1 className="mt-1 text-3xl leading-tight text-stock">{card.name}</h1>
          <p className="mt-2 text-sm text-mist">
            {[card.card_type, card.rarity].filter(Boolean).join(" · ")}
          </p>
          {roles.length ? <p className="mt-1 text-sm text-mist">{roles.join(" · ")}</p> : null}
        </div>
        {card.effect_text ? (
          <section>
            <h2 className="mb-1 text-[0.7rem] tracking-[0.16em] text-gold uppercase">Effect</h2>
            <p className="leading-relaxed whitespace-pre-wrap text-stock">{card.effect_text}</p>
          </section>
        ) : null}
        {card.flavor_text ? (
          <p className="border-l-2 border-gold pl-3 text-mist italic">{card.flavor_text}</p>
        ) : null}
        {stats.length ? (
          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-sm">
            {stats.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-mist">{label}</dt>
                <dd className="text-stock">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-4 text-sm">
          <Link href="/" className="text-gold underline-offset-2 hover:underline">
            Back to the catalog
          </Link>
          {card.official_url ? (
            <a
              href={card.official_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gold underline-offset-2 hover:underline"
            >
              Official page
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function cardIdFrom(params: { cardId: string }): number | null {
  if (!/^\d+$/.test(params.cardId)) return null;
  return Number(params.cardId);
}
