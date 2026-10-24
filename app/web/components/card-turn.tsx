"use client";

import Image from "next/image";
import { useState } from "react";

export function CardTurn({
  name,
  front,
  back,
}: {
  name: string;
  front: string;
  back: string;
}) {
  const [showBack, setShowBack] = useState(false);
  const showingBack = showBack && Boolean(back);
  const src = showingBack ? back : front;

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-[63/88] bg-[#ddd6c8] shadow-[0_16px_40px_rgba(0,0,0,0.35)]">
        {src ? (
          <Image
            src={src}
            alt={showingBack ? `${name} back` : name}
            fill
            sizes="(max-width: 768px) 80vw, 320px"
            className="object-contain"
            priority
          />
        ) : null}
      </div>
      {back ? (
        <button
          type="button"
          onClick={() => setShowBack((value) => !value)}
          className="border border-gold px-3 py-2 font-display text-lg tracking-[0.12em] text-gold uppercase"
        >
          {showingBack ? "Show front" : "Show back"}
        </button>
      ) : null}
    </div>
  );
}
