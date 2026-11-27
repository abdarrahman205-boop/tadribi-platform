// Real system permission requests. Each call shows the operating system's own dialog:
//  - Native app (Android / iOS): the Capacitor plugin asks the OS directly.
//  - Browser: the browser's own permission prompt is shown.
// No simulated dialog is drawn in the app.

import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

export type NotificationPermission = 'granted' | 'denied' | 'default' | 'unsupported';

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (Capacitor.isNativePlatform()) {
    const result = await LocalNotifications.requestPermissions();
    return result.display === 'granted' ? 'granted' : 'denied';
  }
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return window.Notification.requestPermission();
}

export async function currentNotificationPermission(): Promise<NotificationPermission> {
  if (Capacitor.isNativePlatform()) {
    const result = await LocalNotifications.checkPermissions();
    return result.display === 'granted' ? 'granted' : result.display === 'denied' ? 'denied' : 'default';
  }
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return window.Notification.permission;
}

// Location uses the browser / WebView prompt through the Geolocation API.
export function requestLocationPermission(
  onResult: (status: 'granted' | 'denied', coords?: { lat: number; lng: number }) => void
): void {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    onResult('denied');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => onResult('granted', { lat: pos.coords.latitude, lng: pos.coords.longitude }),
    () => onResult('denied'),
    { enableHighAccuracy: false, timeout: 15000 }
  );
}
