import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { VerifyCodeForm } from '../components/VerifyCodeForm';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('../lib/api', () => ({
  api: {
    verifyEmail: jest.fn().mockResolvedValue({ token: 'tok', user: { id: 'u1', email: 'a@b.fr', firstName: 'A', lastName: 'B', isSuperAdmin: false } }),
    resendCode: jest.fn().mockResolvedValue({ ok: true }),
  },
}));
import { api } from '../lib/api';

describe('VerifyCodeForm', () => {
  it('valide le code saisi et transmet le token à onVerified', async () => {
    const onVerified = jest.fn();
    render(<ThemeProvider><VerifyCodeForm email="a@b.fr" onVerified={onVerified} /></ThemeProvider>);

    fireEvent.change(screen.getByLabelText('Code de validation'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Valider' }));

    await waitFor(() => expect(api.verifyEmail).toHaveBeenCalledWith('a@b.fr', '123456'));
    await waitFor(() => expect(onVerified).toHaveBeenCalledWith(expect.objectContaining({ token: 'tok' })));
  });

  it('ignore les caractères non numériques (max 6 chiffres)', () => {
    render(<ThemeProvider><VerifyCodeForm email="a@b.fr" onVerified={jest.fn()} /></ThemeProvider>);
    const input = screen.getByLabelText('Code de validation') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'a1b2c3d4e5f6g7' } }); // chiffres : 1234567 → tronqué à 6
    expect(input.value).toBe('123456');
  });
});
