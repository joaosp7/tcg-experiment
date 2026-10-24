import { toSearchParams, type CardQuery } from "@/lib/query";
import Link from "next/link";

export function Pagination({ query, page, pageCount }: { query: CardQuery; page: number; pageCount: number }) {
  if (pageCount <= 1) return null;
  const previous = page > 1 ? toSearchParams(query, page - 1) : null;
  const next = page < pageCount ? toSearchParams(query, page + 1) : null;

  return (
    <nav className="mt-8 flex items-center justify-between gap-4 text-sm" aria-label="Pages">
      {previous ? (
        <Link href={previous} className="text-gold underline-offset-2 hover:underline">
          Previous
        </Link>
      ) : (
        <span className="text-mist/40">Previous</span>
      )}
      <span className="font-mono text-mist">
        Page {page} of {pageCount}
      </span>
      {next ? (
        <Link href={next} className="text-gold underline-offset-2 hover:underline">
          Next
        </Link>
      ) : (
        <span className="text-mist/40">Next</span>
      )}
    </nav>
  );
}
