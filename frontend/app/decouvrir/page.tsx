'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// La page « Où jouer » a fusionné dans l'accueil : ses trois sections filtrables y vivent
// désormais pour tout le monde, connecté ou non. On redirige les anciens liens / favoris en
// conservant query ET hash — les ancres #parties / #tournois / #clubs existent à l'identique
// sur `/`, tout comme la lecture de `?q=` / `?pres=1`.
// La copie figée de l'ancienne page reste consultable sur /archive/decouvrir.
export default function DecouvrirRedirect() {
  const router = useRouter();
  useEffect(() => {
    const { search, hash } = window.location;
    router.replace(`/${search}${hash}`);
  }, [router]);
  return null;
}
