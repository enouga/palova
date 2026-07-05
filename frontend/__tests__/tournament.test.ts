import {
  buildAgendaICS, deadlineCountdown, fillRatio, formatDateTime, formatDateTimeRange, formatDateShortTimeRange, formatDateTimeShort, formatHourRange,
  heroPlacesLabel, icsFilename, waitlistPosition,
} from '../lib/tournament';
import { TournamentParticipant } from '../lib/api';

const NOW = new Date('2026-06-10T12:00:00Z');

describe('deadlineCountdown', () => {
  it('null quand la deadline est passée', () => {
    expect(deadlineCountdown('2026-06-10T11:59:59Z', NOW)).toBeNull();
    expect(deadlineCountdown('2026-06-10T12:00:00Z', NOW)).toBeNull();
  });
  it('< 1 h → minutes, urgent', () => {
    expect(deadlineCountdown('2026-06-10T12:35:00Z', NOW)).toEqual({ text: 'Plus que 35 min', urgent: true });
    expect(deadlineCountdown('2026-06-10T12:00:30Z', NOW)).toEqual({ text: 'Plus que 1 min', urgent: true });
  });
  it('< 48 h → heures, urgent', () => {
    expect(deadlineCountdown('2026-06-10T18:00:00Z', NOW)).toEqual({ text: 'Plus que 6 h', urgent: true });
    expect(deadlineCountdown('2026-06-12T11:00:00Z', NOW)).toEqual({ text: 'Plus que 47 h', urgent: true });
  });
  it('≥ 48 h → J-x, pas urgent', () => {
    expect(deadlineCountdown('2026-06-12T12:00:00Z', NOW)).toEqual({ text: 'J-2', urgent: false });
    expect(deadlineCountdown('2026-06-15T14:00:00Z', NOW)).toEqual({ text: 'J-5', urgent: false });
  });
});

describe('fillRatio', () => {
  it('ratio clampé 0..1', () => {
    expect(fillRatio({ confirmedCount: 7, maxTeams: 12 })).toBeCloseTo(7 / 12);
    expect(fillRatio({ confirmedCount: 15, maxTeams: 12 })).toBe(1);
    expect(fillRatio({ confirmedCount: 0, maxTeams: 12 })).toBe(0);
  });
  it('null sans capacité', () => {
    expect(fillRatio({ confirmedCount: 7, maxTeams: null })).toBeNull();
    expect(fillRatio({ confirmedCount: 7, maxTeams: 0 })).toBeNull();
  });
});

describe('waitlistPosition', () => {
  const p = (id: string, status: 'CONFIRMED' | 'WAITLISTED'): TournamentParticipant =>
    ({ id, status, captain: { firstName: 'A', lastName: 'A', avatarUrl: null }, partner: { firstName: 'B', lastName: 'B', avatarUrl: null } });
  const list = [p('r1', 'CONFIRMED'), p('r2', 'WAITLISTED'), p('r3', 'WAITLISTED')];
  it('position 1-based dans le groupe WAITLISTED', () => {
    expect(waitlistPosition(list, 'r2')).toBe(1);
    expect(waitlistPosition(list, 'r3')).toBe(2);
  });
  it('null pour un confirmé ou un inconnu', () => {
    expect(waitlistPosition(list, 'r1')).toBeNull();
    expect(waitlistPosition(list, 'zz')).toBeNull();
  });
});

describe('buildAgendaICS', () => {
  const t = {
    id: 't1',
    name: 'Grand Prix, été; v2',
    description: 'Ligne 1\nLigne 2',
    startTime: '2026-07-09T12:01:00.000Z',
    endTime: null,
    club: { name: 'Toulouse Padel Indoor' },
  };
  it('événement UTC complet, CRLF, échappement, DTEND = début + 2 h sans endTime', () => {
    const ics = buildAgendaICS(t, 'https://club.palova.fr/tournois/t1', NOW);
    expect(ics).toContain('BEGIN:VCALENDAR\r\n');
    expect(ics).toContain('UID:tournament-t1@palova');
    expect(ics).toContain('DTSTAMP:20260610T120000Z');
    expect(ics).toContain('DTSTART:20260709T120100Z');
    expect(ics).toContain('DTEND:20260709T140100Z');
    expect(ics).toContain('SUMMARY:Grand Prix\\, été\\; v2');
    expect(ics).toContain('DESCRIPTION:Ligne 1\\nLigne 2\\n\\nhttps://club.palova.fr/tournois/t1');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.split('\r\n').every((l) => l.length <= 74)).toBe(true);
  });
  it('respecte endTime quand présent', () => {
    const ics = buildAgendaICS({ ...t, endTime: '2026-07-09T18:00:00.000Z' }, 'https://x', NOW);
    expect(ics).toContain('DTEND:20260709T180000Z');
  });

  it('uidPrefix event → UID dédié', () => {
    const ics = buildAgendaICS(t, 'https://x', NOW, 'event');
    expect(ics).toContain('UID:event-t1@palova');
  });

  it('buildAgendaICS accepte uidPrefix "match" et préfixe l’UID', () => {
    const item = { id: 'm1', name: 'Partie ouverte · Court 2', description: null, startTime: '2026-07-05T12:00:00.000Z', endTime: '2026-07-05T13:30:00.000Z', club: { name: 'Padel Arena' } };
    const ics = buildAgendaICS(item, 'https://demo.palova.fr/parties/m1', new Date('2026-07-01T00:00:00Z'), 'match');
    expect(ics).toContain('UID:match-m1@palova');
    expect(ics).toContain('SUMMARY:Partie ouverte');
  });
});

