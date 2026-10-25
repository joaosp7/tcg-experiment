import type { Metadata } from "next";
import { Suspense } from "react";
import { DeckDetail } from "@/components/deck-detail";

export const metadata: Metadata = { title: "Deck" };

export default function Page({ params }: { params: Promise<{ deckId: string }> }) {
  return (
    <Suspense fallback={<p>Loading deck…</p>}>
      <DeckView params={params} />
    </Suspense>
  );
}

async function DeckView({ params }: { params: Promise<{ deckId: string }> }) {
  const { deckId } = await params;
  return <DeckDetail deckId={deckId} />;
}
