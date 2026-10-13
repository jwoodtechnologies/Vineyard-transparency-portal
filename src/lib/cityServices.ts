/**
 * The city service links and contact numbers the portal ships with, shared by the public pages, the staff editor and the
 * worker. Staff changes are stored apart (site_content keys "services" and "contacts") and laid over these lists by
 * servicesFrom and contactsFrom, so the built-in lists below stay the original to go back to.
 *
 * Quick links and phone numbers: vineyardutah.gov/contact, /government/city_staff.php, /services/utility_billing.php and the
 * city's Report a Concern page, verified September 30, 2026. Service directory: every service, form, portal and report linked
 * from the city's own Transparency Portal and site menus (vineyardutah.gov/transparency_portal, checked October 1, 2026).
 */

export const SERVICES_VERIFIED = '2026-09-30';

export interface ServiceLink {
  label: string;
  href: string;
  /** Shown under the label in the bubble. */
  hint?: string;
  kind: 'form' | 'pay' | 'call' | 'mail' | 'page' | 'map';
  /** A page inside the portal. */
  internal?: boolean;
}

export const CITY_HALL = { address: '125 S Main St, Vineyard, UT 84059', hours: 'Mon to Thu 8am to 5pm, Fri 8am to noon', phone: '801-226-1929' };

/** A phone link for a number as the city writes it ("801-226-1929"). */
export const telHref = (phone: string): string => `tel:+1${phone.replace(/\D/g, '').slice(-10)}`;

export const LINKS = {
  concern: { label: 'Report a concern', hint: 'Code enforcement form', href: 'https://app.civicreview.com/application/667487294bec393f66faf4f6', kind: 'form' },
  streetlight: { label: 'Report a streetlight out', hint: 'Streetlight map', href: 'https://bandm.maps.arcgis.com/apps/webappviewer/index.html?id=bb3aa3ee38ed410a8f7185bd332e8500', kind: 'form' },
  payBill: { label: 'Pay utility bill', hint: 'Xpress Bill Pay', href: 'https://www.xpressbillpay.com/', kind: 'pay' },
  billing: { label: 'Utility billing', hint: 'Rates, autopay, questions', href: 'https://www.vineyardutah.gov/services/utility_billing.php', kind: 'page' },
  startService: { label: 'Start service', href: 'https://www.vineyardutah.gov/services/apply_for_service.php', kind: 'form' },
  stopService: { label: 'Stop service', href: 'https://www.vineyardutah.gov/services/termination_request.php', kind: 'form' },
  permits: { label: 'Permits and inspections', hint: 'CityInspect portal', href: 'https://vineyard.cityinspect.com/login', kind: 'form' },
  cityHall: { label: 'Call City Hall', hint: CITY_HALL.phone, href: 'tel:+18012261929', kind: 'call' },
  staff: { label: 'City staff directory', hint: 'Names, titles and contacts', href: '/people', kind: 'page', internal: true },
  contact: { label: 'Contact the city', hint: 'Address and hours', href: 'https://www.vineyardutah.gov/contact/index.php', kind: 'page' },
  police: { label: 'Non-emergency police', hint: '801-798-5600', href: 'tel:+18017985600', kind: 'call' },
  fire: { label: 'Non-emergency fire and EMS', hint: '801-229-7070', href: 'tel:+18012297070', kind: 'call' },
  power: { label: 'Rocky Mountain Power', hint: '888-221-7070', href: 'tel:+18882217070', kind: 'call' },
  gas: { label: 'Dominion Energy', hint: '800-323-5517', href: 'tel:+18003235517', kind: 'call' },
} satisfies Record<string, ServiceLink>;

export interface DirectoryEntry extends ServiceLink {
  id: string;
  group:
    'Records and government' | 'Permits and development' | 'Utilities and public works' | 'Financial reports' | 'Parks, library and community' | 'Safety and emergencies' | 'Jobs and volunteering';
  match: RegExp;
}

const G = 'https://www.vineyardutah.gov';

