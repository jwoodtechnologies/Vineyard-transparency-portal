import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { config } from '@/config/env';
import { PageHeader } from '@/components/layout/PageHeader';
import { useApp } from '@/app/AppContext';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

const TOC = [
  ['what-this-is', 'What this is'],
  ['independence', 'Independence'],
  ['how-records-are-discovered', 'How records are discovered'],
  ['how-archiving-works', 'How archiving works'],
  ['archived-vs-original', 'Archived copies vs. original sources'],
  ['how-ai-answers-work', 'How AI answers work'],
  ['why-citations-matter', 'Why citations matter'],
  ['current-vs-historical', 'Current vs. historical records'],
  ['privacy', 'Privacy'],
  ['public-record-safety', 'Public-record safety'],
  ['errors', 'Reporting errors'],
] as const;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-24 border-b border-line py-8 first:pt-0 last:border-b-0">
      <h2 id={`${id}-h`} className="font-serif text-[1.4rem] font-semibold tracking-[-0.01em]">
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-[15.5px] leading-[1.75] text-muted [&_strong]:text-fg">{children}</div>
    </section>
  );
}

export default function AboutPage() {
  useDocumentTitle('About');
  const { openReport } = useApp();
  return (
    <>
      <PageHeader
        eyebrow="About"
        title="Public records, without the treasure hunt"
        description="The Vineyard Transparency Portal makes publicly available Vineyard records easier to search, understand, browse, cite, and retrieve."
      />
      <div className="container-page grid gap-12 py-10 lg:grid-cols-[220px_1fr]">
        <nav aria-label="On this page" className="hidden lg:block">
          <ul className="sticky top-24 space-y-1 text-sm">
            {TOC.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="block rounded-md px-2 py-1 text-subtle hover:bg-raised hover:text-fg">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <article className="max-w-3xl">
          <Section id="what-this-is" title="What this is">
            <p>
              The portal is a public-records archive, a search engine, and a research interface for records concerning Vineyard, Utah. A resident should not need to know which
              department created a record, which meeting it came from, which state or city system hosts it, or which page of a 400-page agenda packet it is buried in. Ask a
              question or search, and the portal finds the records and shows the evidence.
            </p>
            <p>
              <strong>The archive is the authority. AI is the interface.</strong> If every AI system disappeared tomorrow, search, browsing, documents, meetings, and sources
              would keep working.
            </p>
          </Section>
          <Section id="independence" title="Independence">
            <p>{config.disclaimer}</p>
            <p>
              The portal does not use an official city seal or imitate the official city website. Officials, staff, residents, journalists, and researchers are all welcome to use
              it.
            </p>
          </Section>
          <Section id="how-records-are-discovered" title="How records are discovered">
            <p>
              Discovery starts from Vineyard City’s official transparency page (
              <a href={config.primarySourceSeed} target="_blank" rel="noopener noreferrer" className="link break-all">
                {config.primarySourceSeed}
              </a>
              ). A crawler inspects every link on that page, resolves and normalizes URLs, follows redirects, and classifies what it finds: meeting portals, the Utah Public Notice
              Website, financial-transparency systems, State Auditor reports, the municipal code, document libraries, and direct links to PDFs, spreadsheets, and other files.
            </p>
            <p>
              It follows only documents linked from approved pages, public-record systems in the reviewed source registry, and their relevant child pages. It never follows social
              media, advertising, or unrelated sites. See <Link to="/sources" className="link">record sources</Link>.
            </p>
          </Section>
          <Section id="how-archiving-works" title="How archiving works">
            <p>
              A link is not an archive. Where a record may lawfully be copied, the portal preserves the original file together with its original URL, retrieval date, file name,
              format, size, a SHA-256 checksum, the extracted text, metadata, and its relationships to other records.
            </p>
            <p>
              Duplicate copies (for example, the same agenda posted to two systems) are recognized by checksum and metadata and kept as one canonical record, with every source
              reference preserved. When a source replaces a file, the new file becomes a new version; earlier versions are not silently overwritten. Scanned records are processed
              with OCR, and OCR text is labeled because it can contain errors.
            </p>
          </Section>
          <Section id="archived-vs-original" title="Archived copies vs. original sources">
            <p>
              Each document shows both an <strong>archived copy</strong> and its <strong>original government source</strong> where both exist. The original source is the
              authority. The archived copy lets a record remain searchable if a government website changes or removes it — but it is not an official or certified copy.
            </p>
          </Section>
          <Section id="how-ai-answers-work" title="How AI answers work">
            <p>
              When you ask a question, the portal analyzes it, retrieves relevant passages using both exact full-text search (critical for ordinance numbers, addresses, names, and
              vendors) and meaning-based search, validates the passages, and then composes an answer that cites them. Every factual statement links to the record and page it
              comes from.
            </p>
            <p>
              The AI never invents records, numbers, votes, quotes, dates, or amounts. If the indexed records do not support an answer, it says: “I could not verify that from the
              records currently indexed in the Vineyard Transparency Portal.” Text inside documents is treated only as evidence — never as instructions to the AI.
            </p>
            <p>If AI answers are unavailable (for example, a free quota is exhausted), the portal shows archive search results instead and stops calling the AI service for a while.</p>
          </Section>
          <Section id="why-citations-matter" title="Why citations matter">
            <p>
              A citation lets anyone check the answer against the record itself. Click a citation number to see the excerpt, the page, the meeting and agenda item, and links to
              the archived copy and the original source. If a citation is wrong, please report it.
            </p>
          </Section>
          <Section id="current-vs-historical" title="Current vs. historical records">
            <p>
              A 2022 ordinance may have been amended since. The portal labels records as <strong>current</strong>, <strong>historical</strong>, <strong>superseded</strong>, or{' '}
              <strong>amended</strong>, and never presents superseded ordinance language as the current municipal code.
            </p>
          </Section>
          <Section id="privacy" title="Privacy">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>No accounts, sign-up, login, email collection, or profiles.</li>
              <li>No advertising, behavioral profiling, or sale of data. No tracking cookies.</li>
              <li>
                Your recent questions, searches, and saved items are stored only in your browser on this device. You can remove them or turn history off on the{' '}
                <Link to="/saved" className="link">
                  Saved
                </Link>{' '}
                page.
              </li>
              <li>Questions are sent to the archive to be answered but are not stored as personal search profiles.</li>
            </ul>
          </Section>
          <Section id="public-record-safety" title="Public-record safety">
            <p>
              A document being public does not mean every detail in it should be amplified. The portal preserves records accurately but does not build profiles or dossier pages
              about private individuals. Subject pages focus on public bodies, projects, developments, streets, public programs, and organizations relevant to public records.
            </p>
          </Section>
          <Section id="errors" title="Reporting errors">
            <p>
              Every document and every answer has a “Report an issue” option for broken documents, incorrect metadata, wrong citations, inaccurate answers, missing or duplicate
              records. Reports collect no personal information.
            </p>
            <p>
              <button onClick={() => openReport({})} className="link">
                Report an issue
              </button>
            </p>
          </Section>
        </article>
      </div>
    </>
  );
}
