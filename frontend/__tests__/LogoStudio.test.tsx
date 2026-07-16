import { render, screen, fireEvent } from '@testing-library/react';
import { LogoStudio } from '@/components/admin/settings/LogoStudio';

jest.mock('@/lib/ThemeProvider', () => ({
  useTheme: () => ({ th: new Proxy({}, { get: () => '#000' }) }),
}));
jest.mock('@/lib/api', () => ({ assetUrl: (p: string | null) => p }));

const club = { logoUrl: '/uploads/logos/i.png', logoWideUrl: null, logoWideDarkUrl: null, name: 'Padel Arena', accentColor: '#5e93da' };

function setup(over: Partial<Parameters<typeof LogoStudio>[0]> = {}) {
  const onPick = jest.fn(); const onDelete = jest.fn();
  render(<LogoStudio club={club as any} uploading={null} warnings={{}} onPick={onPick} onDelete={onDelete} {...over} />);
  return { onPick, onDelete };
}

describe('LogoStudio', () => {
  it('affiche les 3 emplacements (icône, logotype, avancé)', () => {
    setup();
    expect(screen.getByText(/Icône carrée/i)).toBeInTheDocument();
    expect(screen.getByText(/Logotype horizontal/i)).toBeInTheDocument();
    expect(screen.getByText(/fond sombre/i)).toBeInTheDocument();
  });

  it('upload icône appelle onPick("icon")', () => {
    const { onPick } = setup();
    const input = screen.getByLabelText(/Choisir l’icône/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'i.png', { type: 'image/png' })] } });
    expect(onPick).toHaveBeenCalledWith('icon', expect.any(File));
  });

  it('affiche le warning serveur sous l’emplacement', () => {
    setup({ warnings: { wide: 'LOOKS_SQUARE' } });
    expect(screen.getByText(/semble carrée/i)).toBeInTheDocument();
  });

  it('Retirer le logotype appelle onDelete("wide")', () => {
    const { onDelete } = setup({ club: { ...club, logoWideUrl: '/uploads/logos/w.png' } as any });
    fireEvent.click(screen.getByRole('button', { name: /Retirer le logotype/i }));
    expect(onDelete).toHaveBeenCalledWith('wide');
  });
});
