import { render, screen } from '@testing-library/react';
import { OpenMatchCard } from '@/components/openmatch/OpenMatchCard';

jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: { accent: '#06c', onAccent: '#fff', surface: '#fff', surface2: '#eee', line: '#ccc', lineStrong: '#bbb', text: '#111', textMute: '#666', textFaint: '#999', ink: '#111', fontUI: 'sans-serif', fontDisplay: 'serif', mode: 'day' } }) }));
jest.mock('@/lib/api', () => ({ assetUrl: (p: string | null) => p }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));

const baseMatch: any = {
  id: 'm1', resourceName: 'Court 1', startTime: new Date(Date.now() + 3600000).toISOString(), endTime: new Date(Date.now() + 7200000).toISOString(),
  maxPlayers: 4, spotsLeft: 2, full: false, viewerIsParticipant: false, viewerIsOrganizer: false,
  players: [
    { userId: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null, isOrganizer: true, level: null },
    { userId: 'u9', firstName: 'Zoé', lastName: 'X', avatarUrl: null, isOrganizer: false, level: null },
  ],
  lastMessageAt: null, unreadCount: 0,
};
const noop = () => {};
const props: any = { timezone: 'Europe/Paris', slug: 'demo', token: 't', busy: false, addingOpen: false,
  onJoin: noop, onLeave: noop, onRemovePlayer: noop, onSetTeams: noop, onAddPlayer: noop, onToggleAdd: noop, onCancelAdd: noop,
  onRecordResult: noop, canRecordResult: false, onOpenChat: noop, onAuthPrompt: noop };

describe('OpenMatchCard — preuve sociale amis', () => {
  it('affiche « X de vos amis » quand des amis jouent', () => {
    render(<OpenMatchCard match={baseMatch} friendIds={new Set(['u2'])} {...props} />);
    expect(screen.getByText(/ami/i)).toBeInTheDocument();
  });
  it('n\'affiche rien quand aucun ami ne joue', () => {
    render(<OpenMatchCard match={baseMatch} friendIds={new Set()} {...props} />);
    expect(screen.queryByText(/de vos amis/i)).not.toBeInTheDocument();
  });
});
