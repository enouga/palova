// Décale les dates d'une épreuve (tournoi / event) vers leur prochaine
// occurrence FUTURE, en gardant le même jour de semaine et la même heure
// locale. Sert au bouton « Dupliquer » de /admin/{tournaments,events} : le
// duplicata d'une épreuve passée doit tomber dans le futur, prêt à publier.
//
// Les chaînes sont au format "datetime-local" (YYYY-MM-DDTHH:MM), heure locale
// du navigateur — même format que l'état `form` des deux pages admin.

export type AgendaDates = {
  startTime: string;
  endTime: string | null;
  registrationDeadline: string;
};

// Ajoute weeks*7 jours à une chaîne datetime-local en préservant l'heure locale.
// Le décalage se fait sur les composantes calendaires (setDate), pas en
// millisecondes, pour que « 20h00 » reste « 20h00 » à travers un changement
// d'heure d'été/hiver. Chaîne vide/invalide → renvoyée telle quelle.
function addWeeksLocal(local: string, weeks: number): string {
  const d = new Date(local);
  if (isNaN(d.getTime())) return local;
  d.setDate(d.getDate() + weeks * 7);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Plus petit N ≥ 1 tel que `local` décalé de N semaines soit strictement futur.
// Itératif sur le calendrier (exact vis-à-vis des semaines à cheval sur un
// changement d'heure) ; le nombre d'itérations est borné par l'ancienneté de la
// source (négligeable).
function weeksUntilFuture(local: string, now: Date): number {
  const base = new Date(local);
  if (isNaN(base.getTime())) return 1;
  let n = 1;
  const probe = new Date(base);
  probe.setDate(probe.getDate() + 7);
  while (probe.getTime() <= now.getTime()) {
    n += 1;
    probe.setDate(probe.getDate() + 7);
  }
  return n;
}

// Décale les trois dates du MÊME nombre de semaines, calculé pour que la limite
// d'inscription (le jalon le plus précoce) tombe dans le futur — le début et la
// fin, qui lui sont postérieurs, le sont alors nécessairement aussi. Préserve le
// jour de semaine, l'heure locale et les écarts entre les trois jalons.
export function shiftDatesToNextFuture(dates: AgendaDates, now: Date): AgendaDates {
  const weeks = weeksUntilFuture(dates.registrationDeadline, now);
  return {
    startTime: addWeeksLocal(dates.startTime, weeks),
    endTime: dates.endTime ? addWeeksLocal(dates.endTime, weeks) : dates.endTime,
    registrationDeadline: addWeeksLocal(dates.registrationDeadline, weeks),
  };
}
