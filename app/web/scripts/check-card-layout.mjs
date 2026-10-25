// Run with Playwright CLI: run-code --filename app/web/scripts/check-card-layout.mjs
// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- The CLI invokes this function with its page.
async (page) => {
  await page.reload();
  const selector = 'ul.grid:visible > li a[href^="/cards/"]';
  await page.locator(selector).nth(5).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);

  const results = [];
  const check = async (width, scenario) => {
    await page.setViewportSize({ width, height: 900 });
    const measurements = await page.locator(selector).evaluateAll((cards) => cards.map((card) => {
      const box = card.getBoundingClientRect();
      const image = card.firstElementChild.getBoundingClientRect();
      return { width: box.width, height: box.height, imageWidth: image.width, imageHeight: image.height };
    }));
    const gridDisplay = await page.locator("ul.grid:visible").evaluate((grid) => getComputedStyle(grid).display);
    if (gridDisplay !== "grid" || measurements.some((card) => card.imageHeight <= 0)) {
      throw new Error("Catalog CSS is missing: run the configured Turbopack server before measuring.");
    }
    for (const dimension of ["width", "height"]) {
      const values = measurements.map((card) => card[dimension]);
      if (Math.max(...values) - Math.min(...values) > 1) {
        throw new Error(`${scenario} at ${width}px: card ${dimension}s differ: ${[...new Set(values.map(Math.round))]}`);
      }
    }
    if (measurements.some((card) => Math.abs(card.imageWidth / card.imageHeight - 63 / 88) > 0.002)) {
      throw new Error(`${scenario} at ${width}px: image proportions changed`);
    }
    results.push({ viewport: width, scenario, cards: measurements.length,
                   width: Math.round(measurements[0].width), height: Math.round(measurements[0].height) });
  };

  for (const width of [1280, 360, 390, 640, 768, 1024, 1536]) await check(width, "catalog");

  // Change only rendered content, leaving the actual components and styles in place.
  await page.locator(selector).evaluateAll((cards) => cards.forEach((card, index) => {
    const [header, name, type, cost] = card.lastElementChild.children;
    name.textContent = index < 6 ? "Short" : index % 2
      ? "A very long translated card name that must fit the same tile without increasing its height"
      : "長い日本語のカード名であってもカードの大きさが変わらない";
    type.textContent = index % 4 ? "Unit/Buster/Ace" : "";
    if (index % 3 === 0) header.children[1]?.remove();
    if (index % 4 === 0) cost?.remove();
    else if (cost) cost.textContent = "(Black 12)/(Blue 12)/(White 12)/(Colorless 12)";
  }));
  for (const width of [360, 768, 1280]) await check(width, "mixed titles and missing metadata");

  await page.reload();
  await page.locator(selector).nth(5).waitFor();
  return results;
}
