"use client";

import { facetValue, ROLES, type CardQuery, type Facets } from "@/lib/query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ChangeEvent, ReactNode } from "react";

function withCurrent(options: string[], current: string): string[] {
  if (!current || options.includes(current)) return options;
  return [current, ...options];
}

export function Filters({ query, facets }: { query: CardQuery; facets: Facets }) {
  const router = useRouter();
  const active = Boolean(
    query.q || query.type || query.rarity || query.set || query.attribute || query.roles.length,
  );
  const selectedType = facetValue(query.type, facets.typeLabels);
  const selectedSet = facetValue(query.set, facets.setLabels);
  const selectedAttribute = facetValue(query.attribute, facets.attributeLabels);

  function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    const params = new URLSearchParams();
    for (const [key, value] of data.entries()) {
      if (typeof value !== "string") continue;
      const trimmed = value.trim();
      if (!trimmed) continue;
      params.append(key, trimmed);
    }
    const qs = params.toString();
    router.push(qs ? `/?${qs}` : "/", { scroll: false });
  }

  function onChoice(event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const form = event.currentTarget.form;
    if (!form) return;
    if (event.currentTarget instanceof HTMLInputElement && event.currentTarget.name === "q") return;
    submit(form);
  }

  return (
    <form
      action="/"
      method="get"
      onSubmit={(event) => {
        event.preventDefault();
        submit(event.currentTarget);
      }}
      className="grid gap-4 rounded-sm border border-line bg-mat p-4"
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="flex-1">
          <span className="mb-1 block text-[0.7rem] tracking-[0.16em] text-mist uppercase">Search</span>
          <input
            name="q"
            defaultValue={query.q}
            placeholder="Name, effect, type, attribute, set, cost, illustrator, or card id"
            className="w-full border border-line bg-deep px-3 py-2 text-stock placeholder:text-mist/50"
          />
        </label>
        <button
          type="submit"
          className="self-end bg-gold px-4 py-2 font-display text-lg tracking-[0.12em] text-ink uppercase"
        >
          Search
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Type">
          <select
            name="type"
            defaultValue={selectedType}
            onChange={onChoice}
            className="w-full border border-line bg-deep px-2 py-2 text-stock"
          >
            <option value="">Any type</option>
            {withCurrent(facets.types, selectedType).map((type) => (
              <option key={type} value={type}>
                {facets.typeLabels[type] || type}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Rarity">
          <select
            name="rarity"
            defaultValue={query.rarity}
            onChange={onChoice}
            className="w-full border border-line bg-deep px-2 py-2 text-stock"
          >
            <option value="">Any rarity</option>
            {withCurrent(facets.rarities, query.rarity).map((rarity) => (
              <option key={rarity} value={rarity}>
                {rarity}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Set">
          <select
            name="set"
            defaultValue={selectedSet}
            onChange={onChoice}
            className="w-full border border-line bg-deep px-2 py-2 text-stock placeholder:text-mist/50"
          >
            <option value="">Any set</option>
            {withCurrent(facets.sets, selectedSet).map((set) => (
              <option key={set} value={set}>{facets.setLabels[set] || set}</option>
            ))}
          </select>
        </Field>
        <Field label="Attribute">
          <select
            name="attribute"
            defaultValue={selectedAttribute}
            onChange={onChoice}
            className="w-full border border-line bg-deep px-2 py-2 text-stock placeholder:text-mist/50"
          >
            <option value="">Any attribute</option>
            {withCurrent(facets.attributes, selectedAttribute).map((attribute) => (
              <option key={attribute} value={attribute}>{facets.attributeLabels[attribute] || attribute}</option>
            ))}
          </select>
        </Field>
      </div>

      <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
        <legend className="mb-2 text-[0.7rem] tracking-[0.16em] text-mist uppercase">Roles</legend>
        {ROLES.map((role) => (
          <label key={role.key} className="flex items-center gap-2 text-sm text-stock">
            <input
              type="checkbox"
              name="role"
              value={role.key}
              defaultChecked={query.roles.includes(role.key)}
              onChange={onChoice}
            />
            {role.label}
          </label>
        ))}
        {active ? (
          <Link href="/" className="ml-auto text-sm text-gold underline-offset-2 hover:underline">
            Clear filters
          </Link>
        ) : null}
      </fieldset>
    </form>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label>
      <span className="mb-1 block text-[0.7rem] tracking-[0.16em] text-mist uppercase">{label}</span>
      {children}
    </label>
  );
}
