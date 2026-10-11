/**
 * Parcel owner filter: decides whether the Utah County owner name of a parcel may be shown.
 *
 * The rule (owner's decision, October 2026): entity owners are shown, individuals never. Privacy wins
 * every doubt, so a name is shown only on positive evidence that it is an organization, and anything
 * that could be a person, a couple, a family or a person's trust or estate is withheld.
 *
 * 1. Person markers withhold, wherever they appear (whole word, any case, punctuation ignored):
 *    TRUST, TRUSTEE(S), TTEE(S), TR, TRS, FAMILY, FAM, LIVING, REVOCABLE, REV, IRREVOCABLE, ESTATE,
 *    EST, HEIRS, DECEASED, ET AL, ETAL, ET UX, ETUX, ET VIR, JT TEN, JTWROS, JR, SR, II, III, IV,
 *    C/O, ATTN and personal titles. The one exception is the state's "School and Institutional Trust
 *    Lands" name, which is removed before the check.
 * 2. AND or & next to a common first name, a common surname or a lone initial (other than one initial
 *    joined to another, as in "J AND M") withholds: it joins people.
 * 3. Several owners in one field (separated by ; | or a line break) are each checked; one withheld
 *    part withholds the whole field. A part after a comma with no entity word and a name in it
 *    ("SMITH, JOHN") withholds.
 * 4. Named public, church, HOA and utility owners are shown (STATE OF UTAH, VINEYARD CITY, UDOT, UTA,
 *    UNITED STATES, SCHOOL DISTRICT, UVU, REDEVELOPMENT AGENCY, CORP OF THE PRESIDING BISHOP and its
 *    short forms, DIOCESE, OWNERS ASSOCIATION, HOA, UNION PACIFIC and the like): see PUBLIC below. A
 *    government or HOA name with a business form ("USA HOMES LLC") is checked as a business instead.
 * 5. Otherwise the name must contain an entity word: a legal form (LLC, L.L.C., LC, INC, CORP,
 *    CORPORATION, CO, COMPANY, LTD, LP, LLP, PLLC) or a descriptive one (PARTNERS, PARTNERSHIP,
 *    HOLDINGS, PROPERTIES, DEVELOPMENT, INVESTMENTS, HOMES, BUILDERS, CONSTRUCTION, ASSOCIATION, CHURCH,
 *    DIOCESE, CITY, COUNTY, DISTRICT, AUTHORITY, UNIVERSITY, BANK, CREDIT UNION, FOUNDATION, RAILROAD,
 *    POWER, GAS, UTILITIES). Neither a public name nor an entity word: withheld.
 * 6. Name-only prefix check: leaving out the legal forms, the words must include at least one business
 *    word from BUSINESS below (descriptive entity words, places such as GENEVA or VINEYARD, and common
 *    business terms) that is not also a common first name or surname. So "JOHN SMITH LLC", "SMITH LLC"
 *    and "J AND M LLC" are withheld, and "EDGE HOMES", "ANDERSON GENEVA LLC" and "J AND M PROPERTIES
 *    LLC" are shown. Unknown words never count as business words. Two homebuilders whose brand is a
 *    person's name ("DR HORTON") are listed in BRANDS.
 *
 * Residential rule (ownerDecision): on a parcel whose property type is a home of any kind (single
 * family, condo, townhome, PUD, duplex, mobile home, multi-family) or whose type is unknown, only a
 * government or an HOA is shown. A vacant lot is not a home.
 *
 * Pure, no Worker types: the parcel route, its tests and the diagnostics script (Node, type stripping)
 * all import this one file, so it must use erasable TypeScript only and import nothing.
 */

export type OwnerKind = 'government' | 'hoa' | 'church' | 'utility' | 'business';

export type OwnerReason =
  | 'empty'
  | 'too-long'
  | 'trust-or-estate'
  | 'et-al'
  | 'generational-suffix'
  | 'care-of-or-title'
  | 'joined-names'
  | 'comma-name'
  | 'no-entity-word'
  | 'name-only'
  | 'residential'
  | 'type-unknown';

