/* eslint-disable react-refresh/only-export-components -- the card and its shared vote labels */
/** One recorded vote as a card (the answer view and the voting pages). Its own chunk, so the home page loads it only with an answer that has votes. */
import { FileText } from 'lucide-react';
import { DocLink } from './DocLink';
import { motionDetail, motionLabel, motionTally, memberTitle, recordedMotion, useMemberNames, type MotionRow } from './votes';

export const VOTE_LABEL: Record<string, string> = {
  yes: 'Yes',
  no: 'No',
  abstain: 'Abstained',
  recused: 'Recused',
  absent: 'Absent',
};
export const ORDER: Record<string, number> = {
  yes: 0,
  no: 1,
  abstain: 2,
  recused: 3,
  absent: 4,
};

/**
 * One vote: what it was on, how it ended, and each member's vote. With `recorded` (answer cards),
 * the motion is worded as the minutes record it and the agenda item is shown as recorded.
 */
export function MotionCard({ m, member, recorded = false }: { m: MotionRow; member?: string | null; recorded?: boolean }) {
  const nameOf = useMemberNames();
  const outcome = m.result === 'carried' ? 'Passed' : m.result === 'failed' ? 'Failed' : 'No result recorded';
  const roll = [...m.votes]
    .filter((v) => v.vote !== 'absent')
    .sort((a, b) => (ORDER[a.vote] ?? 9) - (ORDER[b.vote] ?? 9) || nameOf(a.member).name.localeCompare(nameOf(b.member).name));
  // No names in the minutes ("passed unanimously"): the badge says so in place of the member tags.
  const unanimous = m.result === 'carried' && m.unanimous && roll.length === 0;
  // Title and last name as the people records store them ("Council Member McCumber"); last name alone when none is stored.
  const titled = (id: string) => memberTitle(nameOf(id).name, nameOf(id).person?.role);
  const label = recorded ? recordedMotion(m) : motionLabel(m);
  const detail = recorded ? (m.item ? `Agenda item: ${m.item.replace(/\s+/g, ' ').trim()}` : null) : motionDetail(m);
  return (
    <li className="vc-vt">
      <div className="vc-vt-top">
        <span className="vc-vt-what">
          <p className="vc-vt-label">{label}</p>
          {detail && <p className="vc-vt-detail">{detail}</p>}
          {m.refs.length > 0 && !/resolution|ordinance/i.test(label) && <p className="vc-vt-detail">{m.refs.join(', ')}</p>}
        </span>
        <span className="vc-vt-result" data-result={m.result}>
          {outcome}
          {motionTally(m) ? ` ${motionTally(m)}` : ''}
        </span>
      </div>
      {(m.items?.length ?? 0) > 0 && (
        <ol className="vc-vt-items">
          {m.items!.map((it) => (
            <li key={it}>{it.replace(/^(\d+\.\d+)\s+/, '$1  ')}</li>
          ))}
        </ol>
      )}
      {(roll.length > 0 || unanimous) && (
        <ul className="vc-vt-tags" aria-label="How each member voted">
          {unanimous && (
            <li data-badge="unanimous">
              <b>Unanimous</b>
            </li>
          )}
          {roll.map((v) => (
            <li key={v.member} data-vote={v.vote} data-on={member && member === v.member ? 'true' : undefined} title={`${titled(v.member)}: ${VOTE_LABEL[v.vote] ?? v.vote}`}>
              <span>{titled(v.member)}</span>
              <b>{VOTE_LABEL[v.vote] ?? v.vote}</b>
            </li>
          ))}
        </ul>
      )}
      <div className="vc-vt-foot">
        {m.tieBreak && <span className="vc-vt-meta">Mayor broke the tie</span>}
        <DocLink id={m.documentId} page={m.page} className="vc-vt-min">
          <FileText size={12} /> Minutes{m.page ? ` p. ${m.page}` : ''}
        </DocLink>
      </div>
    </li>
  );
}

export default MotionCard;
