import Link from "next/link";

export default function NotFound() {
  return (
    <div className="border border-dashed border-line px-4 py-10">
      <h1 className="font-display text-3xl tracking-[0.12em] text-stock uppercase">Card not found</h1>
      <Link href="/" className="mt-3 inline-block text-gold underline-offset-2 hover:underline">
        Back to the catalog
      </Link>
    </div>
  );
}