export type OwnerClass = { show: true; name: string; kind: OwnerKind } | { show: false; reason: OwnerReason };

/** Longest owner text shown; anything longer is withheld (long fields list several parties). */
export const OWNER_MAX = 120;

const words = (s: string) => s.split(/\s+/).filter(Boolean);
const setOf = (s: string) => new Set(words(s));

/** Common US first names (and a few common nicknames), upper case. */
export const FIRST_NAMES = setOf(`
AARON ABBY ABIGAIL ADA ADAM ADRIAN ADRIANA AIDAN AIDEN ALAN ALBERT ALEC ALEJANDRO ALEX ALEXA ALEXANDER ALEXANDRA ALEXIS ALFRED ALICE ALICIA ALLAN
ALLEN ALLISON ALMA ALVIN ALYSSA AMANDA AMBER AMELIA AMY ANA ANDREA ANDRES ANDREW ANDY ANGEL ANGELA ANGELICA ANGIE ANITA ANN ANNA ANNE ANNETTE
ANNIE ANTHONY ANTONIO APRIL ARIANA ARLENE ARMANDO ARNOLD ARTHUR ASHLEY ASHLYN AUBREY AUDREY AUSTIN AVA BAILEY BARBARA BARRY BEATRICE BECKY
BEN BENJAMIN BERNARD BETH BETHANY BETTY BEVERLY BILL BILLY BLAKE BOB BOBBY BONNIE BRAD BRADEN BRADLEY BRANDI BRANDON BRANDY BRAYDEN BRENDA
BRENT BRETT BRIAN BRIANNA BRIDGET BRITTANY BROOKE BROOKLYN BRUCE BRYAN BRYCE BRYSON CADEN CALEB CALVIN CAMERON CAMILLE CANDACE CARL CARLA CARLOS
CARMEN CAROL CAROLINE CAROLYN CARRIE CARSON CARTER CASEY CASSANDRA CATHERINE CATHY CECILIA CHAD CHARLENE CHARLES CHARLIE CHARLOTTE CHASE CHELSEA
CHERYL CHLOE CHRIS CHRISTIAN CHRISTINA CHRISTINE CHRISTOPHER CHRISTY CINDY CLAIRE CLARA CLARENCE CLAUDIA CLAYTON CLIFFORD CLINT CLYDE CODY COLE
COLLEEN COLTON CONNIE CONNOR CORY COURTNEY CRAIG CRYSTAL CURTIS CYNTHIA DAISY DAKOTA DALE DALLIN DALTON DAN DANA DANIEL DANIELLE DANNY DARLENE
DARREN DARRYL DARYL DAVE DAVID DAWN DEAN DEANNA DEBBIE DEBORAH DEBRA DEE DELANEY DENISE DENNIS DEREK DESTINY DEVIN DIANA DIANE DIEGO DOLORES
DON DONALD DONNA DORIS DOROTHY DOUG DOUGLAS DUANE DUSTIN DWIGHT DYLAN EARL ED EDDIE EDGAR EDITH EDNA EDUARDO EDWARD EDWIN EILEEN ELAINE ELEANOR
ELI ELIJAH ELISA ELIZABETH ELLA ELLEN ELLIE EMILY EMMA ENRIQUE ERIC ERICA ERIK ERIN ERNEST ESTHER ETHAN EUGENE EVA EVAN EVELYN FAITH FELICIA
FERNANDO FLORENCE FRANCES FRANCIS FRANCISCO FRANK FRANKLIN FRED FREDERICK GABRIEL GABRIELLA GAIL GARRETT GARY GAVIN GENE GEOFFREY GEORGE GERALD
GERALDINE GINA GLADYS GLEN GLENN GLORIA GORDON GRACE GRANT GREG GREGORY GRETCHEN HAILEY HALEY HANNAH HAROLD HARRY HARVEY HAYDEN HAZEL HEATHER
HECTOR HEIDI HELEN HENRY HERBERT HOLLY HOPE HOWARD HUNTER IAN IRENE ISAAC ISABEL ISABELLA ISAIAH IVAN JACK JACKIE JACKSON JACOB JACQUELINE JADE
JAKE JAMES JAMIE JAN JANE JANET JANICE JARED JASMINE JASON JAVIER JAY JEAN JEANNE JEFF JEFFERY JEFFREY JENNA JENNIFER JENNY JEREMIAH JEREMY
JEROME JESSE JESSICA JESUS JILL JIM JIMMY JO JOAN JOANN JOANNE JOE JOEL JOHN JOHNNY JON JONATHAN JORDAN JORGE JOSE JOSEPH JOSH JOSHUA JOSIE
JOY JOYCE JUAN JUDITH JUDY JULIA JULIAN JULIE JUNE JUSTIN KAITLYN KARA KAREN KARL KATE KATHERINE KATHLEEN KATHRYN KATHY KATIE KAY KAYLA KAYLEE
KEITH KELLY KELSEY KEN KENDALL KENNETH KENT KERRY KEVIN KIM KIMBERLY KIRK KRISTEN KRISTIN KRISTINA KRISTY KURT KYLE LACEY LANCE LARRY LAURA
LAUREN LAURIE LAWRENCE LEAH LEE LEO LEON LEONARD LESLIE LEWIS LILLIAN LILY LINDA LISA LOGAN LOIS LONNIE LORI LORRAINE LOUIS LOUISE LUCAS LUCY
LUIS LUKE LYDIA LYNN MACKENZIE MADELINE MADISON MAKAYLA MALLORY MANUEL MARCUS MARGARET MARIA MARIAH MARIE MARILYN MARIO MARION MARISSA MARJORIE
MARK MARLENE MARSHA MARTHA MARTIN MARVIN MARY MASON MATT MATTHEW MAUREEN MAX MAXWELL MEGAN MELANIE MELINDA MELISSA MELVIN MEREDITH MIA MICHAEL
MICHELE MICHELLE MIGUEL MIKE MILDRED MINDY MIRANDA MITCHELL MOLLY MONICA MORGAN NANCY NATALIE NATHAN NATHANIEL NEIL NICHOLAS NICK NICOLE NOAH
NORMA NORMAN OLIVIA OSCAR PAIGE PAMELA PARKER PAT PATRICIA PATRICK PATTY PAUL PAULA PEGGY PENNY PETER PHILIP PHILLIP PHYLLIS PRISCILLA RACHEL
RALPH RAMON RANDALL RANDY RAY RAYMOND REBECCA REED REGINA RENEE RHONDA RICARDO RICHARD RICK RICKY RILEY RITA ROBERT ROBERTO ROBIN ROD RODNEY
ROGER RON RONALD RONNIE ROSA ROSE ROSEMARY ROSS ROY RUBEN RUBY RUSSELL RUTH RYAN SABRINA SALLY SAM SAMANTHA SAMUEL SANDRA SANDY SARA SARAH SAVANNAH
SCOTT SEAN SERGIO SETH SHANE SHANNON SHARON SHAWN SHEILA SHELBY SHELLY SHERRY SHIRLEY SIERRA SOPHIA SPENCER STACEY STACY STANLEY STEPHANIE
STEPHEN STEVE STEVEN STUART SUE SUSAN SUZANNE SYDNEY SYLVIA TAMMY TANNER TANYA TARA TAYLOR TED TERESA TERRI TERRY THERESA THOMAS TIFFANY TIM
TIMOTHY TINA TODD TOM TOMMY TONY TONYA TRACY TRAVIS TREVOR TRISTAN TROY TYLER VALERIE VANESSA VERONICA VICKI VICKIE VICTOR VICTORIA VINCENT
VIRGINIA WADE WALTER WANDA WARREN WAYNE WENDY WESLEY WILLIAM WILLIE WYATT XAVIER YOLANDA ZACHARY ZOE
`);

