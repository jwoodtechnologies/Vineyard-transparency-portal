/**
 * Boards the city renamed and cleared. The meetings held under the old name stay on file under the same
 * body; the portal shows the current name and no members until the city appoints new ones.
 * Source: Jacob Wood, Vineyard City Council, October 14, 2026: the Active Transportation Commission is
 * now the Pedestrian Safety Commission and has no members.
 */
export interface RenamedBoard {
  name: string;
  formerName: string;
  /** No one serves on it now. Members listed elsewhere (city website, old minutes) are not shown. */
  vacant: boolean;
}

export const RENAMED_BOARDS: Record<string, RenamedBoard> = {
  'active-transportation-commission': { name: 'Pedestrian Safety Commission', formerName: 'Active Transportation Commission', vacant: true },
};

export const isVacantBoard = (id: string): boolean => Boolean(RENAMED_BOARDS[id]?.vacant);

/** Every name a cleared board has been listed under, lowercased (the city website may keep the old one). */
const VACANT_NAMES = new Set(['active transportation commission', 'bicycle advisory commission', 'pedestrian safety commission']);
export const isVacantBoardName = (name: string): boolean => VACANT_NAMES.has(name.trim().toLowerCase());
