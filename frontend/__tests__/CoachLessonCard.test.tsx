import { render, screen, fireEvent } from '@testing-library/react';
import { CoachLessonCard } from '../components/coach/CoachLessonCard';
import { ThemeProvider } from '../lib/ThemeProvider';
import type { CoachLessonRow } from '../lib/api';

const lesson: CoachLessonRow = {
  id: 'les-1', lessonKind: 'GROUP', seriesId: null,
  reservation: { startTime: '2099-01-01T10:00:00Z', endTime: '2099-01-01T11:00:00Z', resource: { name: 'Court 1' } },
  sport: { key: 'padel', name: 'Padel' },
  series: null, capacity: 4, confirmedCount: 1, waitlistCount: 0,
  students: [{ id: 'enr-1', status: 'CONFIRMED', firstName: 'Ana', lastName: 'B', avatarUrl: null, phone: '0611', waitlistPosition: null }],
};

const mount = (props: Partial<React.ComponentProps<typeof CoachLessonCard>> = {}) =>
  render(<ThemeProvider>
    <CoachLessonCard lesson={lesson} tz="Europe/Paris" editable onAddStudent={jest.fn()} onRemoveStudent={jest.fn()} {...props} />
  </ThemeProvider>);

it('affiche le terrain, l\'élève et son téléphone', () => {
  mount();
  expect(screen.getByText('Court 1')).toBeInTheDocument();
  expect(screen.getByText(/Ana B/)).toBeInTheDocument();
  expect(screen.getByText('0611')).toBeInTheDocument();
});

it('cours éditable (à venir) : bouton Ajouter + retrait par élève', () => {
  const onAdd = jest.fn(); const onRemove = jest.fn();
  mount({ onAddStudent: onAdd, onRemoveStudent: onRemove });
  fireEvent.click(screen.getByRole('button', { name: /Ajouter un élève/i }));
  expect(onAdd).toHaveBeenCalledWith('les-1');
  fireEvent.click(screen.getByRole('button', { name: /Retirer Ana B/i }));
  expect(onRemove).toHaveBeenCalledWith('les-1', 'enr-1');
});

it('cours en lecture seule (passé) : pas de bouton Ajouter ni retrait', () => {
  mount({ editable: false });
  expect(screen.queryByRole('button', { name: /Ajouter un élève/i })).toBeNull();
  expect(screen.queryByRole('button', { name: /Retirer/i })).toBeNull();
});
