import { describe, it, expect } from 'vitest';
import {
  fitCamera,
  clampCamera,
  zoomCamera,
  resizeCamera,
  project,
  unproject,
  placeLabels,
} from '../src/ui/map/camera';
describe('strategic camera invariants', () => {
  it.each([
    [1360, 740],
    [1100, 550],
    [900, 700],
  ])('FIT covers the entire sector with no off-world area %sx%s', (w, h) => {
    const c = fitCamera(w, h);
    expect(project({ x: 0, y: 0 }, c)).toEqual({ x: 0, y: 0 });
    expect(project({ x: 1600, y: 800 }, c)).toEqual({ x: w, y: h });
    expect(zoomCamera(c, 0.1, { x: w / 2, y: h / 2 })).toEqual(c);
  });
  it('preserves the pointed world coordinate through zoom and bounds extreme pans', () => {
    const c = fitCamera(1100, 600),
      p = { x: 413, y: 290 },
      z = zoomCamera(c, 3, p);
    expect(unproject(p, z).x).toBeCloseTo(unproject(p, c).x, 8);
    expect(unproject(p, z).y).toBeCloseTo(unproject(p, c).y, 8);
    const a = clampCamera({ ...z, x: 1e6, y: -1e6 });
    expect(a.x).toBe(0);
    expect(a.y).toBe(-1200);
  });
  it('resize preserves world center and zoom then re-clamps camera', () => {
    const c = zoomCamera(fitCamera(1100, 600), 3, { x: 550, y: 300 }),
      r = resizeCamera(c, 800, 700);
    expect(unproject({ x: 400, y: 350 }, r)).toEqual(unproject({ x: 550, y: 300 }, c));
    expect(r.k).toBe(3);
  });
  it('label layout culls overlaps and remains inside viewport', () => {
    const labels = placeLabels(
      Array.from({ length: 20 }, (_, i) => ({
        id: String(i),
        text: 'SHIP ' + i,
        x: 200,
        y: 200,
        priority: i,
        color: '#fff',
      })),
      400,
      400,
    );
    expect(labels.length).toBeLessThan(20);
    for (let i = 0; i < labels.length; i++)
      for (let j = i + 1; j < labels.length; j++)
        expect(
          Math.abs(labels[i].y - labels[j].y) >= 20 ||
            Math.abs(labels[i].x - labels[j].x) >= (labels[i].width + labels[j].width) / 2,
        ).toBe(true);
  });
});