/** Common US surnames, with names common in Utah County, upper case. */
export const SURNAMES = setOf(`
ADAMS ALEXANDER ALLEN ALLRED ALVAREZ ANDERSEN ANDERSON ANDREWS ASHBY ATKINSON BAILEY BAKER BALL BARNES BARTON BATEMAN BEAN BECK BELL BENNETT
BENSON BINGHAM BIRD BISHOP BLACK BLAIR BOWEN BOYD BRADFORD BRADLEY BROOKS BROWN BRYANT BULLOCK BURGESS BURNS BURTON BUTLER CALL CAMPBELL CANNON
CARLSON CARPENTER CARTER CASTILLO CHAMBERS CHAVEZ CHILD CHRISTENSEN CHRISTIANSEN CLARK CLAYTON COLE COLEMAN COLLINS COOK COOPER COX CRAIG CRANDALL
CROSS CRUZ CUMMINGS CURTIS DANIELS DAVIES DAVIS DAY DEAN DIAZ DIXON DUNCAN DUNN DURRANT EDWARDS ELLIS ELLSWORTH EVANS FARNSWORTH FERGUSON FISHER
FLORES FORD FOSTER FOX FRANCIS FREEMAN FULLER GARCIA GARDNER GIBSON GILBERT GOMEZ GONZALES GONZALEZ GORDON GRAHAM GRANT GRAY GREEN GREENE GRIFFIN
GUZMAN HALE HALL HAMILTON HANSEN HANSON HARDY HARMON HARRIS HARRISON HART HARVEY HATCH HAWKINS HAYES HENDERSON HENRY HERNANDEZ HICKS HILL HOFFMAN
HOLLAND HOLMES HOLT HORTON HOWARD HOWELL HUGHES HUNT HUNTER HUNTSMAN JACKSON JACOBS JAMES JENKINS JENSEN JEPPSON JOHNSON JOHNSTON JONES JORDAN
KELLER KELLY KENNEDY KIMBALL KING KNIGHT LARSEN LARSON LAWRENCE LAWSON LEAVITT LEE LEWIS LITTLE LONG LOPEZ LUND LYMAN MADSEN MARSHALL MARTIN
MARTINEZ MASON MATTHEWS MAXWELL MAY MCDONALD MERRILL MEYER MILLER MILLS MITCHELL MONSON MONTGOMERY MOORE MORALES MORGAN MORRIS MORTENSEN MURPHY
MURRAY MYERS NELSON NIELSEN NIELSON NICHOLS NIXON OLSEN OLSON ORTIZ OWENS PACKER PALMER PARK PARKER PARRY PATTERSON PAYNE PEARSON PERKINS PEREZ
PERRY PETERS PETERSEN PETERSON PHILLIPS PIERCE PORTER POWELL POWER PRATT PRICE RAMIREZ RAMOS RASMUSSEN REED REES REID REYES REYNOLDS RICE RICHARDS
RICHARDSON RIVERA ROBBINS ROBERTS ROBERTSON ROBINSON RODRIGUEZ ROGERS ROMNEY ROSS RUIZ RUSSELL SANCHEZ SANDERS SCOTT SHAW SIMMONS SIMPSON
SKOUSEN SMART SMITH SNOW SORENSEN SPENCER STEPHENS STEVENS STEWART STONE SULLIVAN SUMMERS TANNER TAYLOR THOMAS THOMPSON THORNE TORRES TUCKER
TURNER TYLER WAGNER WALKER WALLACE WARD WARNER WARREN WASHINGTON WATKINS WATSON WEBB WELCH WELLS WEST WHEELER WHITE WHITNEY WILLIAMS WILSON
WOOD WOODS WRIGHT YOUNG CHURCH
`);

