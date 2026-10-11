import { Download } from 'lucide-react';
import { CSV_BOM, toCsv, type CsvValue } from './csv';

function downloadCsv(filename: string, rows: CsvValue[][]): void {
  const blob = new Blob([CSV_BOM + toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1000);
}


/** "Download CSV": builds the file from rows the page already has, only when tapped. */
export function CsvButton({ filename, rows, className }: { filename: string; rows: () => CsvValue[][]; className?: string }) {
  return (
    <button type="button" className={`vc-csv${className ? ` ${className}` : ''}`} onClick={() => downloadCsv(filename, rows())}>
      <Download size={14} strokeWidth={1.9} aria-hidden="true" />
      Download CSV
    </button>
  );
}
