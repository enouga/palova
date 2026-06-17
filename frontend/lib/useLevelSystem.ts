'use client';
import { useClub } from './ClubProvider';

/** Le système de niveau est-il actif pour le club courant ? club absent/inconnu → considéré actif (rétrocompat). */
export function useLevelSystemEnabled(): boolean {
  const { club } = useClub();
  return club?.levelSystemEnabled !== false;
}
