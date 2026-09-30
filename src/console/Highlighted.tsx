import { highlightRuns } from './format';

export function Highlighted({ text, ranges }: { text: string; ranges: Array<[number, number]> }) {
  return (
    <>
      {highlightRuns(text, ranges).map((r, i) => (r.mark ? <mark key={i}>{r.text}</mark> : <span key={i}>{r.text}</span>))}
    </>
  );
}
