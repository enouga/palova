// Implémentation standard Glicko-2 (Glickman). Unités « affichées » en entrée/sortie
// (rating ~1500, rd ~350) ; conversion interne (µ, φ) faite ici. Module PUR, sans DB.

export const GLICKO_SCALE = 173.7178; // facteur de conversion échelle Glicko ↔ Glicko-2
export const DEFAULT_TAU = 0.5;       // contrainte de volatilité du système
export const MAX_RD = 350;            // incertitude maximale (joueur inconnu)

export interface RatingState { rating: number; rd: number; volatility: number; }
export interface Opponent { rating: number; rd: number; score: number; } // score ∈ [0,1]

const g = (phi: number): number => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const expected = (mu: number, muJ: number, phiJ: number): number =>
  1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

/**
 * Met à jour l'état d'un joueur sur une « période » (un ou plusieurs adversaires virtuels).
 * Liste vide = aucun match → seule l'incertitude (RD) remonte (décote d'inactivité).
 */
export function updateRating(state: RatingState, opponents: Opponent[], tau = DEFAULT_TAU): RatingState {
  const phi = state.rd / GLICKO_SCALE;

  if (opponents.length === 0) {
    const phiStar = Math.sqrt(phi * phi + state.volatility * state.volatility);
    return { rating: state.rating, rd: Math.min(phiStar * GLICKO_SCALE, MAX_RD), volatility: state.volatility };
  }

  const mu = (state.rating - 1500) / GLICKO_SCALE;
  let invV = 0;
  let deltaSum = 0;
  for (const o of opponents) {
    const muJ = (o.rating - 1500) / GLICKO_SCALE;
    const phiJ = o.rd / GLICKO_SCALE;
    const gj = g(phiJ);
    const e = expected(mu, muJ, phiJ);
    invV += gj * gj * e * (1 - e);
    deltaSum += gj * (o.score - e);
  }
  const v = 1 / invV;
  const delta = v * deltaSum;

  // Volatilité : résolution f(x)=0 par la méthode d'Illinois.
  const a = Math.log(state.volatility * state.volatility);
  const f = (x: number): number => {
    const ex = Math.exp(x);
    const num = ex * (delta * delta - phi * phi - v - ex);
    const den = 2 * Math.pow(phi * phi + v + ex, 2);
    return num / den - (x - a) / (tau * tau);
  };
  const EPS = 1e-6;
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) k++;
    B = a - k * tau;
  }
  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > EPS) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) { A = B; fA = fB; } else { fA = fA / 2; }
    B = C; fB = fC;
  }
  const newVol = Math.exp(A / 2);

  const phiStar = Math.sqrt(phi * phi + newVol * newVol);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * deltaSum;

  return {
    rating: newMu * GLICKO_SCALE + 1500,
    rd: Math.min(newPhi * GLICKO_SCALE, MAX_RD),
    volatility: newVol,
  };
}
