#!/usr/bin/env python3
"""Download every Build Divide card from the official deck builder.

Images go to images/. Card fields from the detail modal go to data/cards.db.
Safe to stop and run again: cards already stored with their image files are skipped.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
import threading
import time
from html import unescape
from concurrent.futures import ThreadPoolExecutor, as_completed
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BASE = "https://tcg.build-divide.com"
SEARCH_URL = f"{BASE}/official/decks/search.json"
DETAIL_URL = f"{BASE}/official/decks/card/{{card_id}}.json"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
ROOT = Path(__file__).resolve().parent
IMAGES = ROOT / "images"
DATA = ROOT / "data"
DB_PATH = DATA / "cards.db"
WORKERS = 4
REQUEST_INTERVAL = 0.1
FETCH_ATTEMPTS = 5
CARD_ATTEMPTS = 3

STAT_COLUMNS = {
    "パワー": "power",
    "ヒット": "hit",
    "コスト": "cost",
    "イラストレーター": "illustrator",
    "収録弾": "set_name",
    "レアリティ": "rarity",
}
IMAGE_EXT = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
KNOWN_EXT = set(IMAGE_EXT.values())


class RateLimiter:
    def __init__(self, interval: float) -> None:
        self.interval = interval
        self._lock = threading.Lock()
        self._next = 0.0

    def wait(self) -> None:
        with self._lock:
            now = time.monotonic()
            slot = max(now, self._next)
            self._next = slot + self.interval
        delay = slot - time.monotonic()
        if delay > 0:
            time.sleep(delay)


LIMITER = RateLimiter(REQUEST_INTERVAL)


def fetch(url: str, accept: str) -> tuple[bytes, str]:
    last_error: Exception | None = None
    for attempt in range(FETCH_ATTEMPTS):
        LIMITER.wait()
        request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": accept})
        try:
            with urlopen(request, timeout=60) as response:
                data = response.read()
                content_type = response.headers.get("Content-Type", "")
                return data, content_type.split(";")[0].strip().lower()
        except HTTPError as exc:
            last_error = exc
            if exc.code == 404:
                raise
            time.sleep(min(30, 2**attempt))
        except (URLError, TimeoutError, ConnectionError, OSError) as exc:
            last_error = exc
            time.sleep(min(30, 2**attempt))
    raise RuntimeError(f"failed to fetch {url}: {last_error}")


class ModalParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.badges: list[str] = []
        self.name = ""
        self.effect = ""
        self.flavor = ""
        self.stats: dict[str, str] = {}
        self.turn_links: list[tuple[str, str]] = []
        self.front_img = ""
        self.deck_raw = ""
        self._pending_label = ""
        self._skip = 0
        self._mode: str | None = None
        self._mode_tag: str | None = None
        self._buf: list[str] = []
        self._in_turn = False
        self._turn_path = ""
        self._turn_buf: list[str] = []
        self._ignore_flavor_icon = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "svg" or self._skip:
            self._skip += 1
            return
        attributes = {key: value or "" for key, value in attrs}
        classes = set(attributes.get("class", "").split())
        if "data-decks-player-deck-card-param" in attributes:
            self.deck_raw = attributes["data-decks-player-deck-card-param"]
        if tag == "img" and attributes.get("data-cards-target") == "image":
            self.front_img = attributes.get("src", "")
        if tag == "a" and attributes.get("data-cards-path-param"):
            self._in_turn = True
            self._turn_path = attributes["data-cards-path-param"]
            self._turn_buf = []
        if tag == "i" and self._mode == "flavor":
            self._ignore_flavor_icon += 1
            return
        if tag == "label" and "rounded-3xl" in classes:
            self._begin("badge", tag)
        elif tag == "h2":
            self._begin("name", tag)
        elif tag == "p" and "mb-5" in classes:
            self._begin("effect", tag)
        elif tag == "p" and "mb-6" in classes:
            self._begin("flavor", tag)
        elif tag == "label" and "block" in classes:
            self._begin("stat_label", tag)
        elif tag == "span" and "block" in classes and "p-4" in classes:
            self._begin("stat_value", tag)

    def handle_endtag(self, tag: str) -> None:
        if self._skip:
            self._skip -= 1
            return
        if tag == "i" and self._ignore_flavor_icon:
            self._ignore_flavor_icon -= 1
            return
        if tag == "a" and self._in_turn:
            self.turn_links.append(("".join(self._turn_buf).strip(), self._turn_path))
            self._in_turn = False
        if self._mode and tag == self._mode_tag:
            text = "".join(self._buf).strip()
            if self._mode == "badge" and text:
                self.badges.append(text)
            elif self._mode == "name":
                self.name = text
            elif self._mode == "effect":
                self.effect = text
            elif self._mode == "flavor":
                self.flavor = text.strip().strip('"').strip()
            elif self._mode == "stat_label":
                self._pending_label = text
            elif self._mode == "stat_value":
                if self._pending_label:
                    self.stats[self._pending_label] = text
                self._pending_label = ""
            self._mode = None
            self._mode_tag = None
            self._buf = []

    def handle_data(self, data: str) -> None:
        if self._skip or self._ignore_flavor_icon:
            return
        if self._mode:
            self._buf.append(data)
        if self._in_turn:
            self._turn_buf.append(data)

    def _begin(self, mode: str, tag: str) -> None:
        self._mode = mode
        self._mode_tag = tag
        self._buf = []


def parse_modal(html: str) -> dict:
    parser = ModalParser()
    parser.feed(html)
    deck: dict = {}
    if parser.deck_raw:
        deck = json.loads(unescape(parser.deck_raw))
    front_url = ""
    back_url = ""
    for label, url in parser.turn_links:
        if label == "裏面":
            back_url = url
        elif not front_url:
            front_url = url
    if not front_url:
        front_url = parser.front_img
    image = deck.get("image_path") or {}
    if not front_url and isinstance(image, dict):
        front_url = image.get("url") or ""
    columns = {column: parser.stats.get(label, "") for label, column in STAT_COLUMNS.items()}
    same_ids = deck.get("same_card_ids")
    return {
        "name": parser.name or deck.get("name") or "",
        "card_type": parser.badges[0] if parser.badges else "",
        "attributes": parser.badges[1] if len(parser.badges) > 1 else "",
        "effect_text": parser.effect,
        "flavor_text": parser.flavor,
        **columns,
        "image_url": front_url,
        "back_image_url": back_url,
        "is_territory": int(bool(deck.get("territory"))),
        "is_unit": int(bool(deck.get("unit"))),
        "is_action": int(bool(deck.get("action"))),
        "is_ace": int(bool(deck.get("ace"))),
        "is_buster": int(bool(deck.get("baster"))),
        "is_shot": int(bool(deck.get("shot"))),
        "tags": json.dumps(deck.get("tags") or [], ensure_ascii=False),
        "effects_json": json.dumps(deck.get("effects") or [], ensure_ascii=False),
        "card_group_id": deck.get("card_group_id"),
        "same_card_ids": json.dumps(same_ids, ensure_ascii=False) if same_ids is not None else None,
    }


def list_cards() -> tuple[dict[int, str], int | None]:
    found: dict[int, str] = {}
    total: int | None = None
    page = 1
    while True:
        payload = json.loads(fetch(f"{SEARCH_URL}?page={page}", "application/json")[0].decode())
        if total is None:
            total = (payload.get("count") or {}).get("total")
        entries = payload.get("entries") or ""
        ids = [int(value) for value in re.findall(r'data-cards-card-id-param="(\d+)"', entries)]
        images = re.findall(r'<img[^>]+src="([^"]+)"', entries)
        if len(ids) != len(images):
            raise RuntimeError(f"page {page}: {len(ids)} ids and {len(images)} images")
        if not ids:
            break
        for card_id, image_url in zip(ids, images):
            found.setdefault(card_id, image_url)
        print(f"[page {page}] {len(found)} cards listed", flush=True)
        pagination = payload.get("pagination") or ""
        if 'rel="next"' not in pagination and "rel='next'" not in pagination:
            break
        page += 1
    return found, total


def extension_for(url: str, content_type: str) -> str:
    suffix = Path(url.split("?", 1)[0]).suffix.lower()
    if suffix in KNOWN_EXT:
        return suffix
    return IMAGE_EXT.get(content_type, ".png")


def saved_image(card_id: int, back: bool) -> Path | None:
    stem = f"{card_id}_back" if back else str(card_id)
    matches = [
        path
        for path in IMAGES.glob(stem + ".*")
        if path.suffix.lower() in KNOWN_EXT and path.is_file() and path.stat().st_size > 0
    ]
    return matches[0] if matches else None


def image_destination(card_id: int, url: str, content_type: str, back: bool) -> Path:
    suffix = extension_for(url, content_type)
    name = f"{card_id}_back{suffix}" if back else f"{card_id}{suffix}"
    return IMAGES / name


def scrape_card(card_id: int, listed_image: str) -> dict:
    body, _ = fetch(DETAIL_URL.format(card_id=card_id), "application/json")
    payload = json.loads(body.decode())
    if payload.get("status") != 200:
        raise RuntimeError(f"card {card_id} status {payload.get('status')}")
    card = parse_modal(payload.get("contents") or "")
    card["card_id"] = card_id
    card["official_url"] = f"{BASE}/official/cards/{card_id}"
    if not card["image_url"]:
        card["image_url"] = listed_image
    if not card["image_url"]:
        raise RuntimeError(f"card {card_id} has no image")
    card["image_path"] = _ensure_image(card_id, card["image_url"], back=False)
    card["back_image_path"] = ""
    if card["back_image_url"]:
        card["back_image_path"] = _ensure_image(card_id, card["back_image_url"], back=True)
    return card


def _ensure_image(card_id: int, url: str, back: bool) -> str:
    existing = saved_image(card_id, back)
    if existing is not None:
        return existing.relative_to(ROOT).as_posix()
    data, content_type = fetch(url, "image/png,image/jpeg,image/webp,image/*,*/*")
    destination = image_destination(card_id, url, content_type, back=back)
    _write_image(destination, data, content_type, url)
    return destination.relative_to(ROOT).as_posix()


def _write_image(destination: Path, data: bytes, content_type: str, url: str) -> None:
    if destination.is_file() and destination.stat().st_size > 0:
        return
    if len(data) < 100 or not (
        data.startswith(b"\x89PNG")
        or data.startswith(b"\xff\xd8\xff")
        or data.startswith(b"GIF8")
        or (data.startswith(b"RIFF") and data[8:12] == b"WEBP")
    ):
        raise RuntimeError(f"not an image: {url} ({content_type}, {len(data)} bytes)")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".part")
    temporary.write_bytes(data)
    temporary.replace(destination)


def connect() -> sqlite3.Connection:
    DATA.mkdir(parents=True, exist_ok=True)
    IMAGES.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS cards (
            card_id INTEGER PRIMARY KEY,
            name TEXT,
            card_type TEXT,
            attributes TEXT,
            effect_text TEXT,
            flavor_text TEXT,
            power TEXT,
            hit TEXT,
            cost TEXT,
            illustrator TEXT,
            set_name TEXT,
            rarity TEXT,
            image_path TEXT,
            back_image_path TEXT,
            image_url TEXT,
            back_image_url TEXT,
            is_territory INTEGER,
            is_unit INTEGER,
            is_action INTEGER,
            is_ace INTEGER,
            is_buster INTEGER,
            is_shot INTEGER,
            tags TEXT,
            effects_json TEXT,
            card_group_id INTEGER,
            same_card_ids TEXT,
            official_url TEXT
        )
        """
    )
    return connection


