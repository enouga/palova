import { render, screen, fireEvent } from '@testing-library/react';
import { AuthPromptDialog } from '../components/openmatch/AuthPromptDialog';
import { ThemeProvider } from '../lib/ThemeProvider';

describe('AuthPromptDialog', () => {
  const setup = () => {
    const onRegister = jest.fn(), onLogin = jest.fn(), onClose = jest.fn();
    render(
      <ThemeProvider>
        <AuthPromptDialog detail="Terrain 1" onRegister={onRegister} onLogin={onLogin} onClose={onClose} />
      </ThemeProvider>
    );
    return { onRegister, onLogin, onClose };
  };

  it('propose de créer un compte ou de se connecter', () => {
    setup();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Terrain 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Créer un compte/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /déjà un compte/i })).toBeInTheDocument();
  });

  it('déclenche onRegister puis onLogin au clic', () => {
    const { onRegister, onLogin } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Créer un compte/i }));
    expect(onRegister).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /déjà un compte/i }));
    expect(onLogin).toHaveBeenCalled();
  });
});
