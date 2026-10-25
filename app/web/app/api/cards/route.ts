import { getCardsByIds } from "@/lib/cards";

export function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("ids");
  if (!raw || raw.length > 4000) {
    return Response.json({ error: "Provide up to 200 comma-separated card IDs." }, { status: 400 });
  }
  const values = raw.split(",");
  const ids = values.map(Number);
  if (values.length > 200 || values.some((value) => !/^\d+$/.test(value)) || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    return Response.json({ error: "Provide up to 200 positive card IDs." }, { status: 400 });
  }
  return Response.json({ cards: getCardsByIds(ids) });
}
