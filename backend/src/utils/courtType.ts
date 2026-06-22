/**
 * Nombre de joueurs d'un terrain selon son format (Resource.attributes.format) :
 * single = 2, sinon double = 4. Miroir de frontend/lib/courtType.ts:playerCount.
 */
export function playerCount(format?: string): number {
  return format === 'single' ? 2 : 4;
}

/**
 * Capacité nominale d'un terrain selon le sport et le format.
 * Distinct de playerCount (sémantique padel). single = 2 partout.
 */
export function capacityFor(sportKey?: string, format?: string): number {
  if (format === 'single') return 2;
  switch (sportKey) {
    case 'tennis':
    case 'squash':     return 2;
    case 'padel':
    case 'pickleball': return 4;   // double par défaut
    default:           return format === 'single' ? 2 : 4;
  }
}
