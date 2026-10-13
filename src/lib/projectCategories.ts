/** The groups a funded project can be placed in. Shared by the public map list, the staff screen and the worker's checks, so there is one list. */
export const PROJECT_CATEGORIES = ['Roads and traffic', 'Parks and trails', 'Water and sewer', 'Buildings and equipment', 'Plans and studies'] as const;
export type ProjectCategory = (typeof PROJECT_CATEGORIES)[number];
