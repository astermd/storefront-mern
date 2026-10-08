import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MediaLocalizer } from '../../src/catalog/media-localizer';

describe('MediaLocalizer.findOrphans', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mern-media-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns an empty list when the media directory does not exist', () => {
    expect(MediaLocalizer.findOrphans(join(dir, 'nowhere'), ['aa1111-semaglutide'])).toEqual([]);
  });

  it('reports a file whose slug prefix matches no catalog slug', () => {
    writeFileSync(join(dir, 'aa1111-semaglutide.abcd1234.png'), 'x');
    writeFileSync(join(dir, 'aa1199-discontinued.deadbeef.png'), 'x');

    expect(MediaLocalizer.findOrphans(dir, ['aa1111-semaglutide'])).toEqual(['aa1199-discontinued.deadbeef.png']);
  });

  it('takes the slug as everything before the first dot, not the last', () => {
    writeFileSync(join(dir, 'aa1111-semaglutide.abcd1234.png'), 'x');
    expect(MediaLocalizer.findOrphans(dir, ['aa1111-semaglutide'])).toEqual([]);
  });

  it('ignores subdirectories', () => {
    mkdirSync(join(dir, 'a-subdirectory'));
    expect(MediaLocalizer.findOrphans(dir, [])).toEqual([]);
  });

  it('sorts the result', () => {
    writeFileSync(join(dir, 'zzz-orphan.png'), 'x');
    writeFileSync(join(dir, 'aaa-orphan.png'), 'x');
    expect(MediaLocalizer.findOrphans(dir, [])).toEqual(['aaa-orphan.png', 'zzz-orphan.png']);
  });
});
