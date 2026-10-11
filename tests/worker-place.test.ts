import { describe, expect, it } from 'vitest';
import { addressIn, mapHref, meetingPoint, placeAnswer, placeIntent, resolvePlace, roadKey, sameRoad, streetsIn, type FetchLike } from '../worker/ai/place';

describe('parcel and place questions', () => {
  it('finds the intersection in an ownership question', () => {
    const i = placeIntent('Who owns the parcel at Vineyard Connector and Main Street?');
    expect(i).toMatchObject({ kind: 'intersection', owner: true, parcel: true, streets: ['Vineyard Connector', 'Main Street'] });
  });

  it('reads other ways of naming a spot', () => {
    expect(streetsIn('what is at the corner of 400 North and Main Street')).toEqual(['400 North', 'Main Street']);
    expect(placeIntent('What is the zoning at 125 S Main St?')).toMatchObject({ kind: 'address', zoning: true, address: '125 S Main St' });
    expect(addressIn('the parcel at 1234 N 600 W please')).toBe('1234 N 600 W');
    expect(placeIntent('Where is Grove Park?')).toMatchObject({ kind: 'place', where: true, place: 'Grove Park' });
    expect(placeIntent("What's the zoning on Center Street?")).toMatchObject({ kind: 'place', zoning: true, place: 'Center Street' });
  });

  it('leaves other questions alone', () => {
    expect(placeIntent('What is the property tax rate?')).toBeNull();
    expect(placeIntent('Where is the next council meeting?')).toBeNull();
    expect(placeIntent('Where do I pay my water bill?')).toBeNull();
    expect(placeIntent('How did the council vote on Holdaway Fields and the Forge?')).toBeNull();
    expect(placeIntent('What does the zoning code say about fences?')).toBeNull();
  });

  it('matches road names in the roads layer form', () => {
    expect(roadKey('Main Street')).toBe('MAIN ST');
    expect(roadKey('400 North')).toBe('400 N');
    expect(sameRoad('N MAIN ST', 'Main Street')).toBe(true);
    expect(sameRoad('MAINSAIL ST', 'Main Street')).toBe(false);
    expect(sameRoad('VINEYARD CONNECTOR', 'Vineyard Connector')).toBe(true);
    expect(sameRoad('1400 N', '400 North')).toBe(false);
  });
});

describe('where two roads meet', () => {
  it('computes the crossing point of two center lines', () => {
    const ew = [[[-111.76, 40.3], [-111.74, 40.3]]] as Array<Array<[number, number]>>;
    const ns = [[[-111.75, 40.29], [-111.75, 40.31]]] as Array<Array<[number, number]>>;
    const m = meetingPoint(ew, ns);
    expect(m?.exact).toBe(true);
    expect(m?.point[0]).toBeCloseTo(-111.75, 6);
    expect(m?.point[1]).toBeCloseTo(40.3, 6);
  });

  it('closes a small gap at a T junction', () => {
    const ew = [[[-111.76, 40.3], [-111.74, 40.3]]] as Array<Array<[number, number]>>;
    // Ends about 22 meters short of the other road.
    const stub = [[[-111.75, 40.31], [-111.75, 40.3002]]] as Array<Array<[number, number]>>;
    const m = meetingPoint(ew, stub);
    expect(m?.exact).toBe(false);
    expect(m?.point[0]).toBeCloseTo(-111.75, 5);
    expect(m?.point[1]).toBeCloseTo(40.3001, 4);
  });

  it('returns null for roads that do not meet', () => {
    const a = [[[-111.76, 40.3], [-111.74, 40.3]]] as Array<Array<[number, number]>>;
    const b = [[[-111.76, 40.32], [-111.74, 40.32]]] as Array<Array<[number, number]>>;
    expect(meetingPoint(a, b)).toBeNull();
  });
});

describe('resolving a spot from the city roads layer', () => {
  const roads: Record<string, unknown> = {
    'VINEYARD CONNECTOR': { type: 'FeatureCollection', features: [{ properties: { FULLNAME: 'VINEYARD CONNECTOR' }, geometry: { type: 'LineString', coordinates: [[-111.76, 40.3], [-111.74, 40.302]] } }] },
    MAIN: {
      type: 'FeatureCollection',
      features: [
        { properties: { FULLNAME: 'N MAIN ST' }, geometry: { type: 'MultiLineString', coordinates: [[[-111.75, 40.29], [-111.75, 40.31]]] } },
        { properties: { FULLNAME: 'MAINSAIL ST' }, geometry: { type: 'LineString', coordinates: [[-111.7, 40.2], [-111.69, 40.2]] } },
      ],
    },
  };
  const urls: string[] = [];
  const fetchFn: FetchLike = async (url) => {
    urls.push(url);
    const where = new URL(url).searchParams.get('where') ?? '';
    const key = Object.keys(roads).find((k) => where.includes(`'%${k}%'`));
    return new Response(JSON.stringify(key ? roads[key] : { type: 'FeatureCollection', features: [] }), { status: 200 });
  };

  it('finds where Vineyard Connector and Main Street meet', async () => {
    const intent = placeIntent('Who owns the parcel at Vineyard Connector and Main Street?')!;
    const p = await resolvePlace(intent, fetchFn);
    expect(p).toMatchObject({ label: 'Vineyard Connector and Main St', layer: 'roads' });
    expect(p!.lng).toBeCloseTo(-111.75, 5);
    expect(p!.lat).toBeCloseTo(40.301, 5);
    // Only the city's roads layer, asked for road names only.
    expect(urls.every((u) => u.includes('/VNY_PWTR_Roads/FeatureServer/1/query') && new URL(u).searchParams.get('outFields') === 'FULLNAME')).toBe(true);

    const a = placeAnswer(intent, p);
    expect(a.map.href).toBe('/map?lat=40.301&lng=-111.75&z=17&label=Vineyard+Connector+and+Main+St&layers=parcels');
    expect(a.text).toBe('The map below is centered where Vineyard Connector and Main St meet, with parcel outlines shown. The portal does not show owners of homes or individuals. For land held by a company, church or government, tap the parcel on the map to see the owner from the Utah County parcel records.');
    expect(a.text).not.toMatch(/[–—]/);
  });

  it('says so when the spot cannot be found, with the plain map card', async () => {
    const intent = placeIntent('Who owns the parcel at Foo Street and Bar Street?')!;
    const p = await resolvePlace(intent, fetchFn);
    expect(p).toBeNull();
    const a = placeAnswer(intent, p);
    expect(a.text).toMatch(/^That location could not be found on the city's map layers\./);
    expect(a.text).toMatch(/does not show owners of homes or individuals\. .*Utah County parcel records\.$/);
    expect(a.map.href).toBe('/map?layers=parcels');
  });

  it('builds map links with the layers that answer the question', () => {
    const z = placeIntent('What is the zoning at 125 S Main St?')!;
    expect(mapHref({ lat: 40.3, lng: -111.75, label: '125 S Main St', layer: 'parcels' }, z)).toBe('/map?lat=40.3&lng=-111.75&z=17&label=125+S+Main+St&layers=zoning%2Cparcels');
    const park = placeIntent('Where is Grove Park?')!;
    expect(mapHref({ lat: 40.3, lng: -111.75, label: 'Grove Park', layer: 'parks' }, park)).toBe('/map?lat=40.3&lng=-111.75&z=17&label=Grove+Park&layers=parks');
  });
});
