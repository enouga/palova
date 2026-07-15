import { notificationsStreamUrl } from '@/lib/api';

// Flux SSE des notifications (cloche) partagé : UNE EventSource par onglet, quel que soit
// le nombre d'abonnés (ClubNav ×2, cloche, /parties, Messages…). Indispensable en dev :
// Chrome plafonne à 6 connexions HTTP/1.1 par origine (localhost:3001), et des streams
// éternels ouverts en triple par page saturaient le quota → toutes les requêtes API de
// tous les onglets restaient en file d'attente (« Chargement… » partout). En prod (h2)
// c'est « seulement » 3× moins de clients SSE côté serveur.
// Pas de onerror → on laisse la reconnexion NATIVE d'EventSource faire son travail
// (l'ancien pattern `es.onerror = () => es.close()` tuait le live au premier pépin réseau).

type Listener = { cb: () => void };

type Stream = { token: string; es: EventSource; listeners: Set<Listener> };

let current: Stream | null = null;

function open(token: string): EventSource {
  const es = new EventSource(notificationsStreamUrl(token));
  es.onmessage = (e) => {
    try {
      if (JSON.parse((e as MessageEvent).data)?.type === 'notification') {
        current?.listeners.forEach((l) => l.cb());
      }
    } catch { /* ping / connected */ }
  };
  return es;
}

/**
 * S'abonne aux évènements `notification` du flux SSE de la cloche.
 * Renvoie la fonction de désabonnement ; le flux est fermé quand le dernier abonné part.
 */
export function subscribeNotifications(token: string, onNotification: () => void): () => void {
  if (current && current.token !== token) {
    current.es.close();
    current = null;
  }
  if (!current) current = { token, es: open(token), listeners: new Set() };

  const mine = current;
  const listener: Listener = { cb: onNotification };
  mine.listeners.add(listener);

  return () => {
    mine.listeners.delete(listener);
    // Ne ferme que si ce flux est encore le flux courant (un changement de token a pu le remplacer).
    if (current === mine && mine.listeners.size === 0) {
      mine.es.close();
      current = null;
    }
  };
}
