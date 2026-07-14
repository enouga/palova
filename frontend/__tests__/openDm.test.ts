import { openDm } from '@/lib/messages';

describe('openDm — draft', () => {
  it('desktop : event window avec userId + draft', () => {
    const seen: unknown[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener('palova:open-dm', listener);
    openDm('u2', { isDesktop: true, navigate: () => {}, draft: 'On se fait une partie ?' });
    window.removeEventListener('palova:open-dm', listener);
    expect(seen).toEqual([{ userId: 'u2', draft: 'On se fait une partie ?' }]);
  });

  it('mobile : navigation avec ?draft= encodé', () => {
    const navigate = jest.fn();
    openDm('u2', { isDesktop: false, navigate, draft: 'On se fait une partie ?' });
    expect(navigate).toHaveBeenCalledWith('/me/messages?with=u2&draft=On%20se%20fait%20une%20partie%20%3F');
  });

  it('sans draft : comportement historique', () => {
    const navigate = jest.fn();
    openDm('u2', { isDesktop: false, navigate });
    expect(navigate).toHaveBeenCalledWith('/me/messages?with=u2');
  });
});
