import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { RichEmailEditor } from '@/components/admin/email/RichEmailEditor';

jest.mock('@/lib/ThemeProvider', () => ({
  useTheme: () => ({ th: { fontUI: '', text: '#000', textMute: '#555', textFaint: '#999', bg: '#fff', bgElev: '#fff', surface2: '#f4f4f4', line: '#eee', accent: '#06c' } }),
}));

// Stubs jsdom requis par ProseMirror (positions/mesures absentes de jsdom).
beforeAll(() => {
  Range.prototype.getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
  Range.prototype.getClientRects = () =>
    ({ length: 0, item: () => null, [Symbol.iterator]: Array.prototype[Symbol.iterator] }) as unknown as DOMRectList;
  (document as unknown as { elementFromPoint: () => null }).elementFromPoint = () => null;
});

const vars = [{ key: 'prenom', label: 'Prénom', sample: 'Marie' }];

describe('RichEmailEditor', () => {
  it('rend un jeton lisible pour {{prenom}}', async () => {
    render(<RichEmailEditor value="<p>Bonjour {{prenom}}</p>" vars={vars} onChange={() => {}} />);
    await waitFor(() => expect(screen.getByText('Prénom')).toBeInTheDocument());
  });

  it('insère une variable via le menu et émet le format stocké', async () => {
    const onChange = jest.fn();
    render(<RichEmailEditor value="<p>Bonjour</p>" vars={vars} onChange={onChange} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Insérer une info/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Insérer une info/ }));
    fireEvent.click(screen.getByRole('button', { name: /Prénom/ }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.at(-1)![0]).toContain('{{prenom}}');
  });

  it('ne montre PAS le menu « Insérer une info » sans variables', async () => {
    render(<RichEmailEditor value="<p>Bonjour</p>" vars={[]} onChange={() => {}} />);
    await waitFor(() => expect(screen.getByText('Bonjour')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Insérer une info/ })).toBeNull();
  });

  it('une ligne : sérialise en texte brut sans balises', async () => {
    const onChange = jest.fn();
    render(<RichEmailEditor singleLine value="Objet {{prenom}}" vars={vars} onChange={onChange} />);
    await waitFor(() => expect(screen.getByText('Prénom')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Insérer une info/ }));
    fireEvent.click(screen.getByRole('button', { name: /Prénom/ }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const out = onChange.mock.calls.at(-1)![0] as string;
    expect(out).not.toMatch(/</);
    expect(out).toContain('{{prenom}}');
  });
});
