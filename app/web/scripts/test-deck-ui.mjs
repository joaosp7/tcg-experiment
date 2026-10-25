import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import test, { after } from "node:test";
import ts from "typescript";
import { JSDOM } from "jsdom";

// Exercise the real provider, field, catalog toolbar and detail component together.
// Only Next navigation/image rendering and external I/O are substituted.
const require = createRequire(import.meta.url);
const folder = mkdtempSync(path.join(tmpdir(), "deck-ui-"));
const webRoot = new URL("../", import.meta.url);
const urlFor = (name) => pathToFileURL(path.join(folder, `${name}.mjs`)).href;
const sources = {
  decks: "lib/decks.ts", query: "lib/query.ts", "deck-card-loader": "lib/deck-card-loader.ts",
  "deck-provider": "components/deck-provider.tsx", "copy-count-input": "components/copy-count-input.tsx",
  "card-tile": "components/card-tile.tsx", "catalog-selection": "components/catalog-selection.tsx",
  "deck-detail": "components/deck-detail.tsx",
};
const reactUrl = pathToFileURL(require.resolve("react")).href;
writeFileSync(path.join(folder, "next.mjs"), `import {createElement} from ${JSON.stringify(reactUrl)};
export default function Link({children,href}) {return createElement('a',{href},children)}
export function useRouter(){return {push(){}}}
export function Image(){return null}`);
for (const [name, file] of Object.entries(sources)) {
  let output = ts.transpileModule(readFileSync(new URL(file, webRoot), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  output = output.replace(/from "([^"]+)"/g, (match, specifier) => {
    if (specifier.startsWith("@/")) return `from ${JSON.stringify(urlFor(specifier.split("/").at(-1)))}`;
    if (specifier.startsWith("next/")) return `from ${JSON.stringify(urlFor("next"))}`;
    return `from ${JSON.stringify(pathToFileURL(require.resolve(specifier)).href)}`;
  });
  // Image is irrelevant to these tests; use a separate stub instead of a link.
  if (output.includes('import Image from')) {
    writeFileSync(path.join(folder, "image.mjs"), "export default function Image(){return null}");
    output = output.replace(/import Image from [^;]+;/, `import Image from ${JSON.stringify(urlFor("image"))};`);
  }
  writeFileSync(path.join(folder, `${name}.mjs`), output);
}
const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Event = dom.window.Event;
globalThis.FormData = dom.window.FormData;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let queue = Promise.resolve();
Object.defineProperty(navigator, "locks", { value: {
  request(name, options, callback) {
    const result = queue.then(() => callback({ name }));
    queue = result.catch(() => {});
    return result;
  },
} });
const { createElement: h, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { DeckProvider, useDecks } = await import(urlFor("deck-provider"));
const { CatalogSelection } = await import(urlFor("catalog-selection"));
const { CardTile } = await import(urlFor("card-tile"));
const { DeckDetail } = await import(urlFor("deck-detail"));
const { DECK_STORAGE_KEY } = await import(urlFor("decks"));
const card = { card_id: 1, name: "Test card", card_type: "Unit", image_url: "", cost: "", rarity: "N" };
const deck = { id: "test", name: "Test deck", createdAt: "2026-10-25T12:00:00Z", updatedAt: "2026-10-25T12:00:00Z", cards: [] };
let root;
async function mount(children, cards = []) {
  window.localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify({ version: 1, decks: [{ ...deck, cards }] }));
  root = createRoot(document.getElementById("root"));
  await act(async () => root.render(h(DeckProvider, null, children)));
}
async function unmount() { if (root) { await act(async () => root.unmount()); root = null; } }
const button = (text) => [...document.querySelectorAll("button")].find((element) => element.textContent === text);
const copies = () => document.querySelector('input[aria-label="Copies of Test card (#0001)"]');
async function click(element) { assert(element); await act(async () => element.click()); }
async function edit(value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(copies(), value);
    copies().dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}
const saved = () => JSON.parse(window.localStorage.getItem(DECK_STORAGE_KEY)).decks[0].cards;
after(async () => { await unmount(); dom.window.close(); rmSync(folder, { recursive: true, force: true }); });

