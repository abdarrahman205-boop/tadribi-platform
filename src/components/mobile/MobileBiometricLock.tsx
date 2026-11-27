import React, { useEffect, useState } from 'react';
import { verifyWithBiometric } from '../../lib/biometric';
import { tr } from '../../utils/locale';
import type { Language } from '../../types';

// Shown when the app opens for a signed-in user who enabled biometric unlock.
interface MobileBiometricLockProps {
  lang: Language;
  onUnlock: () => void;
  onUsePassword: () => void;
}

export const MobileBiometricLock: React.FC<MobileBiometricLockProps> = ({ lang, onUnlock, onUsePassword }) => {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const unlock = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await verifyWithBiometric(
      tr(lang, 'تأكيد هويتك للدخول إلى تدريبي', 'Confirmez votre identité pour accéder à Tadribi', 'Confirm your identity to open Tadribi')
    );
    setBusy(false);
    if (ok) onUnlock();
    else setFailed(true);
  };

  // Ask once automatically when the lock screen opens.
  useEffect(() => {
    void unlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-6 px-6 text-center" style={{ background: 'var(--m-bg)', color: 'var(--m-ink)' }} role="dialog" aria-modal="true">
      <img src="/assets/brand/logo-horizontal.webp" alt="تدريبي" draggable={false} className="h-12 w-auto object-contain" />
      <h2 style={{ fontFamily: "'Reem Kufi', sans-serif", fontSize: '1.4rem', fontWeight: 700 }}>
        {tr(lang, 'افتح تدريبي', 'Ouvrir Tadribi', 'Unlock Tadribi')}
      </h2>
      <p style={{ fontFamily: "'Noto Sans Arabic', sans-serif", color: 'var(--m-ink-sub)', maxWidth: 300 }}>
        {failed
          ? tr(lang, 'لم يتم التحقق. حاول مرة أخرى.', 'Vérification échouée. Réessayez.', 'Verification failed. Try again.')
          : tr(lang, 'استخدم البصمة أو الوجه للدخول.', 'Utilisez empreinte ou visage pour entrer.', 'Use fingerprint or face to continue.')}
      </p>
      <button type="button" onClick={unlock} disabled={busy} className="tdr-m-btn-primary w-full max-w-xs" style={{ minHeight: 52 }}>
        {tr(lang, 'الدخول بالبصمة', 'Entrer avec empreinte', 'Unlock with biometrics')}
      </button>
      <button type="button" onClick={onUsePassword} className="tdr-m-btn-secondary w-full max-w-xs" style={{ minHeight: 52 }}>
        {tr(lang, 'استخدام كلمة المرور', 'Utiliser le mot de passe', 'Use password')}
      </button>
    </div>
  );
};
