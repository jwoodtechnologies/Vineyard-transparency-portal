/**
 * The wording each project on the city's Capital Improvement Plan map ships with: a plain display name, a group and a short
 * description from the council's FY 2026-2027 Capital Projects Reference Guide, keyed by the project's name on the city's map.
 * Shared by the public map page, the staff editor and the staff activity log, so all three call a project the same thing.
 */
import type { ProjectCategory } from './projectCategories';

export interface ProjectMeta {
  name: string;
  category: ProjectCategory;
  about?: string;
}

/** Display name, group and plain description for each project on the city's plan map. */
export const META: Record<string, ProjectMeta> = {
  '1200 North Bridge': {
    name: '1200 North overpass bridge',
    category: 'Roads and traffic',
    about:
      'Design is underway. Construction is expected in the next construction season, to improve regional connectivity and traffic flow. The city received $10 million from the State for this project.',
  },
  '1600 N Geneva Road Intersection Widening': {
    name: '1600 North and Geneva Road intersection widening',
    category: 'Roads and traffic',
    about: 'More capacity and better traffic flow at 1600 North and Geneva Road. The project is reimbursed over seven years through the RDA.',
  },
  '300 West Striping & Design (Parking Implementation)': {
    name: '300 West striping and parking',
    category: 'Roads and traffic',
    about: 'Restriping and parking layout changes along 300 West to improve traffic operations and parking.',
  },
  '400 North & Mill Road Traffic Signal': {
    name: 'Traffic signal at 400 North and Mill Road',
    category: 'Roads and traffic',
    about: 'A new traffic signal at 400 North and Mill Road, paid for by the Redevelopment Agency.',
  },
  'Holdaway Fields 400 S Extension': {
    name: 'Holdaway Fields 400 South extension',
    category: 'Roads and traffic',
    about: 'Transportation improvements on the 400 South corridor that connect into the Holdaway Fields development, for safety and mobility.',
  },
  'Install Street Lights – 170 South': {
    name: 'Street lights on 170 South',
    category: 'Roads and traffic',
    about: 'New street lighting along 170 South to improve visibility, safety and the walking experience.',
  },
  'Traffic Signal – 600 N & Main': { name: 'Traffic signal at 600 North and Main', category: 'Roads and traffic', about: 'A new traffic signal at 600 North and Main Street.' },
  'Vineyard Connector Overpass Bridge': { name: 'Vineyard Connector overpass bridge', category: 'Roads and traffic', about: 'The Vineyard Connector promenade overpass, built with UDOT.' },
  'Holdaway Road Complete Street Design & Survey': {
    name: 'Holdaway Road complete street design',
    category: 'Roads and traffic',
    about: 'Planning for bicycle connections and roadway improvements along the Holdaway corridor.',
  },
  'Rail Consolidation': { name: 'Rail consolidation', category: 'Roads and traffic', about: 'Removing and realigning a rail spur.' },
  'Slide Hill at Grove Park': { name: 'Slide hill at Vineyard Grove Park', category: 'Parks and trails', about: 'A recreational slide hill, a new outdoor play feature for the park.' },
  "Engineering for Field (Gammon Park / Robin's Property)": {
    name: "Gammon Park and Robin's property design",
    category: 'Parks and trails',
    about: "Design of a new athletic field at Gammon Park, with four tennis courts and a dirt infield, and a master plan for Robin's property.",
  },
  'Skate Park & Pump Track': { name: 'Skate park and pump track', category: 'Parks and trails', about: 'A community skate park south of City Hall, paid for with RAP tax and a grant.' },
  'Vineyard Beach Park': {
    name: 'Vineyard Beach improvements',
    category: 'Parks and trails',
    about: 'Planning and design for better public access and recreation at Vineyard Beach. Partly paid for by the Utah County TRCC grant.',
  },
  'Utah Lake Shoreline Trail Amenities': {
    name: 'Utah Lake shoreline trail amenities',
    category: 'Parks and trails',
    about: 'Design and construction of shoreline trail and bike station improvements.',
  },
  'Lift Station 2 Upgrade': { name: 'Lift Station 2 upgrade', category: 'Water and sewer', about: 'An upgrade to the sewer lift station on 1600 North, carried over from last year.' },
  'Storage Building - Lift Station 2': { name: 'Storage building at Lift Station 2', category: 'Water and sewer' },
  'Water Shares Purchase': {
    name: 'Water share purchases',
    category: 'Water and sewer',
    about: 'Funds set aside to buy water shares when they become available and qualify to benefit the city.',
  },
  'Sewer System Improvements (Pipelining)': { name: 'Sewer pipe lining', category: 'Water and sewer', about: 'Sewer system improvements by pipe lining.' },
  'Secondary Water Master Plan': { name: 'Secondary water master plan', category: 'Water and sewer', about: "A master plan for using the city's irrigation water." },
  'Public Works Building Expansion & Improvements': {
    name: 'Public Works building expansion',
    category: 'Buildings and equipment',
    about: 'An expanded Public Works facility to meet future needs and support a growing workforce.',
  },
  'Dumpster Enclosures Fencing': { name: 'Dumpster enclosures', category: 'Buildings and equipment', about: 'Dumpster enclosures for a cleaner look and better waste containment around the city.' },
  'Large Shed – Roadway (1 shed)': { name: 'Large shed for streets equipment', category: 'Buildings and equipment' },
  'Small Shed – Roadway (1 shed)': { name: 'Small shed for streets equipment', category: 'Buildings and equipment' },
  'Concrete/Electrical for Sheds': { name: 'Concrete and electrical for the sheds', category: 'Buildings and equipment' },
  'Public Safety Master Plan and Impact Fee Study': {
    name: 'Public safety master plan and impact fee study',
    category: 'Plans and studies',
    about: 'A long-term plan for police, fire and emergency service needs, with Zions Bank calculating impact fees.',
  },
  'Economic Development Strategic Plan': { name: 'Economic development strategic plan', category: 'Plans and studies', about: "A plan outlining the city's economic strategies." },
};

const clean = (s: string) =>
  s
    .replace(/\s*[–—]\s*/g, ' ')
    .replace(/\s&\s/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim();

/** The wording a project ships with, before any staff change. */
export function builtInMeta(gisName: string): ProjectMeta {
  return META[gisName] ?? { name: clean(gisName), category: 'Buildings and equipment' };
}
