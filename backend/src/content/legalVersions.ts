import { LegalDocument } from '@prisma/client';

/**
 * Versions courantes des documents légaux plateforme. Convention : date ISO de mise en
 * vigueur. Toute modification SUBSTANTIELLE d'un document dans frontend/lib/platformContent.ts
 * doit bumper la version ici (déclenche le bandeau « Nos conditions ont évolué »)
 * ET la ligne « Version du … » en tête du document.
 */
export const LEGAL_VERSIONS: Record<LegalDocument, string> = {
  CGU: '2026-07-18',
  CGV_SAAS: '2026-07-20',
  PRIVACY: '2026-07-21',
};
