/**
 * Nombre de joueurs d'un terrain selon son format (Resource.attributes.format) :
 * single = 2, sinon double = 4. Miroir de frontend/lib/courtType.ts:playerCount.
 */
export function playerCount(format?: string): number {
  return format === 'single' ? 2 : 4;
}
