import { describe, expect, it } from 'vitest';
import { gameSize } from './layout';

describe('game size', () => {
  it('is wide on a desktop and on a turned phone', () => {
    expect(gameSize(1920, 1080)).toEqual({ width: 480, height: 270 });
    expect(gameSize(844, 390)).toEqual({ width: 480, height: 270 });
    expect(gameSize(500, 500)).toEqual({ width: 480, height: 270 });
  });

  it('is tall on an upright phone, inside limits', () => {
    expect(gameSize(390, 844)).toEqual({ width: 270, height: 580 });
    expect(gameSize(360, 640)).toEqual({ width: 270, height: 480 });
    expect(gameSize(768, 1024)).toEqual({ width: 270, height: 460 });
    expect(gameSize(300, 900)).toEqual({ width: 270, height: 600 });
  });

  it('ignores a browser bar sliding away', () => {
    expect(gameSize(390, 840)).toEqual(gameSize(390, 850));
  });
});
