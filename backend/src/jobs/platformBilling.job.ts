import cron from 'node-cron';
import { PlatformBillingService } from '../services/platformBilling/platformBilling.service';
import { ensurePlatformPrices } from '../services/platformBilling/stripeBilling';
import { reportError } from '../observability/reportError';

const service = new PlatformBillingService();

export function startPlatformBillingJob(): void {
  // Prix Stripe : best-effort au boot (échoue proprement en dev sans clé réelle).
  ensurePlatformPrices().catch((err) =>
    console.warn('[billing] ensurePlatformPrices ignoré :', (err as Error).message));

  // Nocturne 04:00 Europe/Paris : recompte des membres actifs (jauge /admin/billing).
  cron.schedule('0 4 * * *', async () => {
    try { await service.refreshAllClubs(new Date()); }
    catch (err) { reportError(err, { source: 'billing:refreshAllClubs' }); }
  }, { timezone: 'Europe/Paris' });

  // Mensuel, le 1er à 04:30 Europe/Paris : snapshots + règles de palier + relances.
  cron.schedule('30 4 1 * *', async () => {
    try { await service.runMonthlyEvaluation(new Date()); }
    catch (err) { reportError(err, { source: 'billing:runMonthlyEvaluation' }); }
  }, { timezone: 'Europe/Paris' });
}
