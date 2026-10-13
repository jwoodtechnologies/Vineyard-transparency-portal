import { describe, expect, it } from 'vitest';
import { DIRECTORY, LINKS, cleanPhone, contactsFrom, directoryFor, safeHref, serviceRows, servicesFrom, telHref, wordsMatcher } from '../src/lib/cityServices';
import { asContacts, asServices } from '../src/console/useCityServices';
import { addedFrom, checkService, serviceEditFrom, withAdded, withHidden, withServiceEdit, withoutAdded } from '../src/console/staff/servicesLib';

describe('the built-in lists', () => {
  it('are what the portal shipped with when nothing is saved', () => {
    expect(servicesFrom(null)).toBe(DIRECTORY);
    expect(contactsFrom(null).cityHall).toEqual(LINKS.cityHall);
    expect(new Set(DIRECTORY.map((d) => d.id)).size).toBe(DIRECTORY.length);
    expect(telHref('801-226-1929')).toBe(LINKS.cityHall.href);
  });
});

describe('links and numbers staff type', () => {
  it('only lets web pages and portal pages through', () => {
    expect(safeHref('https://www.vineyardutah.gov/a b')).toBe('https://www.vineyardutah.gov/a%20b');
    expect(safeHref('/people')).toBe('/people');
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', '//x.example', 'https://u:p@x.example', 'mailto:a@b.c', 'https://localhost/', '']) expect(safeHref(bad), bad).toBeNull();
  });
  it('writes phones the city way', () => {
    expect(cleanPhone('1 (801) 226-1929')).toBe('801-226-1929');
    expect(cleanPhone('226-1929')).toBeNull();
  });
  it('matches the words staff typed as words, never as a pattern', () => {
    const m = wordsMatcher(['dog license', 'a.b'])!;
    expect(m.test('How do I get a Dog  License?')).toBe(true);
    expect(m.test('axb')).toBe(false);
    expect(wordsMatcher([])).toBeNull();
  });
});

describe('staff changes over the built-in list', () => {
  const content = {
    edits: { fees: { label: 'Fees 2027', words: ['what does it cost to'] } },
    hidden: ['jobs'],
    added: [{ id: 's_0123456789', label: 'Dog license', hint: '', href: 'https://example.org/dogs', group: 'Permits and development' as const, kind: 'form' as const, words: ['dog license'] }],
  };
  it('renames, hides and adds, and the answers find them', () => {
    const list = servicesFrom(content);
    expect(list.find((e) => e.id === 'fees')?.label).toBe('Fees 2027');
    expect(list.some((e) => e.id === 'jobs')).toBe(false);
    expect(directoryFor('dog license please', 4, list)[0].id).toBe('s_0123456789');
    expect(directoryFor('what does it cost to build', 4, list).some((e) => e.id === 'fees')).toBe(true);
    const rows = serviceRows(content);
    expect(rows.find((r) => r.entry.id === 'jobs')?.hidden).toBe(true);
    expect(rows.find((r) => r.entry.id === 'fees')?.edited).toBe(true);
  });
  it('keeps the built-in address when a stored one is not safe', () => {
    expect(servicesFrom({ edits: { fees: { href: 'javascript:alert(1)' } }, hidden: [], added: [] }).find((e) => e.id === 'fees')?.href).toBe(DIRECTORY.find((e) => e.id === 'fees')?.href);
  });
  it('lays phone changes over the quick links and hides on request', () => {
    const l = contactsFrom({ edits: { cityHall: { phone: '801-555-0100' } }, hidden: ['gas'] });
    expect(l.cityHall.hint).toBe('801-555-0100');
    expect(l.cityHall.href).toBe('tel:+18015550100');
    expect(l.gas.hidden).toBe(true);
  });
  it('reads a bad answer as nothing', () => {
    expect(asServices('x')).toBeNull();
    expect(asServices({ edits: [], hidden: 'x', added: [{ id: 1 }] })).toEqual({ edits: {}, hidden: [], added: [] });
    expect(asContacts(null)).toBeNull();
  });
});

describe('the staff screen working copy', () => {
  const d = { label: 'Fee schedule', hint: '', href: DIRECTORY.find((e) => e.id === 'fees')!.href, group: 'Financial reports' as const, kind: 'page' as const, words: '' };
  it('stores nothing for an unchanged service and clears back to nothing', () => {
    expect(serviceEditFrom('fees', d)).toBeNull();
    const one = withServiceEdit(null, 'fees', serviceEditFrom('fees', { ...d, label: 'Fees' }));
    expect(one?.edits.fees).toEqual({ label: 'Fees' });
    expect(withServiceEdit(one, 'fees', null)).toBeNull();
    expect(withHidden(withHidden(null, 'jobs', true), 'jobs', false)).toBeNull();
  });
  it('adds and removes added services', () => {
    const one = withAdded(null, addedFrom({ ...d, label: 'Dog license', href: 'https://example.org/dogs', words: 'Dog License, pet license' }));
    expect(one?.added[0]).toMatchObject({ id: '', words: ['dog license', 'pet license'] });
    expect(withoutAdded({ ...one!, added: [{ ...one!.added[0], id: 's_1' }], hidden: ['s_1'] }, 's_1')).toBeNull();
  });
  it('explains what is wrong before saving', () => {
    expect(checkService({ ...d, label: ' ' })).toMatch(/name/);
    expect(checkService({ ...d, href: 'javascript:alert(1)' })).toMatch(/web address/);
    expect(checkService(d)).toBe('');
  });
});
