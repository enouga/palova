'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { isIosUa } from '@/lib/install';

export type PushStatus = 'unsupported' | 'ios-needs-install' | 'default' | 'granted' | 'denied';

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

function isIosNonStandalone(): boolean {
  if (typeof navigator === 'undefined') return false;
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  if (standalone) return false;
  return isIosUa(navigator.userAgent, navigator.maxTouchPoints > 1);
}

export function usePush(): { status: PushStatus; subscribe: () => Promise<void>; unsubscribe: () => Promise<void> } {
  const { token } = useAuth();
  const [status, setStatus] = useState<PushStatus>('unsupported');

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      return; // stays 'unsupported'
    }
    if (isIosNonStandalone()) {
      setStatus('ios-needs-install');
      return;
    }
    const perm = Notification.permission;
    if (perm === 'denied') {
      setStatus('denied');
      return;
    }
    if (perm === 'granted') {
      // Check if there is actually an active subscription
      navigator.serviceWorker.ready.then((reg) => {
        reg.pushManager.getSubscription().then((sub) => {
          setStatus(sub ? 'granted' : 'default');
        }).catch(() => setStatus('default'));
      }).catch(() => setStatus('default'));
    } else {
      setStatus('default');
    }
  }, []);

  const subscribe = async (): Promise<void> => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
    const reg = await navigator.serviceWorker.register('/sw.js');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      setStatus(perm === 'denied' ? 'denied' : 'default');
      return;
    }
    const { publicKey } = await api.getVapidPublicKey();
    if (!publicKey) return;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
    const json = sub.toJSON();
    await api.savePushSubscription({ endpoint: json.endpoint, keys: json.keys }, token ?? '');
    setStatus('granted');
  };

  const unsubscribe = async (): Promise<void> => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await sub.unsubscribe();
      await api.deletePushSubscription(sub.endpoint, token ?? '');
    }
    setStatus('default');
  };

  return { status, subscribe, unsubscribe };
}