/** Titles that go with a person's name (DR is in BRANDS for the one homebuilder). */
const TITLES = setOf('MR MRS MS MISS DR MD DDS PHD ESQ');

/** True for a word that may be part of a person's name: a common first name or surname, an initial or a title. */
export function nameLike(w: string): boolean {
  return FIRST_NAMES.has(w) || SURNAMES.has(w) || TITLES.has(w) || /^[A-Z]$/.test(w);
}

/** Legal forms: entity evidence, but never business evidence on their own. */
const LEGAL = setOf('LLC LC INC CORP CORPORATION CO COMPANY LTD LP LLP PLLC');

/** Descriptive entity words from the allowlist (CREDIT UNION is matched as a phrase). */
const DESCRIPTIVE = setOf(
  'PARTNERS PARTNERSHIP HOLDINGS PROPERTIES DEVELOPMENT INVESTMENTS HOMES BUILDERS CONSTRUCTION ASSOCIATION CHURCH DIOCESE CITY COUNTY DISTRICT AUTHORITY UNIVERSITY BANK FOUNDATION RAILROAD POWER GAS UTILITIES HOA',
);

/**
 * Business evidence: words that show an organization (descriptive entity words, places, common
 * business terms). A word that is also a common name never counts (see nameLike).
 */
export const BUSINESS = new Set([
  ...DESCRIPTIVE,
  ...words(`
CREDIT UNION GROUP VENTURES VENTURE ENTERPRISES ENTERPRISE MANAGEMENT REALTY CAPITAL EQUITY EQUITIES FUND FUNDS ASSOCIATES INVESTORS INVESTMENT
INVESTING PROPERTY LAND LANDS APARTMENTS APARTMENT COMMUNITIES COMMUNITY COMMERCIAL RETAIL INDUSTRIAL CENTER CENTRE PLAZA STATION VILLAGE
TOWNHOMES TOWNHOUSES CONDOMINIUM CONDOMINIUMS CONDOS DEVELOPERS DEVELOPMENTS DEVELOPER BUILDING BUILDINGS HOUSING HOMEBUILDERS BUILDER
SOLUTIONS SERVICES SYSTEMS ENERGY WATER SEWER IRRIGATION CANAL ELECTRIC TELEPHONE COMMUNICATIONS CABLE PIPELINE TRANSIT RAIL RAILWAY
MINISTRIES MINISTRY BAPTIST LUTHERAN METHODIST CATHOLIC CHRISTIAN EVANGELICAL FELLOWSHIP CONGREGATION TEMPLE MOSQUE SYNAGOGUE PARISH LDS
ACADEMY SCHOOL SCHOOLS CHARTER COLLEGE EDUCATION MEDICAL HEALTH HEALTHCARE HOSPITAL CLINIC DENTAL STORAGE AUTO AUTOMOTIVE MOTORS FARMS FARM
RANCH RANCHES DAIRY ORCHARD ORCHARDS NURSERY MILL MILLS STEEL MATERIALS SUPPLY CONCRETE PAVING EXCAVATION ENGINEERING TECHNOLOGIES TECHNOLOGY
TECH SOFTWARE LOGISTICS HOSPITALITY HOTEL HOTELS RESTAURANT RESTAURANTS FOODS MARKET MARKETS STORES OUTLET MALL OFFICE OFFICES BUSINESS
FINANCIAL FINANCE MORTGAGE LENDING SAVINGS INSURANCE BANCORP TITLE ESCROW EXCHANGE TRADING HOLDING ASSETS ASSET PORTFOLIO OPERATING PROJECT
PROJECTS PHASE NATIONAL AMERICAN AMERICA INTERNATIONAL GLOBAL WESTERN MOUNTAIN MOUNTAINS ROCKY PACIFIC ALPINE SUMMIT PEAK PEAKS CANYON VALLEY
LAKE LAKESIDE LAKEFRONT LAKEVIEW SHORE SHORES RIVER RIVERSIDE CREEK SPRINGS MEADOWS MEADOW VISTA RIDGE POINTE HARBOR BAY COVE ISLAND CROSSING
CROSSINGS COMMONS GATEWAY TOWNE DOWNTOWN UPTOWN MAIN NORTH SOUTH EAST WEST NORTHWEST NORTHEAST SOUTHWEST SOUTHEAST CENTRAL UNITED REGIONAL
VINEYARD GENEVA OREM PROVO LINDON UTAH LEHI SARATOGA SPRINGVILLE PAYSON SANTAQUIN MAPLETON HIGHLAND WASATCH TIMPANOGOS TIMP DESERET BONNEVILLE
ZION NEVADA ARIZONA IDAHO COLORADO CALIFORNIA TEXAS DELAWARE WYOMING TRANSPORTATION GOVERNMENT MUNICIPAL PUBLIC AGENCY REDEVELOPMENT DEPARTMENT
DIVISION BUREAU STATE FEDERAL OWNERS HOMEOWNERS MASTER ASSN CONSERVANCY CEMETERY LIBRARY RECREATION PARKS FIRE POLICE SPECIAL SERVICE
`),
]);

