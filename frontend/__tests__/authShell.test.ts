import { PANEL_COPY, CLUB_PANEL_LINE, clubPanelWash } from '../lib/authShell';

describe('authShell helpers', () => {
  it('clubPanelWash : dégradé clair contenant l\'accent (jamais de panneau sombre)', () => {
    const wash = clubPanelWash('#7a4dd8');
    expect(wash).toMatch(/^linear-gradient\(115deg,/);
    expect(wash).toContain('color-mix');
    // L'accent apparaît deux fois (les deux bornes du dégradé), toujours mixé vers le blanc.
    expect(wash.match(/#7a4dd8/g)).toHaveLength(2);
  });

  it('PANEL_COPY : les deux audiences ont headline, ligne et 3 chips icônés', () => {
    for (const audience of ['player', 'club'] as const) {
      const copy = PANEL_COPY[audience];
      expect(copy.headline.length).toBeGreaterThan(0);
      expect(copy.line.length).toBeGreaterThan(0);
      expect(copy.chips).toHaveLength(3);
      for (const chip of copy.chips) {
        expect(chip.icon.length).toBeGreaterThan(0);
        expect(chip.label.length).toBeGreaterThan(0);
      }
    }
  });

  it('CLUB_PANEL_LINE : ligne dédiée à l\'identité club', () => {
    expect(CLUB_PANEL_LINE).toContain('tournois');
  });
});
