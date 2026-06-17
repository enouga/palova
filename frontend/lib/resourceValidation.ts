export type ResourceFieldKey =
  | 'name' | 'price' | 'offPeakPrice' | 'openHour' | 'closeHour' | 'slotStepMin';

export type ResourceFieldErrors = Partial<Record<ResourceFieldKey, string>>;

export interface ResourceFieldInput {
  name: string;
  price: string | number;
  offPeakPrice?: string | number | null;
  openHour: string | number;
  closeHour: string | number;
  slotStepMin?: string | number | null;
}

const MSG: Record<ResourceFieldKey, string> = {
  name: 'Le nom est requis.',
  price: 'Le tarif plein doit être supérieur à 0.',
  offPeakPrice: 'Le tarif creux doit être supérieur à 0.',
  openHour: "L'ouverture doit être un entier entre 0 et 24.",
  closeHour: 'La fermeture doit être après l\'ouverture.',
  slotStepMin: 'Le créneau doit être un multiple de 15.',
};

/** '' / null / undefined => null (champ vide). Sinon le nombre, ou null si non numérique. */
function toNum(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isNaN(v) ? null : v;
  const s = v.trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

function isBlank(v: string | number | null | undefined): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

/** Miroir exact de validateHoursAndPrice / validateOffPeak / validateSlotStep du backend. */
export function validateResourceFields(input: ResourceFieldInput): ResourceFieldErrors {
  const errors: ResourceFieldErrors = {};

  if (!input.name.trim()) errors.name = MSG.name;

  const price = toNum(input.price);
  if (price === null || price <= 0) errors.price = MSG.price;

  if (!isBlank(input.offPeakPrice)) {
    const off = toNum(input.offPeakPrice);
    if (off === null || off <= 0) errors.offPeakPrice = MSG.offPeakPrice;
  }

  const open = toNum(input.openHour);
  const close = toNum(input.closeHour);

  const openValid = open !== null && Number.isInteger(open) && open >= 0 && open <= 24;
  if (!openValid) errors.openHour = MSG.openHour;

  const closeInBounds = close !== null && Number.isInteger(close) && close >= 0 && close <= 24;
  const ordering = openValid && closeInBounds ? (open as number) >= (close as number) : false;
  if (!closeInBounds || ordering) errors.closeHour = MSG.closeHour;

  if (!isBlank(input.slotStepMin)) {
    const step = toNum(input.slotStepMin);
    if (step === null || !Number.isInteger(step) || step < 15 || step > 240 || step % 15 !== 0) {
      errors.slotStepMin = MSG.slotStepMin;
    }
  }

  return errors;
}
