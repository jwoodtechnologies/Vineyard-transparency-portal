import { Field } from './ui';
import { meetingLabel, type MeetingOption, type RecordType } from './recordsLib';

export function TypeSelect({ value, onChange, types }: { value: string; onChange: (v: string) => void; types: RecordType[] }) {
  return (
    <Field label="Type of record">
      {(id) => (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          {types.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/** The meeting a record belongs to; it then shows on that meeting's page. A meeting already chosen stays listed even if it is older than the list. */
export function MeetingSelect({ value, onChange, meetings, current }: { value: string; onChange: (v: string) => void; meetings: MeetingOption[]; current?: { id: string; label: string } | null }) {
  const extra = current && value === current.id && !meetings.some((m) => m.id === current.id) ? current : null;
  return (
    <Field label="Meeting" hint="Optional. Pick the meeting this belongs to and it will show on that meeting's page.">
      {(id) => (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Not tied to a meeting</option>
          {extra && <option value={extra.id}>{extra.label}</option>}
          {meetings.map((m) => (
            <option key={m.id} value={m.id}>
              {meetingLabel(m)}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}
