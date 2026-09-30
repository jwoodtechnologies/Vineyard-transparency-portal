import {
  BookOpenText,
  Calculator,
  CalendarDays,
  ClipboardList,
  FileBadge,
  FileCheck2,
  FileSignature,
  FileText,
  Gavel,
  Handshake,
  Landmark,
  Map,
  Megaphone,
  MessageSquareText,
  Presentation,
  ScrollText,
  SearchCheck,
  ShoppingCart,
  type LucideIcon,
} from 'lucide-react';
import type { DocumentType } from '@/types/models';
import { cn } from '@/lib/cn';

const ICONS: Partial<Record<DocumentType, LucideIcon>> = {
  agenda: ClipboardList,
  agenda_packet: BookOpenText,
  minutes: FileCheck2,
  ordinance: Gavel,
  resolution: ScrollText,
  proclamation: FileBadge,
  contract: FileSignature,
  development_agreement: Handshake,
  interlocal_agreement: Handshake,
  professional_services_agreement: FileSignature,
  procurement: ShoppingCart,
  staff_report: FileText,
  financial_report: Calculator,
  budget: Calculator,
  audit: SearchCheck,
  public_notice: Megaphone,
  map: Map,
  study: FileText,
  plan: Landmark,
  presentation: Presentation,
  transcript: MessageSquareText,
  municipal_code: Landmark,
};

export function DocTypeIcon({ type, className }: { type: DocumentType; className?: string }) {
  const Icon = ICONS[type] ?? FileText;
  return <Icon className={cn('size-4', className)} aria-hidden />;
}

export function MeetingIcon({ className }: { className?: string }) {
  return <CalendarDays className={cn('size-4', className)} aria-hidden />;
}
