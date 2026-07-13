import type { SubscriberRow } from './api';

export type RegistryMode = 'active' | 'soon' | 'history';
const DAY = 86_400_000;

export function isActiveSub(s: SubscriberRow, nowMs: number): boolean {
  return s.status === 'ACTIVE' && new Date(s.expiresAt).getTime() > nowMs;
}
export function daysUntil(iso: string, nowMs: number): number {
  return Math.ceil((new Date(iso).getTime() - nowMs) / DAY);
}
export function expiresSoon(s: SubscriberRow, nowMs: number): boolean {
  return isActiveSub(s, nowMs) && daysUntil(s.expiresAt, nowMs) <= 30;
}
export function filterRegistry(
  subs: SubscriberRow[],
  f: { query: string; mode: RegistryMode; planId: string | null },
  nowMs: number,
): SubscriberRow[] {
  const q = f.query.trim().toLowerCase();
  const rows = subs.filter((s) => {
    if (f.planId && s.planId !== f.planId) return false;
    if (q && !`${s.user.firstName} ${s.user.lastName}`.toLowerCase().includes(q)) return false;
    if (f.mode === 'active')  return isActiveSub(s, nowMs);
    if (f.mode === 'soon')    return expiresSoon(s, nowMs);
    return !isActiveSub(s, nowMs); // history
  });
  const asc = f.mode !== 'history';
  return rows.sort((a, b) =>
    asc ? a.expiresAt.localeCompare(b.expiresAt) : b.expiresAt.localeCompare(a.expiresAt));
}
