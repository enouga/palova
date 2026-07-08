// Helpers purs pour la page admin « Membres » : recherche, segments, tri, KPI, export CSV.
// Aucun DOM, aucun `new Date()` au rendu — le `nowMs` est injecté par l'appelant (hydration-safe).
import { Member } from './api';

// minuscules + suppression des accents, pour une recherche tolérante (« benoit » trouve « Benoît »)
export const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export type MemberSeg = 'all' | 'subs' | 'staff' | 'watch' | 'blocked';
export type MemberSort = 'name' | 'recent' | 'activity';

/** Libellé du rôle back-office (partagé liste / panneau / CSV). */
export const STAFF_LABEL: Record<'OWNER' | 'ADMIN' | 'STAFF', string> = { OWNER: 'Gérant', ADMIN: 'Admin', STAFF: 'Staff' };

const inSeg = (m: Member, seg: MemberSeg): boolean => {
  switch (seg) {
    case 'subs': return m.isSubscriber;
    case 'staff': return m.staffRole != null;
    case 'watch': return !!m.watch;
    case 'blocked': return m.status === 'BLOCKED';
    default: return true;
  }
};

/** Filtre par segment puis par recherche multi-termes (ET, sous-chaîne, insensible aux accents). */
export function filterMembers(members: Member[], query: string, seg: MemberSeg): Member[] {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  return members.filter((m) => {
    if (!inSeg(m, seg)) return false;
    if (terms.length === 0) return true;
    const hay = norm(`${m.firstName} ${m.lastName} ${m.email} ${m.phone ?? ''} ${m.membershipNo ?? ''}`);
    return terms.every((t) => hay.includes(t));
  });
}

/** Compteurs par segment (sur l'ensemble donné — typiquement déjà filtré par la recherche). */
export function segCounts(members: Member[]): Record<MemberSeg, number> {
  const c: Record<MemberSeg, number> = { all: 0, subs: 0, staff: 0, watch: 0, blocked: 0 };
  for (const m of members) {
    c.all++;
    if (m.isSubscriber) c.subs++;
    if (m.staffRole != null) c.staff++;
    if (m.watch) c.watch++;
    if (m.status === 'BLOCKED') c.blocked++;
  }
  return c;
}

/** Tri stable, sans mutation de l'entrée. */
export function sortMembers(members: Member[], sort: MemberSort): Member[] {
  const out = [...members];
  if (sort === 'name') {
    out.sort((a, b) =>
      `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'fr', { sensitivity: 'base' }));
  } else if (sort === 'recent') {
    out.sort((a, b) => (Date.parse(b.since ?? '') || 0) - (Date.parse(a.since ?? '') || 0));
  } else {
    // activité : dernière venue décroissante, jamais-venu (null) en dernier
    out.sort((a, b) => {
      const av = a.lastSeenAt ? Date.parse(a.lastSeenAt) : -Infinity;
      const bv = b.lastSeenAt ? Date.parse(b.lastSeenAt) : -Infinity;
      return bv - av;
    });
  }
  return out;
}

/** Jours entiers écoulés depuis un ISO (null si absent). */
export function daysSince(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((nowMs - t) / 86_400_000);
}

/** Bandeau KPI : total, abonnés, actifs (dernière venue < 30 j), bloqués. */
export function memberKpis(members: Member[], nowMs: number): {
  total: number; subscribers: number; activeRecent: number; blocked: number;
} {
  let subscribers = 0, activeRecent = 0, blocked = 0;
  for (const m of members) {
    if (m.isSubscriber) subscribers++;
    if (m.status === 'BLOCKED') blocked++;
    const d = daysSince(m.lastSeenAt, nowMs);
    if (d != null && d < 30) activeRecent++;
  }
  return { total: members.length, subscribers, activeRecent, blocked };
}

/** Date JJ/MM/AAAA en UTC (déterministe), ou '' si absente. */
function frDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

const csvCell = (v: string): string =>
  /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

const CSV_HEADERS = [
  'Prénom', 'Nom', 'Email', 'Téléphone', 'N° adhérent', 'Abonné', 'Formule',
  'Carnet actif', 'Statut', 'Rôle', 'Niveau', 'Dernière venue', 'Membre depuis', 'À surveiller', 'Note',
];

/** Export CSV de la liste (déjà filtrée/triée par l'appelant). BOM + `;` pour Excel FR. */
export function membersCsv(members: Member[], _nowMs: number): string {
  const rows = members.map((m) => [
    m.firstName, m.lastName, m.email, m.phone ?? '', m.membershipNo ?? '',
    m.isSubscriber ? 'Oui' : 'Non',
    m.subscriptionPlan ?? '',
    m.hasActivePackage ? 'Oui' : 'Non',
    m.status === 'BLOCKED' ? 'Bloqué' : 'Actif',
    m.staffRole ? STAFF_LABEL[m.staffRole] : '',
    m.level ? String(m.level.level) : '',
    frDate(m.lastSeenAt),
    frDate(m.since),
    m.watch ? 'Oui' : 'Non',
    m.note ?? '',
  ].map((c) => csvCell(String(c))).join(';'));
  return '﻿' + [CSV_HEADERS.join(';'), ...rows].join('\r\n');
}