COLUMNS = (
    "card_id",
    "name",
    "card_type",
    "attributes",
    "effect_text",
    "flavor_text",
    "power",
    "hit",
    "cost",
    "illustrator",
    "set_name",
    "rarity",
    "image_path",
    "back_image_path",
    "image_url",
    "back_image_url",
    "is_territory",
    "is_unit",
    "is_action",
    "is_ace",
    "is_buster",
    "is_shot",
    "tags",
    "effects_json",
    "card_group_id",
    "same_card_ids",
    "official_url",
)


def upsert(connection: sqlite3.Connection, card: dict) -> None:
    placeholders = ", ".join("?" for _ in COLUMNS)
    assignments = ", ".join(f"{column}=excluded.{column}" for column in COLUMNS if column != "card_id")
    connection.execute(
        f"""
        INSERT INTO cards ({", ".join(COLUMNS)})
        VALUES ({placeholders})
        ON CONFLICT(card_id) DO UPDATE SET {assignments}
        """,
        [card.get(column) for column in COLUMNS],
    )
    connection.commit()


def is_complete(connection: sqlite3.Connection, card_id: int) -> bool:
    row = connection.execute(
        "SELECT image_path, back_image_path FROM cards WHERE card_id = ?",
        (card_id,),
    ).fetchone()
    if row is None or not row[0]:
        return False
    paths = [row[0]]
    if row[1]:
        paths.append(row[1])
    for relative in paths:
        path = ROOT / relative
        if not path.is_file() or path.stat().st_size == 0:
            return False
    return True


