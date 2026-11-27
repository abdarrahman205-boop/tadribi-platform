// Biometric unlock (fingerprint / Face ID) for the native app.
// Uses the OS biometric prompt. On the web it is never available.

import { Capacitor } from '@capacitor/core';
import { BiometricAuth } from '@aparajita/capacitor-biometric-auth';

const ENABLED_KEY = 'tdr_biometric_enabled';

export const isBiometricEnabled = (): boolean => {
  try {
    return window.localStorage.getItem(ENABLED_KEY) === '1';
  } catch {
    return false;
  }
};

export const setBiometricEnabled = (enabled: boolean): void => {
  try {
    if (enabled) window.localStorage.setItem(ENABLED_KEY, '1');
    else window.localStorage.removeItem(ENABLED_KEY);
  } catch {
    // storage unavailable: the setting simply does not persist
  }
};

export async function isBiometricAvailable(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const result = await BiometricAuth.checkBiometry();
    return result.isAvailable;
  } catch {
    return false;
  }
}

/** Shows the system biometric prompt. Resolves true only when the user is verified. */
export async function verifyWithBiometric(reason: string): Promise<boolean> {
  try {
    await BiometricAuth.authenticate({ reason });
    return true;
  } catch {
    return false;
  }
}
