import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const source = readFileSync(new URL("../lib/decks.ts", import.meta.url), "utf8");
const { applyDeckAction, parseDeckStorage, persistDeckAction, persistDeckActionWithLock, DECK_STORAGE_KEY } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`);
const time = "2026-10-25T12:00:00.000Z";
const create = (decks, id) => applyDeckAction(decks, { type: "create", id, name: ` Deck ${id} ` }, time);

test("moving merges copies without mutating previous state", () => {
  let decks = create(create([], "a"), "b");
  decks = applyDeckAction(decks, { type: "add", id: "a", cards: [{ cardId: 1, quantity: 2 }, { cardId: 2, quantity: 1 }] }, time);
  decks = applyDeckAction(decks, { type: "add", id: "b", cards: [{ cardId: 1, quantity: 1 }] }, time);
  const moved = applyDeckAction(decks, { type: "move", id: "a", targetId: "b", cardId: 1, quantity: 2 }, time);
  assert.deepEqual(moved[0].cards, [{ cardId: 2, quantity: 1 }]);
  assert.deepEqual(moved[1].cards, [{ cardId: 1, quantity: 3 }]);
  assert.equal(decks[0].cards[0].quantity, 2);
  assert.throws(() => applyDeckAction(decks, { type: "move", id: "a", targetId: "b", cardId: 1, quantity: 3 }), /available/);
  assert.throws(() => applyDeckAction(decks, { type: "move", id: "a", targetId: "a", cardId: 1, quantity: 1 }), /different/);
});

test("rename, quantity updates, removal and deletion preserve other decks", () => {
  let decks = create(create([], "a"), "b");
  decks = applyDeckAction(decks, { type: "add", id: "a", cards: [{ cardId: 1, quantity: 1 }] });
  decks = applyDeckAction(decks, { type: "quantity", id: "a", cardId: 1, quantity: 4 });
  assert.equal(decks[0].cards[0].quantity, 4);
  decks = applyDeckAction(decks, { type: "quantity", id: "a", cardId: 1, quantity: 0 });
  assert.deepEqual(decks[0].cards, []);
  decks = applyDeckAction(decks, { type: "rename", id: "a", name: " Revised " });
  assert.equal(decks[0].name, "Revised");
  assert.equal(decks[0].createdAt, time);
  assert.deepEqual(applyDeckAction(decks, { type: "delete", id: "a" }), [decks[1]]);
  assert.throws(() => applyDeckAction(decks, { type: "rename", id: "a", name: " " }), /name/);
  assert.throws(() => applyDeckAction(decks, { type: "quantity", id: "a", cardId: 1, quantity: -1 }), /quantity/);
});

test("corrupt or unsupported stored data is never overwritten", () => {
  const decks = create([], "a");
  assert.deepEqual(parseDeckStorage(null), { version: 1, decks: [] });
  assert.deepEqual(parseDeckStorage(JSON.stringify({ version: 1, decks })), { version: 1, decks });
  for (const raw of ["{", "null", '{"version":2,"decks":[]}', JSON.stringify({ version: 1, decks: [...decks, ...decks] }), JSON.stringify({ version: 1, decks: [{ ...decks[0], cards: [{ cardId: 1, quantity: 0 }] }] })]) {
    let writes = 0;
    const storage = { getItem: () => raw, setItem: () => { writes++; } };
    assert.throws(() => persistDeckAction(storage, { type: "create", id: "b", name: "B" }), /preserved/);
    assert.equal(writes, 0);
  }
});

test("mutations read latest saved decks and failed writes propagate", () => {
  let raw = JSON.stringify({ version: 1, decks: create([], "other-tab") });
  const storage = {
    getItem(key) { assert.equal(key, DECK_STORAGE_KEY); return raw; },
    setItem(key, value) { assert.equal(key, DECK_STORAGE_KEY); raw = value; },
  };
  const decks = persistDeckAction(storage, { type: "create", id: "new", name: "New" });
  assert.deepEqual(decks.map((deck) => deck.id), ["other-tab", "new"]);
  assert.deepEqual(parseDeckStorage(raw).decks, decks);
  const previous = raw;
  assert.throws(() => persistDeckAction({ ...storage, setItem() { throw new Error("Quota exceeded"); } }, { type: "delete", id: "new" }), /Quota/);
  assert.equal(raw, previous);
});

test("bulk additions merge mixed quantities and repeated IDs in one saved update", () => {
  const original = applyDeckAction(create([], "a"), { type: "add", id: "a", cards: [{ cardId: 1, quantity: 2 }] });
  let raw = JSON.stringify({ version: 1, decks: original });
  let writes = 0;
  const storage = {
    getItem: () => raw,
    setItem(key, value) { assert.equal(key, DECK_STORAGE_KEY); writes++; raw = value; },
  };
  const decks = persistDeckAction(storage, { type: "add", id: "a", cards: [
    { cardId: 1, quantity: 4 },
    { cardId: 2, quantity: 3 },
    { cardId: 1, quantity: 2 },
    { cardId: 3, quantity: Number.MAX_SAFE_INTEGER },
  ] });
  assert.deepEqual(decks[0].cards, [
    { cardId: 1, quantity: 8 }, { cardId: 2, quantity: 3 }, { cardId: 3, quantity: Number.MAX_SAFE_INTEGER },
  ]);
  assert.deepEqual(parseDeckStorage(raw).decks, decks);
  assert.deepEqual(original[0].cards, [{ cardId: 1, quantity: 2 }]);
  assert.equal(writes, 1);
});

test("invalid bulk quantities and overflow abort the entire addition without changing saved data", () => {
  const original = applyDeckAction(create([], "a"), { type: "add", id: "a", cards: [{ cardId: 1, quantity: Number.MAX_SAFE_INTEGER }] });
  const raw = JSON.stringify({ version: 1, decks: original });
  let writes = 0;
  const storage = { getItem: () => raw, setItem: () => { writes++; } };
  for (const quantity of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "2"]) {
    assert.throws(() => persistDeckAction(storage, { type: "add", id: "a", cards: [
      { cardId: 2, quantity: 3 }, { cardId: 3, quantity },
    ] }), /quantity/);
  }
  assert.throws(() => persistDeckAction(storage, { type: "add", id: "a", cards: [
    { cardId: 2, quantity: 3 }, { cardId: 1, quantity: 1 },
  ] }), /too large/);
  assert.throws(() => persistDeckAction(storage, { type: "add", id: "a", cards: [
    { cardId: 2, quantity: Number.MAX_SAFE_INTEGER }, { cardId: 2, quantity: 1 },
  ] }), /too large/);
  assert.equal(writes, 0);
  assert.deepEqual(parseDeckStorage(raw).decks, original);
});

// Model separate tabs sharing an origin-wide lock queue. The gate lets mutations
// overlap while another writer owns the lock; reads must wait for its release.
function queuedLocks(gate = Promise.resolve()) {
  let tail = gate;
  let active = false;
  return {
    get active() { return active; },
    request(name, options, callback) {
      assert.equal(name, DECK_STORAGE_KEY);
      assert.equal(options.mode, "exclusive");
      const result = tail.then(async () => {
        assert.equal(active, false);
        active = true;
        try { return await callback(); } finally { active = false; }
      });
      tail = result.catch(() => undefined);
      return result;
    },
  };
}

test("overlapping tab mutations wait for the lock and retain both updates", async () => {
  let release;
  const locks = queuedLocks(new Promise((resolve) => { release = resolve; }));
  let raw = JSON.stringify({ version: 1, decks: create([], "a") });
  let reads = 0;
  let writes = 0;
  const storage = {
    getItem() { assert.equal(locks.active, true); reads++; return raw; },
    setItem(key, value) { assert.equal(locks.active, true); writes++; raw = value; },
  };
  const firstTab = persistDeckActionWithLock(storage, { type: "add", id: "a", cards: [{ cardId: 1, quantity: 2 }] }, locks);
  const secondTab = persistDeckActionWithLock(storage, { type: "add", id: "a", cards: [{ cardId: 1, quantity: 3 }] }, locks);
  await Promise.resolve();
  assert.equal(reads, 0);
  assert.equal(writes, 0);
  // A writer already holding the lock finishes before the two queued additions.
  raw = JSON.stringify({ version: 1, decks: applyDeckAction(create([], "a"), { type: "add", id: "a", cards: [{ cardId: 1, quantity: 4 }] }) });
  release();
  const results = await Promise.all([firstTab, secondTab]);
  assert.equal(results[0][0].cards[0].quantity, 6);
  assert.equal(results[1][0].cards[0].quantity, 9);
  assert.equal(parseDeckStorage(raw).decks[0].cards[0].quantity, 9);
  assert.equal(reads, 2);
  assert.equal(writes, 2);
});

test("locked save failure preserves stored data and releases the lock for the next writer", async () => {
  const locks = queuedLocks();
  const previous = JSON.stringify({ version: 1, decks: create([], "a") });
  let raw = previous;
  const storage = { getItem: () => raw, setItem(key, value) { raw = value; } };
  await assert.rejects(persistDeckActionWithLock({ ...storage, setItem() { throw new Error("Quota exceeded"); } }, { type: "delete", id: "a" }, locks), /Quota/);
  assert.equal(raw, previous);
  await persistDeckActionWithLock(storage, { type: "create", id: "b", name: "B" }, locks);
  assert.deepEqual(parseDeckStorage(raw).decks.map((deck) => deck.id), ["a", "b"]);
});

test("unsupported locking refuses to save without touching storage", async () => {
  let accesses = 0;
  const storage = { getItem() { accesses++; return null; }, setItem() { accesses++; } };
  await assert.rejects(persistDeckActionWithLock(storage, { type: "create", id: "a", name: "A" }, undefined), /cannot safely save/);
  assert.equal(accesses, 0);
});
