import React, { useRef, useState } from 'react';
import { requestNotificationPermission } from '../../lib/permissions';
import { tr } from '../../utils/locale';
import type { Language } from '../../types';

// First-launch guide. Shown once; the flag is stored on the device.
const STORAGE_KEY = 'tdr_onboarding_v1_done';

export const isOnboardingDone = (): boolean => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

const markOnboardingDone = () => {
  try {
    window.localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // storage unavailable: the guide simply shows again next launch
  }
};

type IllustrationKind = 'welcome' | 'lessons' | 'exams' | 'notify';

const Illustration: React.FC<{ kind: IllustrationKind }> = ({ kind }) => {
  const common = { width: 220, height: 180, viewBox: '0 0 220 180', 'aria-hidden': true } as const;
  if (kind === 'welcome') {
    return (
      <svg {...common}>
        <ellipse cx="110" cy="150" rx="86" ry="12" fill="#e6f2c4" />
        <path d="M30 128 Q110 96 110 128 Q110 96 190 128 L190 146 Q110 118 110 146 Q110 118 30 146Z" fill="#a4cc39" opacity="0.9" />
        <path d="M110 40 L172 64 L110 88 L48 64Z" fill="#55720f" />
        <path d="M80 80 L80 104 Q110 118 140 104 L140 80 L110 92Z" fill="#7c9e1c" />
        <path d="M172 64 L172 100" stroke="#55720f" strokeWidth="3" strokeLinecap="round" />
        <circle cx="172" cy="104" r="5" fill="#a4cc39" />
      </svg>
    );
  }
  if (kind === 'lessons') {
    return (
      <svg {...common}>
        <ellipse cx="110" cy="152" rx="90" ry="10" fill="#e6f2c4" />
        <path d="M24 60 Q66 44 110 62 Q154 44 196 60 L196 142 Q154 126 110 144 Q66 126 24 142Z" fill="#ffffff" stroke="#7c9e1c" strokeWidth="3" />
        <path d="M110 62 L110 144" stroke="#7c9e1c" strokeWidth="3" />
        <path d="M44 84 Q72 76 96 88 M44 102 Q72 94 96 106 M44 120 Q72 112 96 124" stroke="#a4cc39" strokeWidth="4" strokeLinecap="round" fill="none" />
        <path d="M124 88 Q152 76 176 84 M124 106 Q152 94 176 102 M124 124 Q152 112 176 120" stroke="#a4cc39" strokeWidth="4" strokeLinecap="round" fill="none" />
      </svg>
    );
  }
  if (kind === 'exams') {
    return (
      <svg {...common}>
        <ellipse cx="110" cy="152" rx="80" ry="10" fill="#e6f2c4" />
        <rect x="58" y="26" width="104" height="128" rx="14" fill="#ffffff" stroke="#7c9e1c" strokeWidth="3" />
        <rect x="80" y="18" width="60" height="18" rx="9" fill="#a4cc39" />
        <path d="M80 80 L100 100 L140 62" stroke="#55720f" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <rect x="78" y="116" width="64" height="8" rx="4" fill="#e6f2c4" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <ellipse cx="110" cy="152" rx="70" ry="10" fill="#e6f2c4" />
      <path d="M110 30 C84 30 74 52 74 78 L74 108 L60 124 L160 124 L146 108 L146 78 C146 52 136 30 110 30Z" fill="#a4cc39" />
      <circle cx="110" cy="138" r="10" fill="#7c9e1c" />
      <path d="M92 16 Q110 6 128 16" stroke="#7c9e1c" strokeWidth="4" strokeLinecap="round" fill="none" />
    </svg>
  );
};

interface MobileOnboardingProps {
  lang: Language;
  onDone: () => void;
}

export const MobileOnboarding: React.FC<MobileOnboardingProps> = ({ lang, onDone }) => {
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notifResult, setNotifResult] = useState<string | null>(null);
  const touchStartX = useRef<number | null>(null);

  const slides: Array<{ kind: IllustrationKind; title: string; body: string }> = [
    {
      kind: 'welcome',
      title: tr(lang, 'أهلاً بك في تدريبي', 'Bienvenue sur Tadribi', 'Welcome to Tadribi'),
      body: tr(
        lang,
        'منصتك للتحضير لمسابقات اكتتاب المعلمين، بالعربية والفرنسية.',
        'Votre plateforme de préparation aux concours d’enseignants, en arabe et en français.',
        'Your platform for teacher recruitment exam preparation, in Arabic and French.'
      ),
    },
    {
      kind: 'lessons',
      title: tr(lang, 'دروس وملخصات', 'Cours et résumés', 'Lessons and summaries'),
      body: tr(
        lang,
        'ادرس الدروس والملخصات وبنك الأسئلة، وحفظ ما تريد مراجعته لاحقاً.',
        'Étudiez les cours, les résumés et la banque de questions, et gardez vos favoris.',
        'Study lessons, summaries and the question bank, and save what you want to review.'
      ),
    },
    {
      kind: 'exams',
      title: tr(lang, 'امتحانات بتصحيح فوري', 'Examens corrigés', 'Exams with instant scoring'),
      body: tr(
        lang,
        'اختبر نفسك بامتحانات تجريبية، وتابع نتائجك ومعدل البكالوريا.',
        'Testez-vous avec des examens blancs et suivez vos résultats.',
        'Test yourself with mock exams and follow your results.'
      ),
    },
    {
      kind: 'notify',
      title: tr(lang, 'فعّل الإشعارات', 'Activez les notifications', 'Turn on notifications'),
      body: tr(
        lang,
        'لنعلمك بالامتحانات الجديدة والمواعيد المهمة. يمكنك تغيير ذلك لاحقاً من الإعدادات.',
        'Pour vous prévenir des nouveaux examens et des dates importantes. Modifiable plus tard.',
        'To notify you about new exams and important dates. You can change this later.'
      ),
    },
  ];

  const isLast = index === slides.length - 1;
  const slide = slides[index];

  const finish = () => {
    markOnboardingDone();
    onDone();
  };

  const next = () => {
    if (isLast) {
      finish();
      return;
    }
    setIndex((i) => Math.min(i + 1, slides.length - 1));
  };

  const enableNotifications = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // This opens the real system permission dialog.
      const result = await requestNotificationPermission();
      setNotifResult(
        result === 'granted'
          ? tr(lang, 'تم تفعيل الإشعارات.', 'Notifications activées.', 'Notifications enabled.')
          : result === 'unsupported'
            ? tr(lang, 'الإشعارات غير مدعومة على هذا الجهاز.', 'Notifications non supportées.', 'Notifications are not supported here.')
            : tr(lang, 'لم تُمنح الإشعارات، يمكنك تفعيلها لاحقاً.', 'Notifications refusées, activables plus tard.', 'Not allowed. You can enable them later.')
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col"
      style={{ background: 'var(--m-bg)', color: 'var(--m-ink)' }}
      role="dialog"
      aria-modal="true"
      aria-label={tr(lang, 'مقدمة التطبيق', 'Introduction', 'Introduction')}
      onTouchStart={(e) => {
        touchStartX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        if (touchStartX.current === null) return;
        const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStartX.current;
        touchStartX.current = null;
        if (Math.abs(dx) < 50) return;
        // Swipe toward the reading direction goes forward.
        const forward = lang === 'ar' ? dx > 0 : dx < 0;
        if (forward) next();
        else setIndex((i) => Math.max(i - 1, 0));
      }}
    >
      <div
        className="flex items-center justify-between px-5"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)', minHeight: 56 }}
      >
        <img
          src="/assets/brand/logo-horizontal.webp"
          alt="تدريبي"
          draggable={false}
          className="h-8 w-auto object-contain"
        />
        {!isLast && (
          <button
            type="button"
            onClick={finish}
            className="tdr-m-btn-secondary"
            style={{ minHeight: 44, padding: '0 16px' }}
          >
            {tr(lang, 'تخطي', 'Passer', 'Skip')}
          </button>
        )}
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <div key={index} className="flex flex-col items-center gap-6" style={{ animation: 'tdr-onb-in 380ms ease both' }}>
          <Illustration kind={slide.kind} />
          <h2
            style={{ fontFamily: "'Reem Kufi', sans-serif", fontSize: '1.6rem', fontWeight: 700, color: 'var(--m-ink)' }}
          >
            {slide.title}
          </h2>
          <p style={{ fontFamily: "'Noto Sans Arabic', sans-serif", fontSize: '1rem', lineHeight: 1.8, color: 'var(--m-ink-sub)', maxWidth: 320 }}>
            {slide.body}
          </p>
          {isLast && notifResult && (
            <p style={{ fontFamily: "'Noto Sans Arabic', sans-serif", fontSize: '0.9rem', color: 'var(--m-brand-deep)' }}>
              {notifResult}
            </p>
          )}
        </div>
      </div>

      <div className="px-6" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 20px)' }}>
        <div className="mb-6 flex items-center justify-center gap-2" aria-hidden="true">
          {slides.map((_, i) => (
            <span
              key={i}
              style={{
                width: i === index ? 24 : 8,
                height: 8,
                borderRadius: 999,
                background: i === index ? 'var(--m-brand-d)' : 'var(--m-line)',
                transition: 'width 240ms ease, background 240ms ease',
              }}
            />
          ))}
        </div>

        {isLast && !notifResult && (
          <button
            type="button"
            onClick={enableNotifications}
            disabled={busy}
            className="tdr-m-btn-primary mb-3 w-full"
            style={{ minHeight: 52 }}
          >
            {tr(lang, 'تفعيل الإشعارات', 'Activer les notifications', 'Enable notifications')}
          </button>
        )}

        <button
          type="button"
          onClick={next}
          className={isLast && !notifResult ? 'tdr-m-btn-secondary w-full' : 'tdr-m-btn-primary w-full'}
          style={{ minHeight: 52 }}
        >
          {isLast ? tr(lang, 'ابدأ الآن', 'Commencer', 'Get started') : tr(lang, 'التالي', 'Suivant', 'Next')}
        </button>
      </div>

      <style>{`@keyframes tdr-onb-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { [style*="tdr-onb-in"] { animation: none !important; } }`}</style>
    </div>
  );
};
