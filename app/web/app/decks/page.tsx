import type { Metadata } from "next";
import { DeckList } from "@/components/deck-list";

export const metadata: Metadata = { title: "My decks" };

export default function Page() {
  return <DeckList />;
}
