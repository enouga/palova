'use client';
import { useState, useEffect } from 'react';
import { getCookie, clearSession } from '@/lib/session';

interface AuthState { token: string | null; clubId: string | null; ready: boolean; }

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ token: null, clubId: null, ready: false });
  useEffect(() => {
    setState({ token: getCookie('token'), clubId: getCookie('clubId'), ready: true });
  }, []);
  return state;
}

/** Déconnexion : efface la session partagée et renvoie vers /login. */
export function logout(): void {
  clearSession();
  window.location.assign('/login');
}