test("catalog rejects invalid copy drafts and saves exactly the corrected quantity", async () => {
  try {
    await mount([h(CatalogSelection, { key: "toolbar" }), h(CardTile, { key: "card", card, selectable: true })]);
    await click(document.querySelector('[role="switch"]'));
    await edit("4");
    assert.equal(copies().value, "4");
    assert.equal(button("Add to deck").disabled, false);
    for (const invalid of ["2.5", "-1", "", "9007199254740992"]) {
      await edit(invalid);
      assert.equal(copies().value, invalid);
      assert.equal(copies().getAttribute("aria-invalid"), "true");
      assert.equal(button("Add to deck").disabled, true);
      await click(button("Add to deck"));
      assert.deepEqual(saved(), []);
    }
    await edit("3");
    assert.equal(copies().getAttribute("aria-invalid"), "false");
    await click(button("Add to deck"));
    assert.deepEqual(saved(), [{ cardId: 1, quantity: 3 }]);
    assert.equal(copies().value, "0");
    await edit("bad");
    await click(document.querySelector('input[type="checkbox"]'));
    assert.equal(copies().value, "1");
    await click(button("Clear selection"));
    assert.equal(copies().value, "0");
    await edit("bad");
    assert.equal(button("Clear selection").disabled, false);
    await click(button("Clear selection"));
    assert.equal(copies().value, "0");
  } finally { await unmount(); }
});

test("failed writes retain selection and never report an addition", async () => {
  try {
    await mount([h(CatalogSelection, { key: "toolbar" }), h(CardTile, { key: "card", card, selectable: true })]);
    await click(document.querySelector('[role="switch"]'));
    await edit("4");
    const original = window.Storage.prototype.setItem;
    window.Storage.prototype.setItem = () => { throw new Error("Quota exceeded"); };
    try { await click(button("Add to deck")); } finally { window.Storage.prototype.setItem = original; }
    assert.deepEqual(saved(), []);
    assert.equal(copies().value, "4");
    assert.match(document.body.textContent, /Quota exceeded/);
    assert.doesNotMatch(document.body.textContent, /Added 4/);
  } finally { await unmount(); }
});

test("detail controls work after failed lookup and retry restores details", async () => {
  const originalFetch = globalThis.fetch;
  let fail = true;
  globalThis.fetch = async () => ({ ok: !fail, json: async () => ({ cards: [card] }) });
  try {
    await mount(h(DeckDetail, { deckId: "test" }), [{ cardId: 1, quantity: 2 }]);
    assert.match(document.body.textContent, /could not be loaded/);
    const increase = () => document.querySelector('button[aria-label^="Increase quantity"]');
    await click(increase());
    assert.deepEqual(saved(), [{ cardId: 1, quantity: 3 }]);
    fail = false;
    await click(button("Retry failed details"));
    assert.match(document.body.textContent, /Test card/);
    assert.doesNotMatch(document.body.textContent, /could not be loaded/);
    await click(document.querySelector('button[aria-label^="Remove "]'));
    assert.deepEqual(saved(), []);
  } finally { globalThis.fetch = originalFetch; await unmount(); }
});

test("independent providers queue writes and reload changes from storage events", async () => {
  const stores = {};
  function Probe({ id }) { stores[id] = useDecks(); return null; }
  try {
    await mount([h(DeckProvider, { key: "a" }, h(Probe, { id: "a" })), h(DeckProvider, { key: "b" }, h(Probe, { id: "b" }))]);
    let release;
    queue = new Promise((resolve) => { release = resolve; });
    let first, second;
    await act(async () => {
      first = stores.a.addCards("test", [{ cardId: 1, quantity: 2 }]);
      second = stores.b.addCards("test", [{ cardId: 2, quantity: 3 }]);
    });
    assert.equal(stores.a.pending, true);
    assert.equal(stores.b.pending, true);
    assert.deepEqual(saved(), []);
    await act(async () => { release(); assert.deepEqual(await Promise.all([first, second]), [true, true]); });
    assert.deepEqual(saved(), [{ cardId: 1, quantity: 2 }, { cardId: 2, quantity: 3 }]);
    await act(async () => window.dispatchEvent(new window.StorageEvent("storage", { key: DECK_STORAGE_KEY })));
    assert.deepEqual(stores.a.decks[0].cards, saved());
    assert.deepEqual(stores.b.decks[0].cards, saved());
    assert.equal(stores.a.pending, false);
    assert.equal(stores.b.pending, false);
  } finally { await unmount(); }
});
