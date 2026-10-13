/**
 * Starting points for a new account, so an administrator picks a job instead of ticking boxes. Each one only
 * fills in the department and the areas; both stay editable before the account is created.
 */
export interface Preset {
  key: string;
  label: string;
  blurb: string;
  department: string;
  areas: string[];
}

export const PRESETS: Preset[] = [
  { key: 'social', label: 'Social media specialist', blurb: 'Posts notices, events and updates. Cannot change anything else.', department: 'Communications', areas: ['notices'] },
  {
    key: 'recorder',
    label: 'City recorder or clerk',
    blurb: 'Adds records and meeting documents, corrects votes, keeps the directory current.',
    department: 'City Recorder',
    areas: ['records', 'votes', 'people'],
  },
  { key: 'finance', label: 'Finance', blurb: 'Updates the budget.', department: 'Finance', areas: ['budget'] },
];
