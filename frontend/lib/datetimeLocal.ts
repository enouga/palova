// Conversions entre la valeur d'un <input type="datetime-local"> (heure locale du
// navigateur, sans fuseau) et un ISO 8601 UTC. Source de vérité unique des
// formulaires admin (tournois, events) : normaliser ici évite toute divergence de
// fuseau d'un formulaire à l'autre.

/** Valeur d'un datetime-local → ISO UTC. Chaîne vide → '' (champ non renseigné). */
export function localInputToISO(value: string): string {
  return value ? new Date(value).toISOString() : '';
}

/** ISO → valeur d'un datetime-local (heure locale du navigateur). null/vide/invalide → ''. */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Découpe / recompose les deux moitiés d'un datetime-local. Permet d'éditer la date
// (input natif) et l'heure (TimePicker) séparément sans jamais produire une valeur
// partielle invalide.

/** "YYYY-MM-DDTHH:MM" → { date, time } ; chaîne sans 'T' ou vide → moitiés vides. */
export function splitLocal(value: string): { date: string; time: string } {
  if (!value || !value.includes('T')) return { date: value || '', time: '' };
  const [date, rest = ''] = value.split('T');
  return { date, time: rest.slice(0, 5) }; // garde HH:MM (ignore d'éventuelles secondes)
}

/** Recompose ; '' si la date OU l'heure manque (jamais de datetime partiel). */
export function joinLocal(date: string, time: string): string {
  return date && time ? `${date}T${time}` : '';
}
