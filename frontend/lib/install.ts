// Éligibilité à l'installation PWA — logique pure (testable sans navigateur).
export type InstallState = 'native' | 'ios-manual' | 'android-manual' | 'hidden';

// iOS = iPhone/iPad/iPod. Les iPads récents se présentent comme « Macintosh » :
// on les reconnaît par l'écran tactile (hasTouch, fourni par l'appelant).
export function isIosUa(ua: string, hasTouch = false): boolean {
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && hasTouch;
}

export function isAndroidUa(ua: string): boolean {
  return /Android/i.test(ua);
}

export function installState(opts: { standalone: boolean; canPrompt: boolean; ios: boolean; android?: boolean }): InstallState {
  if (opts.standalone) return 'hidden';    // déjà installée
  if (opts.canPrompt) return 'native';     // Chrome/Edge : prompt natif capturé
  if (opts.ios) return 'ios-manual';       // iOS : pas de prompt → tutoriel
  if (opts.android) return 'android-manual'; // Android sans prompt (ex. après désinstallation,
                                             // Chrome met beforeinstallprompt en sourdine) → tutoriel menu ⋮
  return 'hidden';
}
