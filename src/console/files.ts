/**
 * Links to a record's own file. A PDF opens as the real PDF in a new tab (the browser's own viewer,
 * at the right page), never an in-app text view that only looks like a file.
 */
export const pdfHref = (id: string, page?: number | null): string => `/api/documents/${encodeURIComponent(id)}/file${page && page > 1 ? `#page=${page}` : ''}`;

export const isPdf = (mime: string | null | undefined): boolean => /^application\/pdf/i.test(mime ?? '');

/** Attributes for a link that opens a file in a new tab. */
export const NEW_TAB = { target: '_blank', rel: 'noopener noreferrer' } as const;
