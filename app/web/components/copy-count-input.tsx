"use client";

import { useEffect, useId, useState } from "react";
import { useDecks } from "@/components/deck-provider";

type Draft = { text: string; committedValue: number; resetVersion: string; invalid: boolean };

export function CopyCountInput({ cardId, name, value, disabled, resetVersion }: {
  cardId: number;
  name: string;
  value: number;
  disabled: boolean;
  resetVersion: string;
}) {
  const { setSelectedQuantity, setSelectionInvalid } = useDecks();
  const errorId = useId();
  const [draft, setDraft] = useState<Draft>({ text: String(value), committedValue: value, resetVersion, invalid: false });

  // Own valid edits already record their committed value, so typing preserves
  // the draft. External selection changes and explicit clears reset it.
  if (draft.committedValue !== value || draft.resetVersion !== resetVersion) {
    setDraft({ text: String(value), committedValue: value, resetVersion, invalid: false });
  }

  useEffect(() => {
    // Activity preserves drafts while hidden, but disconnects effects. Restore
    // the add-block whenever this catalog becomes active again.
    setSelectionInvalid(cardId, draft.invalid);
    return () => setSelectionInvalid(cardId, false);
  }, [cardId, draft.invalid, setSelectionInvalid]);

  function edit(text: string) {
    const quantity = Number(text);
    const valid = /^\d+$/.test(text) && Number.isSafeInteger(quantity) && quantity >= 0;
    setDraft({ text, committedValue: valid ? quantity : value, resetVersion, invalid: !valid });
    setSelectionInvalid(cardId, !valid);
    if (valid) setSelectedQuantity(cardId, quantity);
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center justify-between gap-2">
        Copies
        <input
          type="text"
          inputMode="numeric"
          value={draft.text}
          disabled={disabled}
          aria-label={`Copies of ${name}`}
          aria-invalid={draft.invalid}
          aria-describedby={draft.invalid ? errorId : undefined}
          onChange={(event) => edit(event.target.value)}
          className={`min-h-9 w-16 min-w-0 border bg-deep px-2 text-stock ${draft.invalid ? "border-gold" : "border-line"}`}
        />
      </label>
      {draft.invalid ? (
        <p id={errorId} role="alert" className="text-xs text-gold">
          Enter a whole number from 0 to {Number.MAX_SAFE_INTEGER}. This edit has not been applied.
        </p>
      ) : null}
    </div>
  );
}
