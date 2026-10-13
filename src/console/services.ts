/**
 * Official Vineyard City service links and contacts shown as action bubbles under answers. The lists live in
 * src/lib/cityServices.ts, shared with the staff editor and the worker; staff changes come from /api/content (useCityServices).
 */
export { CITY_HALL, LINKS, SERVICES_VERIFIED, type ServiceLink } from '@/lib/cityServices';

/** Staff as listed on the city's staff directory. Emails only where the city publishes them. */
export interface StaffContact {
  name: string;
  title: string;
  match: RegExp;
  email?: string;
  phone?: string;
}

export const STAFF: StaffContact[] = [
  { name: 'Brian Voeks', title: 'City Manager', match: /\bcity manager\b/i },
  { name: 'Robin Raines-Bond', title: 'City Recorder', match: /\b(city )?recorder\b|\bgrama\b|records request/i },
  { name: 'Tony Lara', title: 'Deputy Recorder', match: /\bdeputy recorder\b|\bgrama\b|records request/i, phone: '385-432-7214' },
  { name: 'Evan Smith', title: 'Finance Director', match: /\bfinance director\b|\bfinance department\b/i, email: 'evans@vineyardutah.gov' },
  { name: 'Naseem Ghandour', title: 'Public Works and Engineering Director', match: /\bpublic works\b|\bcity engineer|engineering director/i, phone: '801-226-1929' },
  { name: 'Cris Johnson', title: 'Chief Building Official', match: /\bbuilding official\b|\bbuilding department\b|\bbuilding inspect/i, phone: '801-226-1929' },
  { name: 'Brian Vawdrey', title: 'Parks and Recreation Director', match: /\bparks (and|&) rec|\brecreation director\b/i },
  { name: 'Brailee Tyler', title: 'Communications and Media Specialist', match: /\bcommunications?\b|\bmedia\b|\bpress\b/i, email: 'braileet@vineyardutah.gov' },
  { name: 'Ed Kennedy', title: 'Code Enforcement Officer', match: /\b(code enforcement|noise|noisy|loud|nuisance|barking|weeds?|junk|complain(t|ts)? about)\b/i, phone: '801-226-1929' },
  { name: 'Kelly Kloepfer', title: 'Business Licensing', match: /\bbusiness licen/i, phone: '801-226-1929' },
  { name: 'Janice Green', title: 'Utility Billing Clerk', match: /\butility billing\b/i, phone: '801-226-1929' },
];
