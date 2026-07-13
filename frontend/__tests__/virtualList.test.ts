import { computeVirtualRange } from '../lib/virtualList';

describe('computeVirtualRange', () => {
  it('liste vide → tout à zéro', () => {
    expect(computeVirtualRange({ itemCount: 0, itemHeight: 76, scrollTop: 0, viewportHeight: 600 }))
      .toEqual({ start: 0, end: 0, paddingTop: 0, paddingBottom: 0 });
  });

  it('liste plus petite que le viewport → tout rendu, aucun padding', () => {
    const r = computeVirtualRange({ itemCount: 5, itemHeight: 76, scrollTop: 0, viewportHeight: 600 });
    expect(r).toEqual({ start: 0, end: 5, paddingTop: 0, paddingBottom: 0 });
  });

  it('scrollTop=0 : fenêtre depuis le début, overscan seulement en bas', () => {
    const r = computeVirtualRange({ itemCount: 1000, itemHeight: 76, scrollTop: 0, viewportHeight: 608, overscan: 3 });
    // visibleCount = ceil(608/76) = 8 ; end = 0 + 8 + 3 = 11 ; start = max(0, 0-3) = 0
    expect(r.start).toBe(0);
    expect(r.end).toBe(11);
    expect(r.paddingTop).toBe(0);
    expect(r.paddingBottom).toBe((1000 - 11) * 76);
  });

  it('scrollé au milieu : overscan des deux côtés', () => {
    const r = computeVirtualRange({ itemCount: 1000, itemHeight: 76, scrollTop: 7600, viewportHeight: 608, overscan: 3 });
    // firstVisible = floor(7600/76) = 100 ; visibleCount = 8 ; start = 97 ; end = 111
    expect(r.start).toBe(97);
    expect(r.end).toBe(111);
    expect(r.paddingTop).toBe(97 * 76);
    expect(r.paddingBottom).toBe((1000 - 111) * 76);
  });

  it('scrollé tout en bas (scrollTop = maxScroll réel) : end clampé à itemCount, paddingBottom jamais négatif', () => {
    // contenu total = 200*76 = 15200 ; maxScrollTop réel = 15200 - 608 = 14592.
    const r = computeVirtualRange({ itemCount: 200, itemHeight: 76, scrollTop: 14592, viewportHeight: 608, overscan: 3 });
    // firstVisible = floor(14592/76) = 192 ; visibleCount = 8 ; start = 189 ; end = min(200, 203) = 200
    expect(r.start).toBe(189);
    expect(r.end).toBe(200);
    expect(r.paddingBottom).toBe(0);
  });

  it('overscan par défaut = 6 quand non fourni', () => {
    const r = computeVirtualRange({ itemCount: 1000, itemHeight: 76, scrollTop: 0, viewportHeight: 608 });
    expect(r.start).toBe(0);
    expect(r.end).toBe(8 + 6);
  });

  it('scrollTop obsolète (liste réduite par un filtre après un scroll) : ne rend jamais une tranche vide', () => {
    // scrollTop hérité d'une liste de 1000 lignes, mais le filtre ne renvoie plus que 5 lignes.
    const r = computeVirtualRange({ itemCount: 5, itemHeight: 76, scrollTop: 7600, viewportHeight: 608, overscan: 3 });
    expect(r.start).toBeLessThan(r.end);
    expect(r.end).toBe(5);
    expect(r.paddingBottom).toBe(0);
  });
});
