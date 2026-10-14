import { describe, expect, it } from 'vitest';
import { RENAMED_BOARDS, isVacantBoard, isVacantBoardName } from '../worker/lib/boardRenames';

describe('renamed and cleared boards', () => {
  it('the Active Transportation Commission is now the Pedestrian Safety Commission, with no members', () => {
    expect(RENAMED_BOARDS['active-transportation-commission']).toEqual({ name: 'Pedestrian Safety Commission', formerName: 'Active Transportation Commission', vacant: true });
    expect(isVacantBoard('active-transportation-commission')).toBe(true);
    expect(isVacantBoard('planning-commission')).toBe(false);
  });
  it('matches every name the board is listed under', () => {
    for (const n of ['Active Transportation Commission', 'bicycle advisory commission', ' Pedestrian Safety Commission ']) expect(isVacantBoardName(n)).toBe(true);
    expect(isVacantBoardName('Planning Commission')).toBe(false);
  });
});
