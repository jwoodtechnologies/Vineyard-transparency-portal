/** Filter chips over search results: the record types, bodies and years the results hold (from the search's own facets). */
interface Bucket {
  value: string;
  label: string;
  count: number;
}
export interface ChipFacets {
  documentTypes?: Bucket[];
  years?: Bucket[];
  governmentBodies?: Bucket[];
}

type Patch = Record<string, string | null>;

export function ResultChips({
  facets,
  allowedTypes,
  type,
  year,
  body,
  onPick,
}: {
  facets: ChipFacets;
  /** Types the current category allows (null: any). */
  allowedTypes: string[] | null;
  type: string;
  year: string;
  body: string;
  onPick: (patch: Patch) => void;
}) {
  const types = (facets.documentTypes ?? []).filter((b) => !allowedTypes || allowedTypes.includes(b.value)).slice(0, 6);
  const bodies = (facets.governmentBodies ?? []).slice(0, 5);
  const years = [...(facets.years ?? [])].sort((a, b) => b.value.localeCompare(a.value)).slice(0, 6);
  const groups: Array<{ label: string; key: 't' | 'b' | 'y'; on: string; list: Bucket[] }> = [
    { label: 'Type', key: 't', on: type, list: types },
    { label: 'Body', key: 'b', on: body, list: bodies },
    { label: 'Year', key: 'y', on: year, list: years },
  ];
  const shown = groups.filter((g) => g.list.length > 1 || (g.on && g.list.length > 0));
  if (!shown.length) return null;
  return (
    <>
      {shown.map((g) => (
        <div key={g.key} className="vc-rec-chips" role="group" aria-label={`Filter by ${g.label.toLowerCase()}`}>
          <span className="vc-rec-chips-label">{g.label}</span>
          {g.list.map((b) => (
            <button key={b.value} type="button" className="vc-chip" data-active={g.on === b.value} aria-pressed={g.on === b.value} onClick={() => onPick({ [g.key]: g.on === b.value ? null : b.value })}>
              {b.label} <span>{b.count.toLocaleString()}</span>
            </button>
          ))}
        </div>
      ))}
    </>
  );
}
