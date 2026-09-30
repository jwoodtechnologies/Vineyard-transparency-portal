import { useNavigate } from 'react-router-dom';
import { FileQuestion } from 'lucide-react';
import { AskBox } from '@/components/ask/AskBox';
import { ButtonLink } from '@/components/ui/Button';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { askPath, searchPath } from '@/lib/searchParams';

export default function NotFoundPage() {
  useDocumentTitle('Page not found');
  const navigate = useNavigate();
  return (
    <div className="container-page flex max-w-2xl flex-1 flex-col items-center justify-center py-20 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-raised text-subtle">
        <FileQuestion className="size-6" aria-hidden />
      </span>
      <p className="eyebrow mt-5">404</p>
      <h1 className="mt-2 font-serif text-3xl font-semibold">This page isn’t in the archive</h1>
      <p className="mt-3 text-muted">The link may be mistyped or out of date. Records keep permanent links, so try searching for what you were looking for.</p>
      <AskBox className="mt-8 w-full text-left" size="md" onSubmit={(v, mode) => navigate(mode === 'ask' ? askPath(v) : searchPath({ query: v }))} />
      <div className="mt-6 flex gap-2">
        <ButtonLink to="/">Home</ButtonLink>
        <ButtonLink to="/documents">All documents</ButtonLink>
      </div>
    </div>
  );
}
