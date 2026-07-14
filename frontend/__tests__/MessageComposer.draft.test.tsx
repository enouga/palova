import { render, screen } from '@testing-library/react';
import { MessageComposer } from '@/components/messages/MessageComposer';

jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: { line: '#ccc', surface: '#fff', text: '#111', textMute: '#666', accent: '#06c', onAccent: '#fff', fontUI: 'sans-serif' } }) }));
jest.mock('@/lib/useIsDesktop', () => ({ useIsDesktop: () => true }));

const noop = async () => true;

describe('MessageComposer — initialDraft', () => {
  it('pré-remplit le brouillon', () => {
    render(<MessageComposer onSend={noop} onSendImage={noop} onTyping={() => {}} initialDraft="On se fait une partie ?" />);
    expect(screen.getByPlaceholderText('Votre message…')).toHaveValue('On se fait une partie ?');
  });

  it('sans initialDraft : vide', () => {
    render(<MessageComposer onSend={noop} onSendImage={noop} onTyping={() => {}} />);
    expect(screen.getByPlaceholderText('Votre message…')).toHaveValue('');
  });
});
