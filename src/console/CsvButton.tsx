import { Download } from 'lucide-react';
import { downloadCsv, type CsvValue } from './csv';

/** "Download CSV": builds the file from rows the page already has, only when tapped. */
export function CsvButton({ filename, rows, className }: { filename: string; rows: () => CsvValue[][]; className?: string }) {
  return (
    <button type="button" className={`vc-csv${className ? ` ${className}` : ''}`} onClick={() => downloadCsv(filename, rows())}>
      <Download size={14} strokeWidth={1.9} aria-hidden="true" />
      Download CSV
    </button>
  );
}
