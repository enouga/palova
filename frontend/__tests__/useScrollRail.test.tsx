import { render, act, fireEvent } from '@testing-library/react';
import { useScrollRail } from '@/lib/useScrollRail';

function setLayout(el: HTMLElement, vals: { scrollWidth: number; clientWidth: number; scrollLeft: number }) {
  Object.defineProperty(el, 'scrollWidth', { value: vals.scrollWidth, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: vals.clientWidth, configurable: true });
  Object.defineProperty(el, 'scrollLeft', { value: vals.scrollLeft, configurable: true, writable: true });
}

let lastEdges: { left: boolean; right: boolean } | null = null;
let lastScrollByPage: ((dir: 1 | -1) => void) | null = null;

function Harness({ count }: { count: number }) {
  const { railRef, edges, scrollByPage } = useScrollRail([count]);
  lastEdges = edges;
  lastScrollByPage = scrollByPage;
  return (
    <div ref={railRef} data-testid="rail">
      {Array.from({ length: count }, (_, i) => <span key={i}>item{i}</span>)}
    </div>
  );
}

beforeEach(() => { lastEdges = null; lastScrollByPage = null; });

it('mesure les bords au montage : aucun débordement mesuré → aucune flèche', () => {
  render(<Harness count={3} />);
  expect(lastEdges).toEqual({ left: false, right: false });
});

it('edges.right vrai quand le contenu déborde à droite', () => {
  const { getByTestId } = render(<Harness count={6} />);
  const rail = getByTestId('rail');
  setLayout(rail, { scrollWidth: 800, clientWidth: 300, scrollLeft: 0 });
  act(() => { fireEvent.scroll(rail); });
  expect(lastEdges).toEqual({ left: false, right: true });
});

it('edges.left vrai après défilement, edges.right faux en bout de rail', () => {
  const { getByTestId } = render(<Harness count={6} />);
  const rail = getByTestId('rail');
  setLayout(rail, { scrollWidth: 800, clientWidth: 300, scrollLeft: 500 });
  act(() => { fireEvent.scroll(rail); });
  expect(lastEdges).toEqual({ left: true, right: false });
});

it('scrollByPage appelle scrollBy avec 80% de la largeur visible, dans les deux sens', () => {
  const { getByTestId } = render(<Harness count={6} />);
  const rail = getByTestId('rail');
  setLayout(rail, { scrollWidth: 800, clientWidth: 300, scrollLeft: 0 });
  (rail as unknown as { scrollBy: jest.Mock }).scrollBy = jest.fn();
  act(() => { lastScrollByPage!(1); });
  expect(rail.scrollBy).toHaveBeenCalledWith({ left: 240, behavior: 'smooth' });
  act(() => { lastScrollByPage!(-1); });
  expect(rail.scrollBy).toHaveBeenCalledWith({ left: -240, behavior: 'smooth' });
});