def scrape_with_retries(card_id: int, image_url: str) -> dict:
    last_error: Exception | None = None
    for attempt in range(CARD_ATTEMPTS):
        try:
            return scrape_card(card_id, image_url)
        except Exception as exc:
            last_error = exc
            time.sleep(min(20, 2**attempt))
    raise RuntimeError(f"card {card_id}: {last_error}")


def pending_cards(connection: sqlite3.Connection, listed: dict[int, str], limit: int | None) -> list[tuple[int, str]]:
    ordered = sorted(listed)
    if limit is not None:
        ordered = ordered[:limit]
    return [(card_id, listed[card_id]) for card_id in ordered if not is_complete(connection, card_id)]


def run(limit: int | None) -> int:
    connection = connect()
    listed, total = list_cards()
    todo = pending_cards(connection, listed, limit)
    print(f"search total={total} listed={len(listed)} pending={len(todo)}", flush=True)
    failures: list[tuple[int, str]] = []
    target = len(listed) if limit is None else min(limit, len(listed))
    saved = target - len(todo)
    if todo:
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futures = {pool.submit(scrape_with_retries, card_id, image_url): card_id for card_id, image_url in todo}
            for future in as_completed(futures):
                card_id = futures[future]
                try:
                    card = future.result()
                except Exception as exc:
                    failures.append((card_id, str(exc)))
                    print(f"FAIL {card_id}: {exc}", flush=True)
                    continue
                upsert(connection, card)
                saved += 1
                if saved % 25 == 0 or saved == target:
                    print(f"[{saved}/{target}] saved {card['name']}", flush=True)
    stored = connection.execute("SELECT COUNT(*) FROM cards").fetchone()[0]
    missing_path = connection.execute(
        "SELECT COUNT(*) FROM cards WHERE image_path IS NULL OR image_path = ''"
    ).fetchone()[0]
    print(f"stored={stored} missing_image_path={missing_path} failures={len(failures)}", flush=True)
    if failures:
        for card_id, message in failures:
            print(f"  {card_id}: {message}", flush=True)
        return 1
    expected = target
    if total is not None and limit is None and len(listed) != total:
        print(f"listed {len(listed)} but search reported {total}", flush=True)
        return 1
    if stored < expected or missing_path:
        return 1
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Download Build Divide cards into images/ and data/cards.db")
    parser.add_argument("--limit", type=int, default=None, help="Only process the first N listed cards")
    args = parser.parse_args()
    sys.exit(run(args.limit))


if __name__ == "__main__":
    main()
