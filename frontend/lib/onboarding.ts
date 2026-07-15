// Helpers PURS de l'onboarding club (wizard + checklist). Aucune horloge, aucun fetch.
import { OnboardingStatus } from '@/lib/api';

export type StepKey = 'identity' | 'sports' | 'courts' | 'rules' | 'launch';
export const STEP_ORDER: StepKey[] = ['identity', 'sports', 'courts', 'rules', 'launch'];

/** Un sport tel qu'affiché dans le téléphone d'aperçu du wizard. */
export interface PreviewSport {
  key: string;
  name: string;
  icon: string | null;
  noun: string;          // resourceNoun du sport (« piste », « terrain »…)
  courtCount: number;
  minPrice: number | null;
}

/** L'état injecté dans LivePhonePreview — dérivé du club + sports + ressources. */
export interface PreviewState {
  name: string;
  slug: string;
  logoUrl: string | null;
  accentColor: string;
  sports: PreviewSport[];
}

export interface ChecklistItem {
  key: 'club' | 'logo' | 'sports' | 'courts' | 'page' | 'stripe' | 'offers' | 'event';
  label: string;
  done: boolean;
  href: string | null;   // page admin idoine ; null = pas de lien (déjà fait par nature)
}

/** Les 8 jalons du guide de démarrage, dérivés du statut serveur. */
export function buildChecklist(s: OnboardingStatus): ChecklistItem[] {
  return [
    { key: 'club',   label: 'Créer votre club',                          done: true,                          href: null },
    { key: 'logo',   label: 'Logo & couleur',                            done: s.hasLogo,                     href: '/admin/settings?tab=identite' },
    { key: 'sports', label: 'Vos sports',                                done: s.sportsCount > 0,             href: '/admin/sports' },
    { key: 'courts', label: 'Vos terrains',                              done: s.resourcesCount > 0,          href: '/admin/courts' },
    { key: 'page',   label: 'Votre page club (photos, présentation)',    done: s.hasPresentation,             href: '/admin/club' },
    { key: 'stripe', label: 'Le paiement en ligne (Stripe)',             done: s.stripeStatus === 'ACTIVE',   href: '/admin/payments' },
    { key: 'offers', label: 'Vos formules (carnets, abonnements)',       done: s.offersCount > 0,             href: '/admin/packages' },
    { key: 'event',  label: 'Votre premier tournoi ou event',            done: s.eventsCount > 0,             href: '/admin/events' },
  ];
}

export function checklistProgress(items: ChecklistItem[]): { done: number; total: number } {
  return { done: items.filter((i) => i.done).length, total: items.length };
}

export interface BookingPreset { label: string; publicDays: number; memberDays: number }
/** Étape 4 — fenêtre de réservation : abonnés = 2× la fenêtre publique. */
export const BOOKING_PRESETS: BookingPreset[] = [
  { label: '7 jours',  publicDays: 7,  memberDays: 14 },
  { label: '14 jours', publicDays: 14, memberDays: 28 },
  { label: '30 jours', publicDays: 30, memberDays: 60 },
];

export interface CancelPreset { label: string; hours: number }
/** Étape 4 — délai d'annulation. */
export const CANCEL_PRESETS: CancelPreset[] = [
  { label: 'Jusqu’au début', hours: 0 },
  { label: '4 h avant',      hours: 4 },
  { label: '24 h avant',     hours: 24 },
];

/** Pluriel naïf des nouns du catalogue (piste→pistes, court→courts, terrain→terrains). */
export const pluralNoun = (noun: string, n: number): string => (n > 1 ? `${noun}s` : noun);

/** « Piste 5, Piste 6… » : numérote à la suite des ressources existantes. */
export function resourceNames(noun: string, existingCount: number, count: number): string[] {
  const cap = noun.charAt(0).toUpperCase() + noun.slice(1);
  return Array.from({ length: count }, (_, i) => `${cap} ${existingCount + i + 1}`);
}

/** Clé localStorage du masquage de la checklist (par club, par appareil). */
export const ONBOARDING_HIDDEN_KEY = (clubId: string) => `palova:onboarding-hidden:${clubId}`;
