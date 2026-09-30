/**
 * Official Vineyard City service links and contacts shown as action bubbles under answers.
 * Sources: vineyardutah.gov/contact, /government/city_staff.php, /services/utility_billing.php
 * and the city's Report a Concern page. Verified September 30, 2026.
 */
export const SERVICES_VERIFIED = '2026-09-30';

export interface ServiceLink {
  label: string;
  href: string;
  /** Shown under the label in the bubble. */
  hint?: string;
  kind: 'form' | 'pay' | 'call' | 'mail' | 'page' | 'map';
}

export const CITY_HALL = { address: '125 S Main St, Vineyard, UT 84059', hours: 'Mon to Thu 8am to 5pm, Fri 8am to noon', phone: '801-226-1929' };

export const LINKS = {
  concern: { label: 'Report a concern', hint: 'Code enforcement form', href: 'https://app.civicreview.com/application/667487294bec393f66faf4f6', kind: 'form' },
  streetlight: { label: 'Report a streetlight out', hint: 'Streetlight map', href: 'https://bandm.maps.arcgis.com/apps/webappviewer/index.html?id=bb3aa3ee38ed410a8f7185bd332e8500', kind: 'form' },
  payBill: { label: 'Pay utility bill', hint: 'Xpress Bill Pay', href: 'https://www.xpressbillpay.com/', kind: 'pay' },
  billing: { label: 'Utility billing', hint: 'Rates, autopay, questions', href: 'https://www.vineyardutah.gov/services/utility_billing.php', kind: 'page' },
  startService: { label: 'Start service', href: 'https://www.vineyardutah.gov/services/apply_for_service.php', kind: 'form' },
  stopService: { label: 'Stop service', href: 'https://www.vineyardutah.gov/services/termination_request.php', kind: 'form' },
  permits: { label: 'Permits and inspections', hint: 'CityInspect portal', href: 'https://vineyard.cityinspect.com/login', kind: 'form' },
  cityHall: { label: 'Call City Hall', hint: CITY_HALL.phone, href: 'tel:+18012261929', kind: 'call' },
  staff: { label: 'City staff directory', href: 'https://www.vineyardutah.gov/government/city_staff.php', kind: 'page' },
  contact: { label: 'Contact the city', hint: 'Address and hours', href: 'https://www.vineyardutah.gov/contact/index.php', kind: 'page' },
  police: { label: 'Non-emergency police', hint: '801-798-5600', href: 'tel:+18017985600', kind: 'call' },
  fire: { label: 'Non-emergency fire and EMS', hint: '801-229-7070', href: 'tel:+18012297070', kind: 'call' },
  power: { label: 'Rocky Mountain Power', hint: '888-221-7070', href: 'tel:+18882217070', kind: 'call' },
  gas: { label: 'Dominion Energy', hint: '800-323-5517', href: 'tel:+18003235517', kind: 'call' },
} satisfies Record<string, ServiceLink>;

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
  { name: 'Kelly Kloepfer', title: 'Business Licensing', match: /\bbusiness licen/i, phone: '801-226-1929' },
  { name: 'Janice Green', title: 'Utility Billing Clerk', match: /\butility billing\b/i, phone: '801-226-1929' },
];
