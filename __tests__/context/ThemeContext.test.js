import { LIGHT, DARK } from '../../src/context/ThemeContext';

// ─── Palette completeness ─────────────────────────────────────────────────────

const REQUIRED_KEYS = [
  'isDark',
  'BG', 'CARD_BG', 'ELEVATED',
  'TEXT', 'TEXT_SUB', 'TEXT_MUTED', 'TEXT_FAINT',
  'ORANGE', 'DARK_ORANGE',
  'DIVIDER', 'INPUT_BG',
  'BAR_ACTIVE', 'BAR_EMPTY',
  'ICON_BG',
];

describe('LIGHT palette', () => {
  test('has all required color tokens', () => {
    REQUIRED_KEYS.forEach(key => {
      expect(LIGHT).toHaveProperty(key);
      if (key === 'isDark') {
        expect(typeof LIGHT[key]).toBe('boolean');
      } else {
        expect(LIGHT[key]).toBeTruthy();
      }
    });
  });

  test('isDark is false', () => {
    expect(LIGHT.isDark).toBe(false);
  });

  test('ORANGE is the brand color', () => {
    expect(LIGHT.ORANGE).toBe('#E8602C');
  });

  test('all color values are valid hex or boolean', () => {
    Object.entries(LIGHT).forEach(([key, value]) => {
      if (key === 'isDark') {
        expect(typeof value).toBe('boolean');
      } else {
        expect(typeof value).toBe('string');
        expect(value).toMatch(/^#[0-9A-Fa-f]{3,8}$/);
      }
    });
  });
});

describe('DARK palette', () => {
  test('has all required color tokens', () => {
    REQUIRED_KEYS.forEach(key => {
      expect(DARK).toHaveProperty(key);
    });
  });

  test('isDark is true', () => {
    expect(DARK.isDark).toBe(true);
  });

  test('ORANGE is the same brand color in both palettes', () => {
    expect(DARK.ORANGE).toBe(LIGHT.ORANGE);
  });

  test('BG is darker than LIGHT.BG (luminance check)', () => {
    // Dark BG should be a lower hex value than light BG
    const lightLum = parseInt(LIGHT.BG.slice(1), 16);
    const darkLum  = parseInt(DARK.BG.slice(1), 16);
    expect(darkLum).toBeLessThan(lightLum);
  });

  test('TEXT is lighter in dark mode', () => {
    // DARK.TEXT should be lighter (higher value) than LIGHT.TEXT
    const lightText = parseInt(LIGHT.TEXT.slice(1), 16);
    const darkText  = parseInt(DARK.TEXT.slice(1), 16);
    expect(darkText).toBeGreaterThan(lightText);
  });

  test('LIGHT and DARK have exactly the same keys', () => {
    expect(Object.keys(LIGHT).sort()).toEqual(Object.keys(DARK).sort());
  });
});

// ─── Token value sanity ───────────────────────────────────────────────────────

describe('token value sanity', () => {
  test('CARD_BG is visually distinct from BG in light mode', () => {
    expect(LIGHT.CARD_BG).not.toBe(LIGHT.BG);
  });

  test('CARD_BG is visually distinct from BG in dark mode', () => {
    expect(DARK.CARD_BG).not.toBe(DARK.BG);
  });

  test('ELEVATED is distinct from CARD_BG in both modes', () => {
    expect(LIGHT.ELEVATED).not.toBe(LIGHT.CARD_BG);
    expect(DARK.ELEVATED).not.toBe(DARK.CARD_BG);
  });

  test('TEXT and TEXT_FAINT are different in both modes', () => {
    expect(LIGHT.TEXT).not.toBe(LIGHT.TEXT_FAINT);
    expect(DARK.TEXT).not.toBe(DARK.TEXT_FAINT);
  });
});