/** Brands that are a person's name, and only these: the national and local homebuilders on Vineyard land. */
const BRANDS = ['DR HORTON', 'D R HORTON'];

/** Named public, church, HOA and utility owners (on the normalized text). */
const PUBLIC: Array<[RegExp, OwnerKind]> = [
  [/\b(?:VINEYARD (?:CITY|TOWN)|(?:CITY|TOWN) OF VINEYARD)\b/, 'government'],
  [/\b(?:STATE OF UTAH|UTAH STATE|UNITED STATES(?: OF AMERICA)?|USA|UDOT|UTAH DEP(?:ARTMEN)?T OF TRANSPORTATION|UTA|UTAH TRANSIT AUTHORITY)\b/, 'government'],
  [/\b(?:UTAH COUNTY|COUNTY OF UTAH|SCHOOL DISTRICT|BOARD OF EDUCATION|REDEVELOPMENT AGENCY|UVU|UTAH VALLEY UNIVERSITY|BRIGHAM YOUNG UNIVERSITY|BUREAU OF RECLAMATION)\b/, 'government'],
  [/\b(?:SCHOOL (?:AND|&) INSTITUTIONAL TRUST LANDS)\b/, 'government'],
  [/\bCORP(?:ORATION)? (?:OF )?(?:THE )?PRES(?:IDING)? BISHOP(?:RIC)?\b/, 'church'],
  [/\b(?:PRESIDING BISHOP|CORP(?:ORATION)? OF (?:THE )?PRESIDENT|CHURCH OF JESUS CHRIST|LATTER DAY SAINTS|DIOCESE|CATHOLIC BISHOP)\b/, 'church'],
  [/\b(?:HOA|(?:HOME ?)?OWNERS? ASS(?:OCIATIO)?N|CONDOMINIUMS? ASS(?:OCIATIO)?N|MASTER ASS(?:OCIATIO)?N|COMMUNITY ASS(?:OCIATIO)?N)\b/, 'hoa'],
  [/\b(?:UNION PACIFIC|ROCKY MOUNTAIN POWER|PACIFICORP|DOMINION ENERGY|QUESTAR GAS|ENBRIDGE)\b/, 'utility'],
];

