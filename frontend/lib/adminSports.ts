// Helpers PURS de l'onglet Sports des Réglages. Aucune horloge, aucun fetch, aucun JSX.
//
// Sports ne modifie pas des champs du `Club` mais des entités `ClubSport` distinctes.
// Pour tenir dans le modèle brouillon + barre « Enregistrer » de la page, on aplatit
// l'état en lignes éditables, et l'enregistrement se déduit d'un diff baseline↔brouillon.
import type { AdminClubSport, Sport } from '@/lib/api';
import { effectiveDurations } from '@/lib/duration';

/** Une ligne du brouillon. `clubSportId: null` = sport ajouté, pas encore créé côté serveur. */
export interface SportDraftRow {
  clubSportId: string | null;
  sportId: string;
  name: string;
  defaultDurationsMin: number[];
  durationsMin: number[];
}

export interface SportsDiff {
  /** Sports à créer (POST), avec les durées choisies avant enregistrement. */
  toAdd: { sportId: string; durationsMin: number[] }[];
  /** Sports existants dont les durées ont changé (PATCH). */
  toUpdate: { clubSportId: string; durationsMin: number[] }[];
}

const sorted = (l: number[]) => [...l].sort((a, b) => a - b);

/** Deux listes de durées portent-elles le même choix (ordre indifférent) ? */
export const sameDurations = (a: number[], b: number[]) =>
  a.length === b.length && sorted(a).every((v, i) => v === sorted(b)[i]);

/** Baseline éditable depuis les sports activés du club (durées résolues une fois pour toutes). */
export function sportsDraftFrom(enabled: AdminClubSport[]): SportDraftRow[] {
  return enabled.map((cs) => ({
    clubSportId: cs.id,
    sportId: cs.sport.id,
    name: cs.sport.name,
    defaultDurationsMin: cs.sport.defaultDurationsMin,
    durationsMin: effectiveDurations(cs.durationsMin, cs.sport.defaultDurationsMin),
  }));
}

/** Ajoute un sport du catalogue au brouillon, semé de ses durées par défaut. Déjà présent → inchangé. */
export function addSportToDraft(rows: SportDraftRow[], sport: Sport): SportDraftRow[] {
  if (rows.some((r) => r.sportId === sport.id)) return rows;
  return [...rows, {
    clubSportId: null,
    sportId: sport.id,
    name: sport.name,
    defaultDurationsMin: sport.defaultDurationsMin,
    durationsMin: effectiveDurations(undefined, sport.defaultDurationsMin),
  }];
}

/** Coche/décoche une durée. Retirer la dernière durée d'un sport est refusé (brouillon inchangé). */
export function toggleDurationInDraft(rows: SportDraftRow[], sportId: string, min: number): SportDraftRow[] {
  const row = rows.find((r) => r.sportId === sportId);
  if (!row) return rows;
  const on = row.durationsMin.includes(min);
  if (on && row.durationsMin.length === 1) return rows; // au moins une durée
  const next = on ? row.durationsMin.filter((d) => d !== min) : sorted([...row.durationsMin, min]);
  return rows.map((r) => (r.sportId === sportId ? { ...r, durationsMin: next } : r));
}

/** Ce qu'il faut envoyer au serveur pour que la baseline rejoigne le brouillon. */
export function sportsDiff(server: SportDraftRow[], draft: SportDraftRow[]): SportsDiff {
  const toAdd = draft
    .filter((r) => r.clubSportId === null)
    .map((r) => ({ sportId: r.sportId, durationsMin: r.durationsMin }));

  const toUpdate = draft
    .filter((r): r is SportDraftRow & { clubSportId: string } => r.clubSportId !== null)
    .filter((r) => {
      const base = server.find((s) => s.clubSportId === r.clubSportId);
      return !!base && !sameDurations(base.durationsMin, r.durationsMin);
    })
    .map((r) => ({ clubSportId: r.clubSportId, durationsMin: r.durationsMin }));

  return { toAdd, toUpdate };
}

/** Vrai si le brouillon Sports diffère de la baseline. */
export function sportsDirty(server: SportDraftRow[], draft: SportDraftRow[]): boolean {
  const { toAdd, toUpdate } = sportsDiff(server, draft);
  return toAdd.length > 0 || toUpdate.length > 0;
}