export const DIRECTORY: DirectoryEntry[] = [
  // Records and government
  // Source (each entry below unless its own comment says otherwise): copied from the city's Transparency Portal page,
  // https://www.vineyardutah.gov/transparency_portal/index.php, or the vineyardutah.gov site menus, checked October 1, 2026;
  // which of the two each link was copied from was not recorded. The href is the page to open.
  {
    id: 'grama-form',
    group: 'Records and government',
    label: 'Records request (GRAMA)',
    hint: 'Fillable form for the City Recorder',
    href: `${G}/Departmnts/Recorder/GRAMA%20Request%20-%20Form%20Fillable.pdf`,
    kind: 'form',
    match: /\b(gram+[ae]r?|gramma|grama|records? requests?|public records? request|request (a |public )?records?|foia|open records)\b/i,
  },
  {
    id: 'grama-page',
    group: 'Records and government',
    label: 'How records requests work',
    hint: 'Email, mail or in person; 10 business days',
    href: `${G}/government/records_request.php`,
    kind: 'page',
    match: /\b(grama|gramma|gram+[ae]r? requests?|records? requests?|public records? request|foia)\b/i,
  },
  {
    id: 'open-records',
    group: 'Records and government',
    label: 'Utah Open Records Portal',
    hint: 'Request records online',
    href: 'https://openrecords.utah.gov/',
    kind: 'form',
    match: /\b(grama|gramma|gram+[ae]r? requests?|records? requests?|open records|foia)\b/i,
  },
  {
    id: 'recorder',
    group: 'Records and government',
    label: 'City Recorder',
    hint: 'Records, notices, elections',
    href: `${G}/government/recorder.php`,
    kind: 'page',
    match: /\b(recorder|recorder'?s office|certified cop(y|ies)|notar)\b/i,
  },
  {
    id: 'elections',
    group: 'Records and government',
    label: 'Elections',
    hint: 'Candidates, filing, voting',
    href: `${G}/government/elections.php`,
    kind: 'page',
    match: /\b(elections?|candidates?|run(ning)? for (office|council|mayor)|declaration of candidacy|ballot|vote by mail|voter)\b/i,
  },
  {
    id: 'meet-mayor',
    group: 'Records and government',
    label: 'Meet with the Mayor',
    hint: 'Request a meeting',
    href: `${G}/government/request_a_meeting_with_the_mayor.php`,
    kind: 'form',
    match: /\b(meet(ing)? with (the )?mayor|talk to the mayor|mayor'?s office)\b/i,
  },
  {
    id: 'council',
    group: 'Records and government',
    label: 'City Council',
    hint: 'Members and contact',
    href: `${G}/government/city_council2.php`,
    kind: 'page',
    match: /\b(contact (the )?council|email (the )?council|council members?' (email|contact))\b/i,
  },
  {
    id: 'vacancy',
    group: 'Records and government',
    label: 'Council vacancy application',
    hint: 'Fillable PDF',
    href: `${G}/Recorder/2026%20Vacancy/Fillable%202026%20Vineyard%20City%20Council%20Vacancy%20Application%20-%20Combined%202.pdf`,
    kind: 'form',
    match: /\b(council vacanc|vacancy application|appointed to (the )?council)\b/i,
  },
  { id: 'conflict', group: 'Records and government', label: 'Conflict of interest forms', href: `${G}/government/conflict_of_interest_forms.php`, kind: 'page', match: /\bconflicts? of interest\b/i },
  { id: 'notices', group: 'Records and government', label: 'Public notices', href: `${G}/government/agenda_minutes___public_notice.php`, kind: 'page', match: /\bpublic notices?\b/i },
  {
    id: 'meeting-schedule',
    group: 'Records and government',
    label: 'Annual meeting schedule',
    href: `${G}/government/annual_meeting_schedule.php`,
    kind: 'page',
    match: /\b(meeting schedule|annual schedule|when does (the )?council meet)\b/i,
  },
  {
    id: 'civicclerk',
    group: 'Records and government',
    label: 'Government meetings and decisions',
    hint: 'Official agendas and minutes (CivicClerk)',
    href: 'https://vineyardut.portal.civicclerk.com/',
    kind: 'page',
    match: /\b(civicclerk|watch (the )?meeting|meeting video|livestream|public comment)\b/i,
  },
  {
    id: 'code',
    group: 'Records and government',
    label: 'Municipal code',
    hint: 'Official city code',
    href: 'https://vineyard.municipalcodeonline.com/',
    kind: 'page',
    match: /\b(municipal code|city code|zoning code|ordinances? (say|text))\b/i,
  },
  {
    id: 'boards',
    group: 'Records and government',
    label: 'Boards and commissions',
    hint: 'Members and openings',
    href: `${G}/community_/boards___commissions.php`,
    kind: 'page',
    match: /\b(boards?|commissions?) (and|&) (commissions?|boards?)\b|\bserve on (a )?(board|commission)\b/i,
  },
  {
    id: 'pc-apply',
    group: 'Records and government',
    label: 'Planning Commission application',
    hint: 'Online form',
    href: 'https://docs.google.com/forms/d/e/1FAIpQLSfiffKKZpmPRuXe5JCrEyKXonDhMwYSooOlDPvRJTyhqNs0CQ/viewform',
    kind: 'form',
    match: /\b(join|apply (to|for)|serve on) (the )?planning commission\b/i,
  },
  {
    id: 'youth-council',
    group: 'Records and government',
    label: 'Youth Council',
    hint: 'Candidacy forms',
    href: `${G}/community_/vineyard_youth_council_candidacy_forms_.php`,
    kind: 'form',
    match: /\byouth council\b/i,
  },
  {
    id: 'appeal',
    group: 'Records and government',
    label: 'Appeal form',
    hint: 'PDF',
    href: `${G}/Vineyard%20City%20Appeal%20Form.pdf`,
    kind: 'form',
    match: /\b(appeal (a |the )?(decision|citation|ticket)|file an appeal|appeal form)\b/i,
  },
  { id: 'news', group: 'Records and government', label: 'City news', href: `${G}/contact/news.php`, kind: 'page', match: /\b(city news|press releases?|announcements?)\b/i },
  { id: 'newsletters', group: 'Records and government', label: 'Newsletters', href: `${G}/community_/newsletters.php`, kind: 'page', match: /\bnewsletters?\b/i },

  // Permits and development
  // Source (each entry below unless its own comment says otherwise): copied from the city's Transparency Portal page,
  // https://www.vineyardutah.gov/transparency_portal/index.php, or the vineyardutah.gov site menus, checked October 1, 2026;
  // which of the two each link was copied from was not recorded. The href is the page to open.
  {
    id: 'permit-login',
    group: 'Permits and development',
    label: 'Apply for a permit',
    hint: 'CityInspect login',
    href: 'https://vineyard.cityinspect.com/login',
    kind: 'form',
    match: /\b(permits?|inspections?|build(ing)? (a|an)|remodel|fence|shed|solar|deck|addition)\b/i,
  },
  {
    id: 'permit-new',
    group: 'Permits and development',
    label: 'New permit account',
    hint: 'CityInspect sign up',
    href: 'https://utah.cityinspect.com/register',
    kind: 'form',
    match: /\b(permit|cityinspect)\b.*\b(account|sign ?up|register|new user)\b/i,
  },
  {
    id: 'building',
    group: 'Permits and development',
    label: 'Building department',
    hint: 'Codes, inspections, resources',
    href: `${G}/government/building.php`,
    kind: 'page',
    match: /\b(building (department|code|official)|building permits?)\b/i,
  },
  { id: 'basement', group: 'Permits and development', label: 'Basement finish', href: `${G}/government/basement_finish.php`, kind: 'page', match: /\bbasement\b/i },
  {
    id: 'planning',
    group: 'Permits and development',
    label: 'Planning and zoning',
    hint: 'Applications and zoning help',
    href: `${G}/government/planning.php`,
    kind: 'page',
    match: /\b(zoning|rezone|land use|site plan|subdivi|plat|variance|conditional use|setback)\b/i,
  },
  { id: 'str', group: 'Permits and development', label: 'Short-term rental license', href: `${G}/government/short_term_rental.php`, kind: 'form', match: /\b(short[- ]term rentals?|airbnb|vrbo)\b/i },
  {
    id: 'business',
    group: 'Permits and development',
    label: 'Business licensing',
    href: `${G}/government/business_licensing_.php`,
    kind: 'form',
    match: /\b(business licen[cs]e|start (a|my) business|home business|home occupation)\b/i,
  },
  {
    id: 'adu',
    group: 'Permits and development',
    label: 'ADU licensing',
    hint: 'Accessory dwelling units',
    href: `${G}/government/accessory_dwelling_unit_licensing.php`,
    kind: 'form',
    match: /\b(adu|accessory dwelling|mother[- ]in[- ]law|basement apartment)\b/i,
  },
  {
    id: 'econ',
    group: 'Permits and development',
    label: 'Economic development',
    href: `${G}/government/economic_development.php`,
    kind: 'page',
    match: /\b(economic development|bring (a )?business|commercial development)\b/i,
  },
  { id: 'rda', group: 'Permits and development', label: 'Redevelopment Agency', href: `${G}/government/redevelopment_agency/index.php`, kind: 'page', match: /\b(rda|redevelopment agency)\b/i },
  {
    id: 'engineering',
    group: 'Permits and development',
    label: 'Engineering standards',
    href: `${G}/government/engineering_standards.php`,
    kind: 'page',
    match: /\b(engineering standards?|construction standards?|public improvement standards?)\b/i,
  },

  // Utilities and public works
  // Source (each entry below unless its own comment says otherwise): copied from the city's Transparency Portal page,
  // https://www.vineyardutah.gov/transparency_portal/index.php, or the vineyardutah.gov site menus, checked October 1, 2026;
  // which of the two each link was copied from was not recorded. The href is the page to open.
  { id: 'water-meter', group: 'Utilities and public works', label: 'Water meter request', href: `${G}/government/water_meter_request.php`, kind: 'form', match: /\bwater meters?\b/i },
  {
    id: 'water-quality',
    group: 'Utilities and public works',
    label: 'Water quality reports',
    href: `${G}/government/water_quality_reports.php`,
    kind: 'page',
    match: /\b(water quality|drinking water|consumer confidence|ccr|lead in (the )?water|fluoride)\b/i,
  },
  {
    id: 'water',
    group: 'Utilities and public works',
    label: 'Water and wastewater',
    href: `${G}/government/water___wastewater.php`,
    kind: 'page',
    match: /\b(water (main|line|pressure|leak|restriction|conservation)|sewer|wastewater|irrigation|secondary water)\b/i,
  },
  {
    id: 'streets',
    group: 'Utilities and public works',
    label: 'Streets and stormwater',
    href: `${G}/government/streets.php`,
    kind: 'page',
    match: /\b(street (repair|maintenance|sweeping)|stormwater|storm drain|snow (removal|plow))\b/i,
  },
  { id: 'public-works', group: 'Utilities and public works', label: 'Public Works', href: `${G}/government/public_works.php`, kind: 'page', match: /\bpublic works\b/i },
  {
    id: 'construction',
    group: 'Utilities and public works',
    label: 'Construction projects',
    hint: 'Current city projects',
    href: `${G}/government/construction_projects.php`,
    kind: 'page',
    match: /\b(construction projects?|road (work|closure|construction)|detours?)\b/i,
  },
  {
    id: 'dump',
    group: 'Utilities and public works',
    label: 'City dump passes',
    href: `${G}/community_/city_dump_passes.php`,
    kind: 'form',
    match: /\b(dump pass|landfill|transfer station|bulk waste|green waste)\b/i,
  },
  { id: 'eco-pass', group: 'Utilities and public works', label: 'UTA ECO Pass', href: `${G}/services/uta_eco_pass.php`, kind: 'page', match: /\b(eco ?pass|uta|frontrunner|bus pass|transit pass)\b/i },

  // Financial reports
  // Source (each entry below unless its own comment says otherwise): copied from the city's Transparency Portal page,
  // https://www.vineyardutah.gov/transparency_portal/index.php, or the vineyardutah.gov site menus, checked October 1, 2026;
  // which of the two each link was copied from was not recorded. The href is the page to open.
  { id: 'fees', group: 'Financial reports', label: 'Fee schedule', href: `${G}/government/fee_schedule.php`, kind: 'page', match: /\b(fee schedule|fees?|how much does (a|it) cost|impact fees?)\b/i },
  { id: 'budget', group: 'Financial reports', label: 'City budget', href: `${G}/government/budget.php`, kind: 'page', match: /\b(budget|appropriation|fiscal year)\b/i },
  {
    id: 'acfr',
    group: 'Financial reports',
    label: 'Annual financial report',
    hint: 'Audited financial statements',
    href: `${G}/government/annual_financial_report.php`,
    kind: 'page',
    match: /\b(annual financial report|acfr|cafr|audit(ed)?|financial statements?)\b/i,
  },
  { id: 'finance', group: 'Financial reports', label: 'Finance department', href: `${G}/government/finance.php`, kind: 'page', match: /\b(finance department|city finances?|debt|bonds?)\b/i },
  {
    id: 'transparent-utah',
    group: 'Financial reports',
    label: 'Transparent Utah',
    hint: 'Every city payment and salary',
    href: 'https://transparent.utah.gov/',
    kind: 'page',
    match: /\b(salar(y|ies)|wages?|spending|checks?|payments? to|vendors?|transparent utah|how much (do|does) .* (make|earn|paid))\b/i,
  }, // Source: https://transparent.utah.gov/ (state site linked from the city's Transparency Portal page)
  {
    id: 'rfp',
    group: 'Financial reports',
    label: 'Requests for proposals',
    hint: 'Open bids',
    href: `${G}/government/request_for_proposals_(rfp).php`,
    kind: 'page',
    match: /\b(rfps?|requests? for proposals?|bids?|bidding|procurement|contract opportunit)\b/i,
  },
  {
    id: 'reimburse',
    group: 'Financial reports',
    label: 'Library and rec center reimbursement',
    href: `${G}/community_/library_reimbursement.php`,
    kind: 'form',
    match: /\b(reimburse|rec center|recreation center|library card fee)\b/i,
  },

  // Parks, library and community
  // Source (each entry below unless its own comment says otherwise): copied from the city's Transparency Portal page,
  // https://www.vineyardutah.gov/transparency_portal/index.php, or the vineyardutah.gov site menus, checked October 1, 2026;
  // which of the two each link was copied from was not recorded. The href is the page to open.
  { id: 'parks', group: 'Parks, library and community', label: 'Parks', href: `${G}/government/parks.php`, kind: 'page', match: /\b(parks?|pavilion|reserv(e|ation)|playground)\b/i },
  {
    id: 'recreation',
    group: 'Parks, library and community',
    label: 'Recreation programs',
    href: `${G}/government/recreation.php`,
    kind: 'form',
    match: /\b(recreation|sports|leagues?|classes|sign ?up for|register for)\b/i,
  },
  { id: 'events', group: 'Parks, library and community', label: 'City events', href: `${G}/government/events.php`, kind: 'page', match: /\b(events?|vineyard days|festival|concerts?)\b/i },
  { id: 'splash', group: 'Parks, library and community', label: 'Splash pad', href: `${G}/government/splash_pad.php`, kind: 'page', match: /\bsplash pad\b/i },
  {
    id: 'library',
    group: 'Parks, library and community',
    label: "Vineyard Children's Library",
    href: 'https://vineyard.lib.utah.gov/',
    hint: '125 S Main St, 801-226-1929',
    kind: 'page',
    match: /\blibrar(y|ies)\b/i,
  }, // Source: the library's own site, https://vineyard.lib.utah.gov/, checked October 3, 2026
  {
    id: 'library-catalog',
    group: 'Parks, library and community',
    label: 'Library catalog',
    hint: 'Search and reserve books',
    href: 'https://vineyard.aspendiscovery.org/',
    kind: 'page',
    match: /\b(library catalog|search (for )?books?|reserve (a )?books?|find a book|check out (a )?books?|books? (hold|reserve))\b/i,
  }, // Source: the library's own site, https://vineyard.lib.utah.gov/, checked October 3, 2026
  {
    id: 'library-online',
    group: 'Parks, library and community',
    label: 'Online library resources',
    hint: 'Ebooks, audiobooks and databases',
    href: 'https://vineyard.lib.utah.gov/online_resources/',
    kind: 'page',
    match: /\b(online (library )?resources|ebooks?|e-books?|audiobooks?|libby|overdrive)\b/i,
  }, // Source: the library's own site, https://vineyard.lib.utah.gov/, checked October 3, 2026
  {
    id: 'library-events',
    group: 'Parks, library and community',
    label: 'Library events and programs',
    href: 'https://vineyard.lib.utah.gov/events-programs/',
    kind: 'page',
    match: /\b(story ?times?|library (events?|programs?|classes)|reading program|summer reading)\b/i,
  }, // Source: the library's own site, https://vineyard.lib.utah.gov/, checked October 3, 2026
  {
    id: 'bookmobile',
    group: 'Parks, library and community',
    label: 'Bookmobile',
    hint: 'Run by the Utah State Library; bring a library card',
    href: 'https://vineyard.lib.utah.gov/events/bookmobile/',
    kind: 'page',
    match: /\b(book ?mobiles?|mobile library)\b/i,
  }, // Source: the library's own site, https://vineyard.lib.utah.gov/, checked October 3, 2026
  {
    id: 'bookmobile-schedule',
    group: 'Parks, library and community',
    label: 'Bookmobile schedule and stops',
    href: 'https://bookmobiles.utah.gov/utah/schedule/',
    kind: 'page',
    match: /\bbook ?mobiles?\b[^.?!]*\b(schedule|stops?|times?|when|where|next)\b|\b(schedule|stops?|when|where|next)\b[^.?!]*\bbook ?mobiles?\b/i,
  }, // Source: Utah State Library bookmobile schedule, https://bookmobiles.utah.gov/utah/schedule/, reached from the library's Bookmobile page, checked October 3, 2026
  { id: 'library-card', group: 'Parks, library and community', label: 'Get a library card', href: 'https://vineyard.lib.utah.gov/get-a-library-card/', kind: 'form', match: /\blibrary card\b/i },
  { id: 'garden', group: 'Parks, library and community', label: 'Community garden', href: `${G}/community_/vineyard_community_garden.php`, kind: 'form', match: /\b(community garden|garden plot)\b/i },
  { id: 'trails', group: 'Parks, library and community', label: 'Trails', href: `${G}/community_/trails.php`, kind: 'page', match: /\btrails?\b/i },
  { id: 'fireworks', group: 'Parks, library and community', label: 'Fireworks rules', href: `${G}/community_/fireworks.php`, kind: 'page', match: /\bfireworks?\b/i },
  { id: 'citizens-academy', group: 'Parks, library and community', label: 'Citizens Academy', href: `${G}/government/vineyard_citizens_academy.php`, kind: 'form', match: /\bcitizens? academy\b/i },
  {
    id: 'neighborhoods',
    group: 'Parks, library and community',
    label: 'Neighborhood map',
    href: `${G}/community_/neighborhood_map.php`,
    kind: 'map',
    match: /\b(neighborhoods?|which neighborhood)\b/i,
  },
  {
    id: 'city-maps',
    group: 'Parks, library and community',
    label: 'Official city maps',
    hint: 'City GIS',
    href: 'https://experience.arcgis.com/experience/5d675261cad649ffb85deee52dcbe1cb',
    kind: 'map',
    match: /\b(official map|gis|city maps?)\b/i,
  },

  // Safety and emergencies
  // Source (each entry below unless its own comment says otherwise): copied from the city's Transparency Portal page,
  // https://www.vineyardutah.gov/transparency_portal/index.php, or the vineyardutah.gov site menus, checked October 1, 2026;
  // which of the two each link was copied from was not recorded. The href is the page to open.
  {
    id: 'alerts',
    group: 'Safety and emergencies',
    label: 'Sign up for emergency alerts',
    hint: 'Everbridge',
    href: 'https://member.everbridge.net/1332612387832225/login',
    kind: 'form',
    match: /\b(alerts?|notifications?|emergency (text|messages?)|everbridge)\b/i,
  },
  { id: 'evac', group: 'Safety and emergencies', label: 'Evacuation maps', href: 'https://experience.arcgis.com/experience/ddf7f451101e469c856c43e5f1a761bb', kind: 'map', match: /\bevacuat/i },
  {
    id: 'prepare',
    group: 'Safety and emergencies',
    label: 'Emergency preparedness',
    href: `${G}/services/emergency_preparedness.php`,
    kind: 'page',
    match: /\b(emergency prep|preparedness|earthquake|flood|disaster|72 hour kit)\b/i,
  },
  {
    id: 'sheriff',
    group: 'Safety and emergencies',
    label: "Utah County Sheriff's Office",
    hint: "Vineyard's police service",
    href: `${G}/government/utah_county_sheriff_s_office.php`,
    kind: 'page',
    match: /\b(police|sheriff|crime|deput(y|ies)|police reports?)\b/i,
  },
  { id: 'safewalk', group: 'Safety and emergencies', label: 'SafeWalk program', href: `${G}/community_/safewalk_program.php`, kind: 'page', match: /\b(safewalk|safe walk|walk to school)\b/i },
  {
    id: 'school-safety',
    group: 'Safety and emergencies',
    label: 'School safety and crossing guards',
    href: `${G}/community_/school_safety.php`,
    kind: 'page',
    match: /\b(school safety|crossing guards?|school zone)\b/i,
  },
  { id: 'rad', group: 'Safety and emergencies', label: 'R.A.D. self-defense classes', href: `${G}/government/rad_systems_of_self-defense_classes.php`, kind: 'form', match: /\bself[- ]defen[cs]e\b/i },

  // Jobs and volunteering
  // Source (each entry below unless its own comment says otherwise): copied from the city's Transparency Portal page,
  // https://www.vineyardutah.gov/transparency_portal/index.php, or the vineyardutah.gov site menus, checked October 1, 2026;
  // which of the two each link was copied from was not recorded. The href is the page to open.
  {
    id: 'jobs',
    group: 'Jobs and volunteering',
    label: 'City job openings',
    hint: 'Apply on the city job site',
    href: 'https://vineyardutah.applicantpro.com/jobs/',
    kind: 'form',
    match: /\b(jobs?|hiring|careers?|employment|job openings?|work for the city|positions? (open|available)|apply to work)\b/i,
  },
  { id: 'volunteer', group: 'Jobs and volunteering', label: 'Volunteer', href: `${G}/community_/volunteer.php`, kind: 'form', match: /\bvolunteer/i },
];

export const DIRECTORY_GROUPS: Array<DirectoryEntry['group']> = [
  'Records and government',
  'Permits and development',
  'Utilities and public works',
  'Financial reports',
  'Parks, library and community',
  'Safety and emergencies',
  'Jobs and volunteering',
];

/** The entries a question asks for, the most specific first ("library card" before "library"), at most `max`. */
export function directoryFor(question: string, max = 4, entries: DirectoryEntry[] = DIRECTORY): DirectoryEntry[] {
  const hits: Array<{ e: DirectoryEntry; at: number; len: number }> = [];
  entries.forEach((e, at) => {
    const m = e.match.exec(question);
    if (m) hits.push({ e, at, len: m[0].length });
  });
  return hits
    .sort((a, b) => b.len - a.len || a.at - b.at)
    .slice(0, max)
    .map((h) => h.e);
}

export type ServiceGroup = DirectoryEntry['group'];
export type LinkKey = keyof typeof LINKS;
export type AddedKind = 'form' | 'page' | 'map' | 'pay';
export const ADDED_KINDS: AddedKind[] = ['page', 'form', 'pay', 'map'];

/** The quick links staff can change. The staff directory link opens the portal's own People page, so it is not offered. */
export const EDITABLE_LINKS: LinkKey[] = (Object.keys(LINKS) as LinkKey[]).filter((k) => k !== 'staff');
export const isPhoneLink = (k: LinkKey): boolean => LINKS[k].kind === 'call';

export const SERVICE_LABEL_MAX = 80;
export const SERVICE_HINT_MAX = 120;
export const SERVICE_HREF_MAX = 600;
export const SERVICE_WORDS_MAX = 12;
export const SERVICE_WORD_MAX = 40;
export const SERVICES_ADDED_MAX = 60;

/** What staff changed about one built-in service. Only the fields they changed are present; an empty hint means "no note". */
export interface ServiceEdit {
  label?: string;
  hint?: string;
  href?: string;
  group?: ServiceGroup;
  /** Extra words that bring this service up under an answer, on top of the built-in ones. */
  words?: string[];
}

export interface AddedService {
  id: string;
  label: string;
  hint: string;
  href: string;
  group: ServiceGroup;
  kind: AddedKind;
  words: string[];
}

export interface ServicesContent {
  edits: Record<string, ServiceEdit>;
  hidden: string[];
  added: AddedService[];
}

export interface ContactEdit {
  label?: string;
  hint?: string;
  href?: string;
  /** For a phone link: the number, as 801-226-1929. The link and the note under it follow from it. */
  phone?: string;
}

export interface ContactsContent {
  edits: Partial<Record<LinkKey, ContactEdit>>;
  hidden: LinkKey[];
}

/**
 * A web address a resident can be sent to, or null. Only http and https (no user names or passwords in it), or a page of the
 * portal itself ("/people"). Anything else, such as javascript: or data:, is never a link.
 */
export function safeHref(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > SERVICE_HREF_MAX) return null;
  if (s.startsWith('/')) return /^\/(?!\/)[A-Za-z0-9\-._~%/?#=&+]*$/.test(s) ? s : null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password || !u.hostname.includes('.')) return null;
  return u.toString();
}

/** A phone number as the city writes it (801-226-1929), from what staff typed, or null when it is not 10 digits. */
export function cleanPhone(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  let d = v.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : null;
}

const escapeWord = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');

/** A matcher for the words staff typed: whole words or phrases, any case. Never a pattern staff wrote. */
export function wordsMatcher(words: string[]): RegExp | null {
  const list = words.map((w) => w.trim()).filter(Boolean);
  return list.length ? new RegExp(`\\b(${list.map(escapeWord).join('|')})\\b`, 'i') : null;
}

const either = (a: RegExp | null, b: RegExp | null): RegExp => {
  if (a && b) return new RegExp(`(?:${a.source})|(?:${b.source})`, 'i');
  return a ?? b ?? /(?!)/;
};

const own = <T extends object>(o: T | null | undefined, k: string): boolean => Boolean(o) && Object.prototype.hasOwnProperty.call(o, k);

/** One row of the staff list: the service as residents see it, and what staff changed. */
export interface ServiceRow {
  entry: DirectoryEntry;
  builtIn: DirectoryEntry | null;
  edited: boolean;
  hidden: boolean;
  added: boolean;
  words: string[];
}

/** Every service, built-in and added, with staff changes laid over, hidden ones included and marked. */
export function serviceRows(content: ServicesContent | null | undefined): ServiceRow[] {
  const hidden = new Set(content?.hidden ?? []);
  const rows: ServiceRow[] = DIRECTORY.map((b) => {
    const e = own(content?.edits, b.id) ? content!.edits[b.id] : undefined;
    const href = e?.href ? safeHref(e.href) : null;
    const words = e?.words ?? [];
    const entry: DirectoryEntry = {
      ...b,
      label: e?.label || b.label,
      hint: e && own(e, 'hint') ? e.hint || undefined : b.hint,
      href: href ?? b.href,
      group: e?.group && DIRECTORY_GROUPS.includes(e.group) ? e.group : b.group,
      match: words.length ? either(b.match, wordsMatcher(words)) : b.match,
    };
    return { entry, builtIn: b, edited: Boolean(e && Object.keys(e).length), hidden: hidden.has(b.id), added: false, words };
  });
  for (const a of content?.added ?? []) {
    const href = safeHref(a.href);
    if (!href || !a.label) continue;
    const entry: DirectoryEntry = {
      id: a.id,
      label: a.label,
      hint: a.hint || undefined,
      href,
      kind: a.kind,
      group: DIRECTORY_GROUPS.includes(a.group) ? a.group : 'Records and government',
      match: wordsMatcher(a.words) ?? /(?!)/,
    };
    rows.push({ entry, builtIn: null, edited: false, hidden: hidden.has(a.id), added: true, words: a.words });
  }
  return rows;
}

/** The services residents see: built-in and added, with staff changes, without the hidden ones. */
export function servicesFrom(content: ServicesContent | null | undefined): DirectoryEntry[] {
  if (!content) return DIRECTORY;
  return serviceRows(content)
    .filter((r) => !r.hidden)
    .map((r) => r.entry);
}

export type Links = Record<LinkKey, ServiceLink & { hidden?: boolean }>;

/** The quick links and phone numbers with staff changes laid over. A hidden one is marked, so nothing that names it breaks. */
export function contactsFrom(content: ContactsContent | null | undefined): Links {
  const out = { ...LINKS } as Links;
  if (!content) return out;
  for (const k of Object.keys(LINKS) as LinkKey[]) {
    const b = LINKS[k] as ServiceLink;
    const e = own(content.edits, k) ? content.edits[k] : undefined;
    const next: ServiceLink & { hidden?: boolean } = { ...b };
    if (e && k !== 'staff') {
      if (e.label) next.label = e.label;
      if (isPhoneLink(k)) {
        const phone = cleanPhone(e.phone);
        if (phone) {
          next.hint = phone;
          next.href = telHref(phone);
        }
      } else {
        if (own(e, 'hint')) next.hint = e.hint || undefined;
        const href = e.href ? safeHref(e.href) : null;
        if (href) next.href = href;
      }
    }
    if (content.hidden?.includes(k) && k !== 'staff') next.hidden = true;
    out[k] = next;
  }
  return out;
}

/** City Hall's phone number as residents see it now. */
export const cityHallPhone = (links: Links): string => links.cityHall.hint ?? CITY_HALL.phone;
