'use client';
import { useState, useEffect } from 'react';

interface AuthState {
  token: string | null;
  clubId: string | null; // club géré par l'utilisateur (gating UX du back-office)
  ready: boolean;        // true une fois la lecture localStorage effectuée
}

/**
 * Lit token + clubId géré depuis localStorage au montage.
 * NB : ce gating est purement UX — la sécurité réelle est garantie côté backend
 * (requireClubMember). Ne jamais s'y fier pour une décision sensible.
 */
export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ token: null, clubId: null, ready: false });

  useEffect(() => {
    const token = localStorage.getItem('token');
    const clubId = localStorage.getItem('clubId');
    setState({ token, clubId: clubId || null, ready: true });
  }, []);

  return state;
}

/** Déconnexion : efface la session locale et renvoie vers /login. */
export function logout(): void {
  localStorage.removeItem('token');
  localStorage.removeItem('clubId');
  window.location.assign('/login');
}
