import { describe, expect, it } from 'vitest';
import { ALSO_FUNDED, META, alsoFunded, metaFor, plansFrom, type ProjectsContent } from '../src/console/construction';
import { checkAlso, checkDraft, editFrom, matches, moveItem, withAlso, withItem, withPlan, withoutItem, withoutPlans } from '../src/console/staff/projectsLib';

const SKATE = 'Skate Park & Pump Track';

describe('wording shown for a project', () => {
  it('uses the built-in wording until staff change it, field by field', () => {
    const base = META[SKATE];
    expect(metaFor(SKATE)).toEqual({ name: base.name, category: base.category, about: base.about });
    expect(metaFor(SKATE, { about: 'Opens in spring.' })).toEqual({ name: base.name, category: base.category, about: 'Opens in spring.' });
    expect(metaFor(SKATE, { name: 'Skate park', category: 'Buildings and equipment' })).toMatchObject({ name: 'Skate park', category: 'Buildings and equipment', about: base.about });
  });

  it('still describes a project the portal has no wording for', () => {
    expect(metaFor('Some New – Project & Plan').name).toBe('Some New Project and Plan');
    expect(metaFor('Some New Project', { about: 'Brand new.' }).about).toBe('Brand new.');
  });

  it('flows through to the project list', () => {
    const fc = { features: [{ properties: { Project_Name: SKATE, Project_Phase: 'Design', Phase_Status: '40%' } }] };
    const content: ProjectsContent = { plans: { [SKATE]: { about: 'Opens in spring.' } }, also: null };
    expect(plansFrom(fc)[0].about).toBe(META[SKATE].about);
    expect(plansFrom(fc, content)[0]).toMatchObject({ about: 'Opens in spring.', name: META[SKATE].name, stage: 'Design', pct: 40 });
  });
});

describe('the also funded list', () => {
  it('is the built-in list until staff save one, and an empty saved list is respected', () => {
    expect(alsoFunded(null).map((a) => a.name)).toEqual(ALSO_FUNDED.map((a) => a.name));
    expect(new Set(alsoFunded(null).map((a) => a.id)).size).toBe(ALSO_FUNDED.length);
    // The built-in ids already look like the ones the server makes, so a first save keeps them and rows keep their place.
    expect(alsoFunded(null).every((a) => /^a_[0-9a-f]{8,16}$/.test(a.id))).toBe(true);
    expect(alsoFunded({ plans: {}, also: [] })).toEqual([]);
  });
});

describe('what is stored after an edit', () => {
  it('keeps only fields that differ from the built-in wording', () => {
    const base = META[SKATE];
    expect(editFrom(SKATE, { name: base.name, category: base.category, about: base.about ?? '' })).toBeNull();
    expect(editFrom(SKATE, { name: `  ${base.name}  `, category: base.category, about: 'A new   description.' })).toEqual({ about: 'A new description.' });
    expect(editFrom(SKATE, { name: 'Skate park', category: 'Buildings and equipment', about: base.about ?? '' })).toEqual({ name: 'Skate park', category: 'Buildings and equipment' });
  });

  it('treats a blank description as the original, never as an empty one', () => {
    const base = META[SKATE];
    expect(editFrom(SKATE, { name: base.name, category: base.category, about: '   ' })).toBeNull();
  });

  it('adds, changes and clears a project, and reports nothing left to store', () => {
    const one = withPlan(null, SKATE, { about: 'One.' });
    expect(one).toEqual({ plans: { [SKATE]: { about: 'One.' } }, also: null });
    const two = withPlan(one, 'Other', { name: 'Other project' });
    expect(Object.keys(two?.plans ?? {}).sort()).toEqual(['Other', SKATE].sort());
    expect(withPlan(two, 'Other', null)).toEqual(one);
    expect(withPlan(one, SKATE, null)).toBeNull();
  });

  it('clears the edits for projects that left the map and keeps the rest', () => {
    const two = withPlan(withPlan(null, SKATE, { about: 'One.' }), 'Gone', { name: 'Gone project' });
    expect(withoutPlans(two, ['Gone'])).toEqual({ plans: { [SKATE]: { about: 'One.' } }, also: null });
    expect(withoutPlans(two, ['Gone', SKATE])).toBeNull();
    const withList = withAlso(two, [{ id: 'a_0123456789', name: 'Tucker Row Park', about: '' }]);
    expect(withoutPlans(withList, ['Gone', SKATE])?.also).toHaveLength(1);
    expect(withoutPlans(null, ['Gone'])).toBeNull();
  });

  it('keeps project edits when the list changes, and the list when project edits clear', () => {
    const one = withPlan(null, SKATE, { about: 'One.' });
    const both = withAlso(one, [{ id: 'a_0123456789', name: 'Tucker Row Park', about: '' }]);
    expect(both?.plans).toEqual(one?.plans);
    expect(withPlan(both, SKATE, null)?.also).toHaveLength(1);
    expect(withAlso(one, null)).toEqual(one);
    expect(withAlso(null, null)).toBeNull();
  });
});

describe('editing the list', () => {
  const list = [
    { id: 'a_1', name: 'One', about: 'x' },
    { id: 'a_2', name: 'Two', about: 'y' },
    { id: 'a_3', name: 'Three', about: 'z' },
  ];

  it('replaces, adds and removes by position, tidying spaces', () => {
    expect(withItem(list, 1, { name: '  Two   and a half ', about: 'new' })[1]).toEqual({ id: 'a_2', name: 'Two and a half', about: 'new' });
    const added = withItem(list, -1, { name: 'Four', about: '' });
    expect(added).toHaveLength(4);
    expect(added[3]).toEqual({ id: '', name: 'Four', about: '' });
    expect(withoutItem(list, 0).map((a) => a.id)).toEqual(['a_2', 'a_3']);
  });

  it('moves up and down and stops at the ends', () => {
    expect(moveItem(list, 2, -1).map((a) => a.id)).toEqual(['a_1', 'a_3', 'a_2']);
    expect(moveItem(list, 0, 1).map((a) => a.id)).toEqual(['a_2', 'a_1', 'a_3']);
    expect(moveItem(list, 0, -1)).toBe(list);
    expect(moveItem(list, 2, 1)).toBe(list);
  });
});

describe('checks before saving', () => {
  it('asks for a name and keeps lengths down', () => {
    expect(checkDraft({ name: ' ', about: '' })).toMatch(/name/);
    expect(checkDraft({ name: 'x'.repeat(91), about: '' })).toMatch(/90/);
    expect(checkDraft({ name: 'Fine', about: 'y'.repeat(501) })).toMatch(/500/);
    expect(checkDraft({ name: 'Fine', about: 'y'.repeat(500) })).toBe('');
    expect(checkAlso({ name: '', about: '' })).toMatch(/name/);
    expect(checkAlso({ name: 'Park', about: '' })).toBe('');
  });
});

describe('search', () => {
  const p = { name: 'Skate park and pump track', gis: SKATE, about: 'South of City Hall.', category: 'Parks and trails' as const, location: '' };
  it('matches name, original name, description, group and place', () => {
    for (const q of ['', 'skate', 'pump track', 'city hall', 'PARKS', 'Pump Track']) expect(matches(p, q)).toBe(true);
    expect(matches(p, 'bridge')).toBe(false);
  });
});
