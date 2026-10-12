import { useEffect, useState } from 'react';
import { staff } from './api';
import type { MeetingOption } from './recordsLib';

/** Recent and upcoming meetings, loaded once per screen. */
export function useMeetings(): MeetingOption[] {
  const [items, setItems] = useState<MeetingOption[]>([]);
  useEffect(() => {
    let live = true;
    staff<{ items: MeetingOption[] }>('/records/meetings').then(
      (r) => live && setItems(r.items),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  return items;
}
