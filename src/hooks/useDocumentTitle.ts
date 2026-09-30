import { useEffect } from 'react';

export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    const base = 'Vineyard Transparency Portal';
    document.title = title ? `${title} · ${base}` : base;
  }, [title]);
}
