const GUEST_MODE_KEY = 'c-practice.guest-mode';
const GUEST_IDENTITY_KEY = 'c-practice.guest-identity';

/** Stable, private-to-this-browser identity so guest progress is not shared globally. */
export function getGuestIdentity(): string {
  const existing = window.localStorage.getItem(GUEST_IDENTITY_KEY);
  if (existing) return existing;

  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replaceAll('-', '').slice(0, 20)
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  const identity = `guest_${random}`;
  window.localStorage.setItem(GUEST_IDENTITY_KEY, identity);
  return identity;
}

/** True when this browser chose the explicit guest entry path. */
export function isGuestMode(): boolean {
  return window.localStorage.getItem(GUEST_MODE_KEY) === 'true';
}

export function setGuestMode(enabled: boolean): void {
  if (enabled) window.localStorage.setItem(GUEST_MODE_KEY, 'true');
  else window.localStorage.removeItem(GUEST_MODE_KEY);
}