describe('icsFilename', () => {
  it('slug sans accents ni ponctuation', () => {
    expect(icsFilename('Grand Prix Messieurs — Été P500 !')).toBe('grand-prix-messieurs-ete-p500.ics');
  });
  it('repli quand le nom ne donne rien', () => {
    expect(icsFilename('***')).toBe('tournoi.ics');
  });
});

describe('formatDateTime', () => {
  it('formate dans le fuseau du club', () => {
    expect(formatDateTime('2026-07-09T12:01:00.000Z', 'Europe/Paris')).toBe('jeudi 9 juillet à 14h01');
  });
});

describe('formatDateTimeRange', () => {
  const tz = 'Europe/Paris';
  it('sans fin → identique à formatDateTime', () => {
    expect(formatDateTimeRange('2026-07-09T12:01:00.000Z', null, tz)).toBe('jeudi 9 juillet à 14h01');
    expect(formatDateTimeRange('2026-07-09T12:01:00.000Z', undefined, tz)).toBe('jeudi 9 juillet à 14h01');
  });
  it('même jour → date non répétée, séparateur ·', () => {
    expect(formatDateTimeRange('2026-07-09T12:01:00.000Z', '2026-07-09T16:00:00.000Z', tz))
      .toBe('jeudi 9 juillet · 14h01 → 18h00');
  });
  it('jours différents → date affichée des deux côtés', () => {
    expect(formatDateTimeRange('2026-07-09T12:01:00.000Z', '2026-07-10T16:00:00.000Z', tz))
      .toBe('jeudi 9 juillet à 14h01 → vendredi 10 juillet à 18h00');
  });
  it('bascule de jour calculée dans le fuseau du club (pas en UTC)', () => {
    // Même jour UTC (9 juillet) mais 23h30 → 00h30 à Paris : doit basculer en multi-jours.
    expect(formatDateTimeRange('2026-07-09T21:30:00.000Z', '2026-07-09T22:30:00.000Z', tz))
      .toBe('jeudi 9 juillet à 23h30 → vendredi 10 juillet à 00h30');
  });
});

describe('formatDateShortTimeRange', () => {
  const tz = 'Europe/Paris';
  it('même jour → date courte non répétée, séparateur ·', () => {
    expect(formatDateShortTimeRange('2026-07-09T12:01:00.000Z', '2026-07-09T16:00:00.000Z', tz))
      .toBe('jeu. 9 juil. · 14h01 → 18h00');
  });
  it('jours différents → deux dates courtes', () => {
    expect(formatDateShortTimeRange('2026-07-09T12:01:00.000Z', '2026-07-10T16:00:00.000Z', tz))
      .toBe('jeu. 9 juil. 14h01 → ven. 10 juil. 18h00');
  });
  it('bascule de jour calculée dans le fuseau du club (pas en UTC)', () => {
    expect(formatDateShortTimeRange('2026-07-09T21:30:00.000Z', '2026-07-09T22:30:00.000Z', tz))
      .toBe('jeu. 9 juil. 23h30 → ven. 10 juil. 00h30');
  });
  it('sans fin → date courte + heure', () => {
    expect(formatDateShortTimeRange('2026-07-09T12:01:00.000Z', null, tz)).toBe('jeu. 9 juil. · 14h01');
  });
});

describe('formatHourRange', () => {
  const tz = 'Europe/Paris';
  it('sans fin → heure seule', () => {
    expect(formatHourRange('2026-07-09T12:01:00.000Z', null, tz)).toBe('14h01');
  });
  it('avec fin → plage d’heures', () => {
    expect(formatHourRange('2026-07-09T12:01:00.000Z', '2026-07-09T16:00:00.000Z', tz)).toBe('14h01 → 18h00');
  });
});

describe('formatDateTimeShort', () => {
  it('date courte + heure dans le fuseau du club', () => {
    expect(formatDateTimeShort('2026-07-09T12:01:00.000Z', 'Europe/Paris')).toBe('jeu. 9 juil. · 14h01');
  });
});

describe('heroPlacesLabel', () => {
  it('null sans capacité (le compteur du hero suffit)', () => {
    expect(heroPlacesLabel(7, null)).toBeNull();
  });
  it('plein ou surbooké → « Complet » court, jamais « liste d\'attente possible »', () => {
    expect(heroPlacesLabel(12, 12)).toEqual({ text: 'Complet', urgent: false });
    expect(heroPlacesLabel(14, 12)).toEqual({ text: 'Complet', urgent: false });
  });
  it('≤ 5 places restantes → urgent, singulier/pluriel', () => {
    expect(heroPlacesLabel(10, 12)).toEqual({ text: 'Plus que 2 places', urgent: true });
    expect(heroPlacesLabel(11, 12)).toEqual({ text: 'Plus que 1 place', urgent: true });
  });
  it('> 5 places restantes → libellé neutre', () => {
    expect(heroPlacesLabel(4, 12)).toEqual({ text: '8 places restantes', urgent: false });
  });
});
