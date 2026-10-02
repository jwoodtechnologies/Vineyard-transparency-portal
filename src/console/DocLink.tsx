import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { NEW_TAB, isPdf, pdfHref } from './files';

interface Props extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'children'> {
  id: string;
  /** The record's file type, when known. A PDF opens as the PDF; anything else opens in the portal. */
  mime?: string | null;
  /** Page to open the PDF at. */
  page?: number | null;
  /** Search words, kept only when the record opens in the portal's own reader. */
  query?: string;
  children: ReactNode;
}

/**
 * A link to one record. Anything that looks like a file opens as the real file, in a new tab, so a tap on
 * "Agenda" or "Minutes" shows the PDF itself and not a text view inside the app. A record that is not a file
 * (a web page, a code section) opens in the portal. With no mime type given it is treated as a PDF.
 */
export function DocLink({ id, mime, page, query, children, ...rest }: Props) {
  const pdf = mime == null ? true : isPdf(mime);
  if (pdf) {
    return (
      <a {...rest} href={pdfHref(id, page)} {...NEW_TAB}>
        {children}
      </a>
    );
  }
  const qs = new URLSearchParams();
  if (page && page > 1) qs.set('page', String(page));
  if (query) qs.set('q', query);
  return (
    <Link {...rest} to={`/documents/${encodeURIComponent(id)}${qs.size ? `?${qs.toString()}` : ''}`}>
      {children}
    </Link>
  );
}
