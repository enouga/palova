import { redirect } from 'next/navigation';

// Le marketplace passe désormais par l'annuaire /clubs (multi-club).
// L'ancienne liste mono-club est remplacée par /c/{slug}.
export default function CourtsIndex() {
  redirect('/clubs');
}
