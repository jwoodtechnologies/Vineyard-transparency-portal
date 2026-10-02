import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { docHref } from './files';

interface Props extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'children'> {
  id: string;
  /** Page to open at. */
  page?: number | null;
  /** Search words to highlight in the reader. */
  query?: string;
  children: ReactNode;
}

/** A link to one record, opened in the portal's own viewer (the PDF itself, at the page when there is one). */
export function DocLink({ id, page, query, children, ...rest }: Props) {
  return (
    <Link {...rest} to={docHref(id, page, query)}>
      {children}
    </Link>
  );
}