/** The state trust lands agency name holds "TRUST": removed before the person markers are checked. */
const SITLA = /\bSCHOOL (?:AND|&) INSTITUTIONAL TRUST LANDS\b/g;

const MARKERS: Array<[RegExp, OwnerReason]> = [
  [/\b(?:TRUSTS?|TRUSTEES?|TTEES?|TR|TRS|TRST|FAMILY|FAM|LIVING|LIV|REVOCABLE|REVOC|REV|IRREVOCABLE|IRREV|ESTATE|EST|HEIRS?|DECEASED|DECD|LIFE ESTATE)\b/, 'trust-or-estate'],
  [/\b(?:ET ?AL|ET ?UX|ET ?VIR|JT ?TEN|JTWROS|JTRS|TENANTS? IN COMMON)\b/, 'et-al'],
  [/\b(?:JR|SR|II|III|IV)\b/, 'generational-suffix'],
  [/\b(?:C O|ATTN|AKA|MR|MRS|MS|MISS|HUSBAND|WIFE|SPOUSE)\b/, 'care-of-or-title'],
];

/** Owner text in one comparable form: upper case, punctuation dropped, L.L.C. and L L C as LLC, & as a word. */
export function normalizeOwner(raw: string): string {
  return ` ${raw.toUpperCase()} `
    .replace(/\bC\s*\/\s*O\b/g, ' C O ')
    .replace(/&/g, ' & ')
    .replace(/[.'`]/g, '')
    .replace(/[^A-Z0-9& ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\bP L L C\b/g, 'PLLC')
    .replace(/\bL L C\b/g, 'LLC')
    .replace(/\bL L P\b/g, 'LLP')
    .trim();
}

const isEntityWord = (w: string) => LEGAL.has(w) || DESCRIPTIVE.has(w);
/** Forms an HOA may carry (owners associations are often nonprofit corporations). */
const HOA_FORMS = setOf('INC CORP CORPORATION');
const GOV_LAST = setOf('CITY TOWN COUNTY DISTRICT AUTHORITY AGENCY');
const GOV_LEAD = new Set(['CITY OF', 'TOWN OF', 'COUNTY OF', 'STATE OF']);

/** AND or & with a name or lone initial beside it, except one initial joined to another ("J AND M"). */
function joinsNames(ws: string[]): boolean {
  for (let i = 0; i < ws.length; i++) {
    if (ws[i] !== 'AND' && ws[i] !== '&') continue;
    const a = ws[i - 1] ?? '';
    const b = ws[i + 1] ?? '';
    const initials = /^[A-Z]$/.test(a) && /^[A-Z]$/.test(b);
    if (initials) continue;
    if (!a || !b || nameLike(a) || nameLike(b)) return true;
  }
  return false;
}

/** One owner (no ; | or line breaks): the decision for its normalized text. */
function classifyOne(norm: string): OwnerClass {
  if (!norm) return { show: false, reason: 'empty' };
  const checked = norm.replace(SITLA, ' ');
  for (const [re, reason] of MARKERS) if (re.test(checked)) return { show: false, reason };
  const ws = words(norm);
  // A named public owner is taken as one, unless a business form says otherwise ("USA HOMES LLC").
  const pub = PUBLIC.find(([re]) => re.test(norm));
  const forms = ws.filter((w) => LEGAL.has(w));
  const blocked = pub && (pub[1] === 'government' ? forms.some((w) => w !== 'CORP' && w !== 'CORPORATION') : pub[1] === 'hoa' ? forms.some((w) => !HOA_FORMS.has(w)) : false);
  if (pub && !blocked) return { show: true, name: '', kind: pub[1] };
  if (joinsNames(ws)) return { show: false, reason: 'joined-names' };
  if (!ws.some(isEntityWord) && !/\bCREDIT UNION\b/.test(norm)) return { show: false, reason: 'no-entity-word' };
  const core = ws.filter((w) => !LEGAL.has(w) && w !== 'THE' && w !== 'OF' && w !== 'AND' && w !== '&' && !/^\d+$/.test(w));
  const brand = BRANDS.some((b) => ` ${norm} `.includes(` ${b} `));
  if (!brand && !core.some((w) => BUSINESS.has(w) && !nameLike(w))) return { show: false, reason: 'name-only' };
  return { show: true, name: '', kind: kindOf(ws) };
}

/** What sort of organization a shown name is (government and HOA owners may be shown on homes). */
function kindOf(ws: string[]): OwnerKind {
  const has = (w: string) => ws.includes(w);
  const forms = ws.filter((w) => LEGAL.has(w));
  const last = ws.filter((w) => !LEGAL.has(w)).pop() ?? '';
  const lead = ws.slice(0, 2).join(' ');
  // "OREM CITY", "CITY OF OREM", "CENTRAL UTAH WATER CONSERVANCY DISTRICT": a public body, no business form.
  if (!forms.some((w) => w !== 'CORP' && w !== 'CORPORATION') && (GOV_LAST.has(last) || GOV_LEAD.has(lead))) return 'government';
  if (!forms.some((w) => !HOA_FORMS.has(w)) && (last === 'ASSOCIATION' || last === 'ASSN') && ['OWNERS', 'HOMEOWNERS', 'CONDOMINIUM', 'CONDOMINIUMS', 'TOWNHOMES', 'COMMUNITY', 'MASTER'].some(has)) return 'hoa';
  if (['CHURCH', 'PARISH', 'MINISTRIES', 'CONGREGATION'].some(has)) return 'church';
  if (['POWER', 'GAS', 'UTILITIES', 'RAILROAD', 'ENERGY', 'ELECTRIC'].some(has)) return 'utility';
  return 'business';
}

/** The owner name as the county wrote it, spaces tidied, or null when it is not a string. */
const tidy = (raw: unknown) => (typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : null);

/**
 * Whether an owner name may be shown, by the name alone (see the rules at the top). The shown name is
 * the county's own text with its spacing tidied.
 */
export function classifyOwner(raw: unknown): OwnerClass {
  const text = tidy(raw);
  if (!text) return { show: false, reason: 'empty' };
  if (text.length > OWNER_MAX) return { show: false, reason: 'too-long' };
  // Several owners in one field: every one must pass.
  const parts = (raw as string).split(/[;|\r\n]+/).map(normalizeOwner).filter(Boolean);
  if (!parts.length) return { show: false, reason: 'empty' };
  let kind: OwnerKind | null = null;
  for (const part of parts) {
    const r = classifyOne(part);
    if (!r.show) return r;
    kind = kind ?? r.kind;
  }
  // "SMITH, JOHN" after an entity: a comma part with no entity word and a name in it is a person.
  for (const seg of (raw as string).split(/[;|\r\n]+/)) {
    for (const c of seg.split(',').slice(1).map(normalizeOwner).filter(Boolean)) {
      const ws = words(c);
      const entity = ws.some(isEntityWord) || PUBLIC.some(([re]) => re.test(c));
      if (!entity && ws.some(nameLike)) return { show: false, reason: 'comma-name' };
    }
  }
  return { show: true, name: text, kind: kind ?? 'business' };
}

export type PropertyClass = 'residential' | 'other' | 'unknown';

const HOME = /\b(?:RES|RESID\w*|SINGLE|SFR?|SFD|FAMILY|MULTI ?FAMILY|CONDO\w*|TOWN ?HO(?:ME|USE)S?|TWNH\w*|TWIN ?HOMES?|PUD|PLANNED UNIT|DUPLEX|TRIPLEX|FOURPLEX|FOUR ?PLEX|\w*PLEX|MOBILE|MANUFACTURED|DWELLING\w*|APARTMENTS?|APT\w*|HOMES?|HOUSE|RESIDENCE|LIVING UNIT|UNIT)\b/;
const VACANT = /\b(?:VACANT|UNIMPROVED|UNDEVELOPED|BARE LAND)\b/;

/**
 * A property type in three classes. A home of any kind (single family, condo, townhome, PUD, duplex,
 * mobile home, apartments) is residential; a vacant lot is not; no type at all is unknown. A
 * subdivision name naming a condominium also makes the parcel residential (stacked condo units).
 */
export function propertyClass(propType: unknown, subName?: unknown): PropertyClass {
  const sub = typeof subName === 'string' ? normalizeOwner(subName) : '';
  if (/\bCONDO\w*\b/.test(sub)) return 'residential';
  const t = typeof propType === 'string' ? normalizeOwner(propType.replace(/[-_/]/g, ' ')) : '';
  if (!t) return 'unknown';
  if (VACANT.test(t) && !/\b(?:CONDO\w*|UNIT)\b/.test(t)) return 'other';
  return HOME.test(t) ? 'residential' : 'other';
}

/**
 * The full decision for one parcel: the owner name rules, then the residential rule (on a home, or
 * when the property type is unknown, only a government or an HOA is shown).
 */
export function ownerDecision(input: { owner: unknown; propType?: unknown; subName?: unknown }): OwnerClass {
  const c = classifyOwner(input.owner);
  if (!c.show) return c;
  if (c.kind === 'government' || c.kind === 'hoa') return c;
  const p = propertyClass(input.propType, input.subName);
  if (p === 'residential') return { show: false, reason: 'residential' };
  if (p === 'unknown') return { show: false, reason: 'type-unknown' };
  return c;
}

/** The year of a Utah County vesting document number ("123456:2021" or "123456-2021"), or null. */
export function deedYear(vestingDoc: unknown): number | null {
  const m = typeof vestingDoc === 'string' || typeof vestingDoc === 'number' ? /^\s*\d{1,9}\s*[:-]\s*((?:18|19|20)\d{2})\s*$/.exec(String(vestingDoc)) : null;
  const y = m ? Number(m[1]) : NaN;
  return Number.isInteger(y) && y <= new Date().getUTCFullYear() ? y : null;
}
