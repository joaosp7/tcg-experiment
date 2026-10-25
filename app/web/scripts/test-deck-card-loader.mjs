import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const source = readFileSync(new URL("../lib/deck-card-loader.ts", import.meta.url), "utf8");
const { loadDeckCards } = await import(`data:text/javascript,${encodeURIComponent(stripTypeScriptTypes(source))}`);
const ids = Array.from({ length: 451 }, (_, index) => index + 1);
const response = (batch) => ({ ok: true, json: async () => ({ cards: batch.map((card_id) => ({ card_id, name: `Card ${card_id}` })) }) });
const batchFrom = (url) => new URL(url, "http://localhost").searchParams.get("ids").split(",").map(Number);

test("loads more than 200 IDs in bounded batches and reports progress", async () => {
  const batches = [];
  const progress = [];
  const result = await loadDeckCards(ids, {
    fetchCards: async (url) => { const batch = batchFrom(url); batches.push(batch); return response(batch); },
    onProgress: (value) => progress.push(value.cards.length),
  });
  assert.deepEqual(batches.map((batch) => batch.length), [200, 200, 51]);
  assert.deepEqual(progress, [200, 400, 451]);
  assert.equal(result.cards.length, ids.length);
  assert.deepEqual(result.resolvedIds, ids);
  assert.deepEqual(result.failedIds, []);
});

test("retains successful batches when a later network request fails and only retries failed IDs", async () => {
  let requests = 0;
  const result = await loadDeckCards(ids.slice(0, 250), {
    fetchCards: async (url) => {
      if (++requests === 2) throw new Error("Offline");
      return response(batchFrom(url));
    },
  });
  assert.equal(result.cards.length, 200);
  assert.deepEqual(result.resolvedIds, ids.slice(0, 200));
  assert.deepEqual(result.failedIds, ids.slice(200, 250));
  const retried = [];
  const retry = await loadDeckCards(ids.slice(0, 250), {
    previous: result,
    fetchCards: async (url) => { const batch = batchFrom(url); retried.push(...batch); return response(batch); },
  });
  assert.deepEqual(retried, ids.slice(200, 250));
  assert.equal(retry.cards.length, 250);
  assert.deepEqual(retry.failedIds, []);
});

test("non-OK and malformed responses mark failures without claiming cards are unavailable", async () => {
  for (const failure of [
    { ok: false, json: async () => ({ cards: [] }) },
    { ok: true, json: async () => ({ error: "Invalid response" }) },
  ]) {
    const result = await loadDeckCards([1, 2], { fetchCards: async () => failure });
    assert.deepEqual(result.resolvedIds, []);
    assert.deepEqual(result.failedIds, [1, 2]);
  }
});

test("a successful lookup distinguishes missing cards and does not request them again on retry", async () => {
  const first = await loadDeckCards([1, 2], { fetchCards: async () => response([1]) });
  assert.deepEqual(first.cards.map((card) => card.card_id), [1]);
  assert.deepEqual(first.resolvedIds, [1, 2]);
  let requests = 0;
  const second = await loadDeckCards([1, 2], { previous: first, fetchCards: async () => { requests++; return response([]); } });
  assert.equal(requests, 0);
  assert.deepEqual(second.resolvedIds, [1, 2]);
});

test("continues later batches after failure and removes cards no longer in the deck", async () => {
  const result = await loadDeckCards(ids, {
    fetchCards: async (url) => {
      const batch = batchFrom(url);
      return batch[0] === 201 ? { ok: false, json: async () => ({}) } : response(batch);
    },
  });
  assert.equal(result.cards.length, 251);
  assert.deepEqual(result.failedIds, ids.slice(200, 400));
  const trimmed = await loadDeckCards([1], { previous: result, fetchCards: async () => { throw new Error("Unexpected lookup"); } });
  assert.deepEqual(trimmed.cards.map((card) => card.card_id), [1]);
  assert.deepEqual(trimmed.resolvedIds, [1]);
});
