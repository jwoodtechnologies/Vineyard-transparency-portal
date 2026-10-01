/**
 * Every service, form, portal and report linked from the city's own Transparency Portal and site
 * menus (vineyardutah.gov/transparency_portal, checked October 1, 2026), as buttons. A question that
 * names one ("I need a records request form", "apply for a job", "fee schedule") shows its button,
 * which opens the official form or page. The Services page lists them all by group.
 */
import type { ServiceLink } from './services';

export interface DirectoryEntry extends ServiceLink {
  id: string;
  group: 'Records and government' | 'Permits and development' | 'Utilities and public works' | 'Money and reports' | 'Parks, library and community' | 'Safety and emergencies' | 'Jobs and volunteering';
  match: RegExp;
}

const G = 'https://www.vineyardutah.gov';

export const DIRECTORY: DirectoryEntry[] = [
  // Records and government
  { id: 'grama-form', group: 'Records and government', label: 'Records request (GRAMA)', hint: 'Fillable form for the City Recorder', href: `${G}/Departmnts/Recorder/GRAMA%20Request%20-%20Form%20Fillable.pdf`, kind: 'form', match: /\b(gram+[ae]r?|gramma|grama|records? requests?|public records? request|request (a |public )?records?|foia|open records)\b/i },
  { id: 'grama-page', group: 'Records and government', label: 'How records requests work', hint: 'Email, mail or in person; 10 business days', href: `${G}/government/records_request.php`, kind: 'page', match: /\b(grama|gramma|gram+[ae]r? requests?|records? requests?|public records? request|foia)\b/i },
  { id: 'open-records', group: 'Records and government', label: 'Utah Open Records Portal', hint: 'Request records online', href: 'https://openrecords.utah.gov/', kind: 'form', match: /\b(grama|gramma|gram+[ae]r? requests?|records? requests?|open records|foia)\b/i },
  { id: 'recorder', group: 'Records and government', label: 'City Recorder', hint: 'Records, notices, elections', href: `${G}/government/recorder.php`, kind: 'page', match: /\b(recorder|recorder'?s office|certified cop(y|ies)|notar)\b/i },
  { id: 'elections', group: 'Records and government', label: 'Elections', hint: 'Candidates, filing, voting', href: `${G}/government/elections.php`, kind: 'page', match: /\b(elections?|candidates?|run(ning)? for (office|council|mayor)|declaration of candidacy|ballot|vote by mail|voter)\b/i },
  { id: 'meet-mayor', group: 'Records and government', label: 'Meet with the Mayor', hint: 'Request a meeting', href: `${G}/government/request_a_meeting_with_the_mayor.php`, kind: 'form', match: /\b(meet(ing)? with (the )?mayor|talk to the mayor|mayor'?s office)\b/i },
  { id: 'council', group: 'Records and government', label: 'City Council', hint: 'Members and contact', href: `${G}/government/city_council2.php`, kind: 'page', match: /\b(contact (the )?council|email (the )?council|council members?' (email|contact))\b/i },
  { id: 'vacancy', group: 'Records and government', label: 'Council vacancy application', hint: 'Fillable PDF', href: `${G}/Recorder/2026%20Vacancy/Fillable%202026%20Vineyard%20City%20Council%20Vacancy%20Application%20-%20Combined%202.pdf`, kind: 'form', match: /\b(council vacanc|vacancy application|appointed to (the )?council)\b/i },
  { id: 'conflict', group: 'Records and government', label: 'Conflict of interest forms', href: `${G}/government/conflict_of_interest_forms.php`, kind: 'page', match: /\bconflicts? of interest\b/i },
  { id: 'notices', group: 'Records and government', label: 'Public notices', href: `${G}/government/agenda_minutes___public_notice.php`, kind: 'page', match: /\bpublic notices?\b/i },
  { id: 'meeting-schedule', group: 'Records and government', label: 'Annual meeting schedule', href: `${G}/government/annual_meeting_schedule.php`, kind: 'page', match: /\b(meeting schedule|annual schedule|when does (the )?council meet)\b/i },
  { id: 'civicclerk', group: 'Records and government', label: 'Government meetings and decisions', hint: 'Official agendas and minutes (CivicClerk)', href: 'https://vineyardut.portal.civicclerk.com/', kind: 'page', match: /\b(civicclerk|watch (the )?meeting|meeting video|livestream|public comment)\b/i },
  { id: 'code', group: 'Records and government', label: 'Municipal code', hint: 'Official city code', href: 'https://vineyard.municipalcodeonline.com/', kind: 'page', match: /\b(municipal code|city code|zoning code|ordinances? (say|text))\b/i },
  { id: 'boards', group: 'Records and government', label: 'Boards and commissions', hint: 'Members and openings', href: `${G}/community_/boards___commissions.php`, kind: 'page', match: /\b(boards?|commissions?) (and|&) (commissions?|boards?)\b|\bserve on (a )?(board|commission)\b/i },
  { id: 'pc-apply', group: 'Records and government', label: 'Planning Commission application', hint: 'Online form', href: 'https://docs.google.com/forms/d/e/1FAIpQLSfiffKKZpmPRuXe5JCrEyKXonDhMwYSooOlDPvRJTyhqNs0CQ/viewform', kind: 'form', match: /\b(join|apply (to|for)|serve on) (the )?planning commission\b/i },
  { id: 'youth-council', group: 'Records and government', label: 'Youth Council', hint: 'Candidacy forms', href: `${G}/community_/vineyard_youth_council_candidacy_forms_.php`, kind: 'form', match: /\byouth council\b/i },
  { id: 'appeal', group: 'Records and government', label: 'Appeal form', hint: 'PDF', href: `${G}/Vineyard%20City%20Appeal%20Form.pdf`, kind: 'form', match: /\b(appeal (a |the )?(decision|citation|ticket)|file an appeal|appeal form)\b/i },
  { id: 'news', group: 'Records and government', label: 'City news', href: `${G}/contact/news.php`, kind: 'page', match: /\b(city news|press releases?|announcements?)\b/i },
  { id: 'newsletters', group: 'Records and government', label: 'Newsletters', href: `${G}/community_/newsletters.php`, kind: 'page', match: /\bnewsletters?\b/i },

  // Permits and development
  { id: 'permit-login', group: 'Permits and development', label: 'Apply for a permit', hint: 'CityInspect login', href: 'https://vineyard.cityinspect.com/login', kind: 'form', match: /\b(permits?|inspections?|build(ing)? (a|an)|remodel|fence|shed|solar|deck|addition)\b/i },
  { id: 'permit-new', group: 'Permits and development', label: 'New permit account', hint: 'CityInspect sign up', href: 'https://utah.cityinspect.com/register', kind: 'form', match: /\b(permit|cityinspect)\b.*\b(account|sign ?up|register|new user)\b/i },
  { id: 'building', group: 'Permits and development', label: 'Building department', hint: 'Codes, inspections, resources', href: `${G}/government/building.php`, kind: 'page', match: /\b(building (department|code|official)|building permits?)\b/i },
  { id: 'basement', group: 'Permits and development', label: 'Basement finish', href: `${G}/government/basement_finish.php`, kind: 'page', match: /\bbasement\b/i },
  { id: 'planning', group: 'Permits and development', label: 'Planning and zoning', hint: 'Applications and zoning help', href: `${G}/government/planning.php`, kind: 'page', match: /\b(zoning|rezone|land use|site plan|subdivi|plat|variance|conditional use|setback)\b/i },
  { id: 'str', group: 'Permits and development', label: 'Short-term rental license', href: `${G}/government/short_term_rental.php`, kind: 'form', match: /\b(short[- ]term rentals?|airbnb|vrbo)\b/i },
  { id: 'business', group: 'Permits and development', label: 'Business licensing', href: `${G}/government/business_licensing_.php`, kind: 'form', match: /\b(business licen[cs]e|start (a|my) business|home business|home occupation)\b/i },
  { id: 'adu', group: 'Permits and development', label: 'ADU licensing', hint: 'Accessory dwelling units', href: `${G}/government/accessory_dwelling_unit_licensing.php`, kind: 'form', match: /\b(adu|accessory dwelling|mother[- ]in[- ]law|basement apartment)\b/i },
  { id: 'econ', group: 'Permits and development', label: 'Economic development', href: `${G}/government/economic_development.php`, kind: 'page', match: /\b(economic development|bring (a )?business|commercial development)\b/i },
  { id: 'rda', group: 'Permits and development', label: 'Redevelopment Agency', href: `${G}/government/redevelopment_agency/index.php`, kind: 'page', match: /\b(rda|redevelopment agency)\b/i },
  { id: 'engineering', group: 'Permits and development', label: 'Engineering standards', href: `${G}/government/engineering_standards.php`, kind: 'page', match: /\b(engineering standards?|construction standards?|public improvement standards?)\b/i },

  // Utilities and public works
  { id: 'water-meter', group: 'Utilities and public works', label: 'Water meter request', href: `${G}/government/water_meter_request.php`, kind: 'form', match: /\bwater meters?\b/i },
  { id: 'water-quality', group: 'Utilities and public works', label: 'Water quality reports', href: `${G}/government/water_quality_reports.php`, kind: 'page', match: /\b(water quality|drinking water|consumer confidence|ccr|lead in (the )?water|fluoride)\b/i },
  { id: 'water', group: 'Utilities and public works', label: 'Water and wastewater', href: `${G}/government/water___wastewater.php`, kind: 'page', match: /\b(water (main|line|pressure|leak|restriction|conservation)|sewer|wastewater|irrigation|secondary water)\b/i },
  { id: 'streets', group: 'Utilities and public works', label: 'Streets and stormwater', href: `${G}/government/streets.php`, kind: 'page', match: /\b(street (repair|maintenance|sweeping)|stormwater|storm drain|snow (removal|plow))\b/i },
  { id: 'public-works', group: 'Utilities and public works', label: 'Public Works', href: `${G}/government/public_works.php`, kind: 'page', match: /\bpublic works\b/i },
  { id: 'construction', group: 'Utilities and public works', label: 'Construction projects', hint: 'Current city projects', href: `${G}/government/construction_projects.php`, kind: 'page', match: /\b(construction projects?|road (work|closure|construction)|detours?)\b/i },
  { id: 'dump', group: 'Utilities and public works', label: 'City dump passes', href: `${G}/community_/city_dump_passes.php`, kind: 'form', match: /\b(dump pass|landfill|transfer station|bulk waste|green waste)\b/i },
  { id: 'eco-pass', group: 'Utilities and public works', label: 'UTA ECO Pass', href: `${G}/services/uta_eco_pass.php`, kind: 'page', match: /\b(eco ?pass|uta|frontrunner|bus pass|transit pass)\b/i },

  // Money and reports
  { id: 'fees', group: 'Money and reports', label: 'Fee schedule', href: `${G}/government/fee_schedule.php`, kind: 'page', match: /\b(fee schedule|fees?|how much does (a|it) cost|impact fees?)\b/i },
  { id: 'budget', group: 'Money and reports', label: 'City budget', href: `${G}/government/budget.php`, kind: 'page', match: /\b(budget|appropriation|fiscal year)\b/i },
  { id: 'acfr', group: 'Money and reports', label: 'Annual financial report', hint: 'Audited financial statements', href: `${G}/government/annual_financial_report.php`, kind: 'page', match: /\b(annual financial report|acfr|cafr|audit(ed)?|financial statements?)\b/i },
  { id: 'finance', group: 'Money and reports', label: 'Finance department', href: `${G}/government/finance.php`, kind: 'page', match: /\b(finance department|city finances?|debt|bonds?)\b/i },
  { id: 'transparent-utah', group: 'Money and reports', label: 'Transparent Utah', hint: 'Every city payment and salary', href: 'https://transparent.utah.gov/', kind: 'page', match: /\b(salar(y|ies)|wages?|spending|checks?|payments? to|vendors?|transparent utah|how much (do|does) .* (make|earn|paid))\b/i },
  { id: 'rfp', group: 'Money and reports', label: 'Requests for proposals', hint: 'Open bids', href: `${G}/government/request_for_proposals_(rfp).php`, kind: 'page', match: /\b(rfps?|requests? for proposals?|bids?|bidding|procurement|contract opportunit)\b/i },
  { id: 'reimburse', group: 'Money and reports', label: 'Library and rec center reimbursement', href: `${G}/community_/library_reimbursement.php`, kind: 'form', match: /\b(reimburse|rec center|recreation center|library card fee)\b/i },

  // Parks, library and community
  { id: 'parks', group: 'Parks, library and community', label: 'Parks', href: `${G}/government/parks.php`, kind: 'page', match: /\b(parks?|pavilion|reserv(e|ation)|playground)\b/i },
  { id: 'recreation', group: 'Parks, library and community', label: 'Recreation programs', href: `${G}/government/recreation.php`, kind: 'form', match: /\b(recreation|sports|leagues?|classes|sign ?up for|register for)\b/i },
  { id: 'events', group: 'Parks, library and community', label: 'City events', href: `${G}/government/events.php`, kind: 'page', match: /\b(events?|vineyard days|festival|concerts?)\b/i },
  { id: 'splash', group: 'Parks, library and community', label: 'Splash pad', href: `${G}/government/splash_pad.php`, kind: 'page', match: /\bsplash pad\b/i },
  { id: 'library', group: 'Parks, library and community', label: "Vineyard Children's Library", href: 'https://vineyard.lib.utah.gov/', kind: 'page', match: /\blibrar(y|ies)\b/i },
  { id: 'library-card', group: 'Parks, library and community', label: 'Get a library card', href: 'https://vineyard.lib.utah.gov/get-a-library-card/', kind: 'form', match: /\blibrary card\b/i },
  { id: 'garden', group: 'Parks, library and community', label: 'Community garden', href: `${G}/community_/vineyard_community_garden.php`, kind: 'form', match: /\b(community garden|garden plot)\b/i },
  { id: 'trails', group: 'Parks, library and community', label: 'Trails', href: `${G}/community_/trails.php`, kind: 'page', match: /\btrails?\b/i },
  { id: 'fireworks', group: 'Parks, library and community', label: 'Fireworks rules', href: `${G}/community_/fireworks.php`, kind: 'page', match: /\bfireworks?\b/i },
  { id: 'citizens-academy', group: 'Parks, library and community', label: 'Citizens Academy', href: `${G}/government/vineyard_citizens_academy.php`, kind: 'form', match: /\bcitizens? academy\b/i },
  { id: 'neighborhoods', group: 'Parks, library and community', label: 'Neighborhood map', href: `${G}/community_/neighborhood_map.php`, kind: 'map', match: /\b(neighborhoods?|which neighborhood)\b/i },
  { id: 'city-maps', group: 'Parks, library and community', label: 'Official city maps', hint: 'City GIS', href: 'https://experience.arcgis.com/experience/5d675261cad649ffb85deee52dcbe1cb', kind: 'map', match: /\b(official map|gis|city maps?)\b/i },

  // Safety and emergencies
  { id: 'alerts', group: 'Safety and emergencies', label: 'Sign up for emergency alerts', hint: 'Everbridge', href: 'https://member.everbridge.net/1332612387832225/login', kind: 'form', match: /\b(alerts?|notifications?|emergency (text|messages?)|everbridge)\b/i },
  { id: 'evac', group: 'Safety and emergencies', label: 'Evacuation maps', href: 'https://experience.arcgis.com/experience/ddf7f451101e469c856c43e5f1a761bb', kind: 'map', match: /\bevacuat/i },
  { id: 'prepare', group: 'Safety and emergencies', label: 'Emergency preparedness', href: `${G}/services/emergency_preparedness.php`, kind: 'page', match: /\b(emergency prep|preparedness|earthquake|flood|disaster|72 hour kit)\b/i },
  { id: 'sheriff', group: 'Safety and emergencies', label: "Utah County Sheriff's Office", hint: "Vineyard's police service", href: `${G}/government/utah_county_sheriff_s_office.php`, kind: 'page', match: /\b(police|sheriff|crime|deput(y|ies)|police reports?)\b/i },
  { id: 'safewalk', group: 'Safety and emergencies', label: 'SafeWalk program', href: `${G}/community_/safewalk_program.php`, kind: 'page', match: /\b(safewalk|safe walk|walk to school)\b/i },
  { id: 'school-safety', group: 'Safety and emergencies', label: 'School safety and crossing guards', href: `${G}/community_/school_safety.php`, kind: 'page', match: /\b(school safety|crossing guards?|school zone)\b/i },
  { id: 'rad', group: 'Safety and emergencies', label: 'R.A.D. self-defense classes', href: `${G}/government/rad_systems_of_self-defense_classes.php`, kind: 'form', match: /\bself[- ]defen[cs]e\b/i },

  // Jobs and volunteering
  { id: 'jobs', group: 'Jobs and volunteering', label: 'City job openings', hint: 'Apply on the city job site', href: 'https://vineyardutah.applicantpro.com/jobs/', kind: 'form', match: /\b(jobs?|hiring|careers?|employment|job openings?|work for the city|positions? (open|available)|apply to work)\b/i },
  { id: 'volunteer', group: 'Jobs and volunteering', label: 'Volunteer', href: `${G}/community_/volunteer.php`, kind: 'form', match: /\bvolunteer/i },
];

export const DIRECTORY_GROUPS: Array<DirectoryEntry['group']> = ['Records and government', 'Permits and development', 'Utilities and public works', 'Money and reports', 'Parks, library and community', 'Safety and emergencies', 'Jobs and volunteering'];

/** The entries a question asks for, strongest first, at most `max`. */
export function directoryFor(question: string, max = 4): DirectoryEntry[] {
  return DIRECTORY.filter((e) => e.match.test(question)).slice(0, max);
}
