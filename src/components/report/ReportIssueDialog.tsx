import { useId, useState, type FormEvent } from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { IssueType } from '@/types/models';
import { useApp } from '@/app/AppContext';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { InlineNotice } from '@/components/ui/States';
import { ReportService } from '@/services';
import { cn } from '@/lib/cn';

const TYPES: Array<{ value: IssueType; label: string; hint: string }> = [
  { value: 'broken_document', label: 'Broken document', hint: 'The file won’t open, is blank, or is the wrong file.' },
  { value: 'incorrect_metadata', label: 'Incorrect metadata', hint: 'Wrong date, title, body, number, or type.' },
  { value: 'incorrect_citation', label: 'Incorrect citation', hint: 'A citation points to the wrong record or page.' },
  { value: 'incorrect_ai_summary', label: 'Incorrect AI summary', hint: 'An answer says something the records don’t support.' },
  { value: 'missing_document', label: 'Missing document', hint: 'A public record that should be here isn’t.' },
  { value: 'duplicate_record', label: 'Duplicate record', hint: 'The same record appears more than once.' },
  { value: 'other', label: 'Other', hint: 'Anything else.' },
];

export function ReportIssueDialog() {
  const { report, closeReport, dataMode } = useApp();
  const open = report !== null;
  // Remount the form for each new report so state resets without effects.
  return (
    <Dialog
      open={open}
      onClose={closeReport}
      title="Report an issue"
      description={report?.subject ? <span className="line-clamp-2">About: {report.subject}</span> : 'Help keep the archive accurate.'}
    >
      {open && <ReportForm key={JSON.stringify(report)} defaultType={report.defaultType} context={report.context} demo={dataMode === 'mock'} onDone={closeReport} />}
    </Dialog>
  );
}

function ReportForm({
  defaultType,
  context,
  demo,
  onDone,
}: {
  defaultType?: IssueType;
  context: NonNullable<ReturnType<typeof useApp>['report']>['context'];
  demo: boolean;
  onDone: () => void;
}) {
  const [type, setType] = useState<IssueType>(defaultType ?? (context.askResponseId ? 'incorrect_ai_summary' : context.documentId ? 'incorrect_metadata' : 'missing_document'));
  const [description, setDescription] = useState('');
  const [state, setState] = useState<{ status: 'idle' | 'sending' | 'sent' | 'error'; receipt?: string; error?: string }>({ status: 'idle' });
  const descId = useId();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState({ status: 'sending' });
    try {
      const receipt = await ReportService.submit({ issueType: type, description: description.trim().slice(0, 4000), context });
      setState({ status: 'sent', receipt: receipt.id });
    } catch (err) {
      setState({ status: 'error', error: err instanceof Error ? err.message : 'Could not send the report.' });
    }
  }

  if (state.status === 'sent') {
    return (
      <div className="py-6 text-center">
        <CheckCircle2 className="mx-auto size-10 text-ok" aria-hidden />
        <p className="mt-3 font-semibold">Thank you — report received.</p>
        <p className="mt-1 text-sm text-muted">
          Reference <span className="font-mono">{state.receipt}</span>
          {demo && '. Demo mode: reports are not sent anywhere.'}
        </p>
        <Button className="mt-6" onClick={onDone}>
          Close
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <fieldset>
        <legend className="text-sm font-medium">What kind of issue?</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {TYPES.map((t) => (
            <label
              key={t.value}
              className={cn(
                'flex cursor-pointer gap-2.5 rounded-lg border p-3 text-sm transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent',
                type === t.value ? 'border-accent bg-accent-soft' : 'border-line hover:bg-raised',
              )}
            >
              <input type="radio" name="issue-type" value={t.value} checked={type === t.value} onChange={() => setType(t.value)} className="mt-0.5 accent-[var(--vtp-accent)]" />
              <span>
                <span className="block font-medium">{t.label}</span>
                <span className="block text-xs text-subtle">{t.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor={descId} className="text-sm font-medium">
          Details <span className="font-normal text-subtle">(optional)</span>
        </label>
        <textarea
          id={descId}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={4000}
          rows={4}
          className="mt-1.5 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
          placeholder="What’s wrong, and where? A page number or the correct value helps."
        />
        <p className="mt-1.5 text-xs text-subtle">Please don’t include personal information. No account, email, or contact details are collected.</p>
      </div>
      {state.status === 'error' && <InlineNotice tone="danger">{state.error}</InlineNotice>}
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={state.status === 'sending'}>
          {state.status === 'sending' ? 'Sending…' : 'Send report'}
        </Button>
      </div>
    </form>
  );
}
