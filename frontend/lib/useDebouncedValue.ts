'use client';
import { useEffect, useState } from 'react';

/** Renvoie `value`, mais mis à jour au plus tôt `delayMs` après la dernière frappe. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
