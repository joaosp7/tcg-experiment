import { searchCards, getFacets } from "@/lib/cards";
import { PAGE_SIZE, parseCardQuery, toSearchParams } from "@/lib/query";
import { CardTile } from "@/components/card-tile";
import { CatalogSelection } from "@/components/catalog-selection";
import { Filters } from "@/components/filters";
import { Pagination } from "@/components/pagination";
import Link from "next/link";
import { Suspense } from "react";

export default function Page({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<p className="text-mist">Loading the catalog…</p>}>
      <Catalog searchParams={searchParams} />
    </Suspense>
  );
}

async function Catalog({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  const query = parseCardQuery(await searchParams);
  const facets = getFacets();
  const result = searchCards(query);
  const start = result.cards.length === 0 ? 0 : (result.page - 1) * PAGE_SIZE + 1;
  const end = (result.page - 1) * PAGE_SIZE + result.cards.length;

  return (
    <div className="flex flex-col gap-6">
      <p className="font-mono text-sm text-mist">
        {result.total === facets.total
          ? `${facets.total.toLocaleString("en-US")} cards`
          : `${start.toLocaleString("en-US")}–${end.toLocaleString("en-US")} of ${result.total.toLocaleString("en-US")}`}
      </p>
      <Filters key={JSON.stringify(query)} query={query} facets={facets} />
      <CatalogSelection />
      {result.cards.length === 0 ? (
        <div className="border border-dashed border-line px-4 py-10 text-center">
          {result.total === 0 ? (
            <>
              <p className="text-stock">No cards match these filters.</p>
              <Link href="/" className="mt-3 inline-block text-gold underline-offset-2 hover:underline">
                Clear filters
              </Link>
            </>
          ) : (
            <>
              <p className="text-stock">This page is empty.</p>
              <Link
                href={toSearchParams(query, 1)}
                className="mt-3 inline-block text-gold underline-offset-2 hover:underline"
              >
                Back to the first page
              </Link>
            </>
          )}
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {result.cards.map((card, index) => (
            <li key={card.card_id}>
              <CardTile card={card} priority={result.page === 1 && index < 6} selectable />
            </li>
          ))}
        </ul>
      )}
      <Pagination query={{ ...query, page: result.page }} page={result.page} pageCount={result.pageCount} />
    </div>
  );
}
