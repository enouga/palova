'use client';
import { createContext, useContext } from 'react';

/** Rôle back-office d'un membre du club (miroir de ManagedClub.role, lib/api.ts). */
export type ClubStaffRole = 'OWNER' | 'ADMIN' | 'STAFF';

/**
 * Le viewer voit-il les éléments réservés aux admins (guide de démarrage, abonnement
 * Palova) ? Miroir front des gardes serveur requireClubMember('ADMIN').
 */
export function isClubAdmin(role: ClubStaffRole | null | undefined): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

/**
 * Le viewer est-il le gérant (« compte super » du club) ? Réservé aux surfaces les plus
 * sensibles — compte Stripe/bancaire du club (paiement en ligne), souscription. Miroir
 * front de requireClubMember('OWNER').
 */
export function isClubOwner(role: ClubStaffRole | null | undefined): boolean {
  return role === 'OWNER';
}

/**
 * Rôle du viewer sur le club courant, posé par le layout /admin (qui le lit dans le
 * getMyClubs de sa garde d'accès — aucun appel API supplémentaire). null = inconnu,
 * traité partout comme « pas admin » (sûr par défaut).
 */
export const AdminRoleContext = createContext<ClubStaffRole | null>(null);
export function useAdminRole() { return useContext(AdminRoleContext); }
