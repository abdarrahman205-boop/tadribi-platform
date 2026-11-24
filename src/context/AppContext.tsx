import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  onAuthStateChanged,
  sendEmailVerification,
  signOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  auth,
  isOfficialAdminEmail,
  testConnection,
  translateFirebaseAuthError,
} from '../lib/firebase';
import {
  ensureUserDocuments,
  fetchFirestoreLessons,
  fetchFirestoreLessonSections,
  fetchFirestorePlans,
  fetchFirestoreSiteConfig,
  markNotificationsReadInFirestore,
  seedFirestoreCatalogIfNeeded,
  subscribeAllConversationsForAdmin,
  subscribeLessonProgress,
  subscribeMyActiveSubscription,
  subscribeUserConversations,
  subscribeUserNotifications,
} from '../lib/firestoreService';
import type {
  ActiveSubscriptionSummary,
  AnnualSavingsSummary,
  ExamAttempt,
  Language,
  Lesson,
  LessonSection,
  NotificationItem,
  PaymentMethodConfig,
  PlanLimitsConfig,
  Question,
  SiteConfig,
  Subject,
  SubscriptionPlan,
  SummaryItem,
  Track,
  TrackSlug,
  User,
} from '../types';
import { apiRequest, setAuthToken } from '../utils/api';
import { trackAnalyticsEvent } from '../utils/locale';
import { speechEngine } from '../utils/speechEngine';

export type AppView =
  | 'home'
  | 'about'
  | 'privacy'
  | 'terms'
  | 'contact'
  | 'all-subjects'
  | 'lessons'
  | 'summaries'
  | 'question-bank'
  | 'review-center'
  | 'exams'
  | 'baccalaureate'
  | 'favorites'
  | 'notifications'
  | 'report'
  | 'dashboard'
  | 'profile'
  | 'account-complete'
  | 'support'
  | 'admin'
  | 'login'
  | 'register'
  | 'forgot-password'
  | 'reset-password'
  | 'verify-receipt'
  | 'subscriptions'
  | 'checkout';

export type ThemeMode = 'light' | 'dark';

export interface BankStats {
  totalVerifiedQuestions: number;
  officialThreshold: number;
  isComprehensiveOfficialReady: boolean;
  bySubject: Array<{ subject_slug: string; count: number }>;
}

export interface GradingPolicy {
  maxScore: number;
  wrongPenalty: number;
  passingScore: number;
}

export interface CatalogData {
  tracks: Track[];
  subjects: Subject[];
  lessons: Lesson[];
  lessonSections: LessonSection[];
  summaries: SummaryItem[];
  bankStats: BankStats;
  gradingPolicy: GradingPolicy;
  siteConfig?: SiteConfig;
}

export interface ViewParams {
  lessonId?: number;
  subjectSlug?: string;
  level?: string;
  search?: string;
  searchCategory?: string;
  favoritesOnly?: boolean;
  examMode?: 'mock' | 'official_sim' | 'placement';
  reviewAttemptId?: number;
  planId?: number;
  resetToken?: string;
  actionToken?: string;
  oobCode?: string;
  receiptId?: string;
  receiptSig?: string;
  redirectView?: AppView;
  bacSeries?: string;
}

interface AppContextValue {
  lang: Language;
  setLang: (lang: Language) => void;
  theme: ThemeMode;
  toggleTheme: () => void;
  selectedTrack: TrackSlug;
  setSelectedTrack: (track: TrackSlug) => void;
  firebaseUser: FirebaseUser | null;
  authReady: boolean;
  user: User | null;
  setUser: (user: User | null) => void;
  refreshUser: () => Promise<void>;
  resendVerificationEmail: () => Promise<{ ok: boolean; error?: string }>;
  reloadVerificationStatus: () => Promise<{ verified: boolean; error?: string }>;
  authDisabledNotice: string | null;
  clearAuthDisabledNotice: () => void;
  catalog: CatalogData;
  refreshCatalog: () => Promise<void>;
  plans: SubscriptionPlan[];
  refreshPlans: () => Promise<void>;
  paymentMethods: PaymentMethodConfig[];
  annualSavings: AnnualSavingsSummary | null;
  freeLimits: PlanLimitsConfig | null;
  canCopy: boolean;
  siteConfig: SiteConfig;
  notifications: NotificationItem[];
  unreadNotificationCount: number;
  unreadSupportCount: number;
  refreshNotifications: () => Promise<void>;
  markNotificationsRead: () => Promise<void>;
  activeExam: { attempt: ExamAttempt; questions: Question[] } | null;
  setActiveExam: (data: { attempt: ExamAttempt; questions: Question[] } | null) => void;
  refreshActiveExam: () => Promise<void>;
  currentView: AppView;
  viewParams: ViewParams;
  navigate: (view: AppView, params?: ViewParams) => void;
  canGoBack: boolean;
  goBack: () => void;
  upgradeModal: { open: boolean; featureLabel?: string };
  openUpgradeModal: (featureLabel?: string) => void;
  closeUpgradeModal: () => void;
  goToAuth: (mode?: 'login' | 'register' | 'forgot') => void;
  advancedSearchOpen: boolean;
  setAdvancedSearchOpen: (open: boolean) => void;
  logout: () => Promise<void>;
  bootLoading: boolean;
}

const emptySiteConfig: SiteConfig = {
  tickerMessages: [],
  heroSlides: [],
  supportEnabled: true,
  maintenanceMode: false,
};

const emptyCatalog: CatalogData = {
  tracks: [],
  subjects: [],
  lessons: [],
  lessonSections: [],
  summaries: [],
  bankStats: {
    totalVerifiedQuestions: 0,
    officialThreshold: 70,
    isComprehensiveOfficialReady: false,
    bySubject: [],
  },
  gradingPolicy: { maxScore: 20, wrongPenalty: 0, passingScore: 10 },
  siteConfig: emptySiteConfig,
};

const THEME_STORAGE_KEY = 'fl_theme';
const LANG_STORAGE_KEY = 'fl_lang';

const VALID_VIEWS: AppView[] = [
  'home',
  'about',
  'privacy',
  'terms',
  'contact',
  'all-subjects',
  'lessons',
  'summaries',
  'question-bank',
  'review-center',
  'exams',
  'baccalaureate',
  'favorites',
  'notifications',
  'report',
  'dashboard',
  'profile',
  'account-complete',
  'support',
  'admin',
  'login',
  'register',
  'forgot-password',
  'reset-password',
  'verify-receipt',
  'subscriptions',
  'checkout',
];

function getInitialViewAndParams(): { view: AppView; params: ViewParams; search: string } {
  if (typeof window === 'undefined') return { view: 'home', params: {}, search: '' };
  const rawSearch = window.location.search || '';
  const sp = new URLSearchParams(rawSearch);

  try {
    const refParam = sp.get('ref')?.trim().toUpperCase();
    if (refParam && /^[A-Z0-9_-]{4,24}$/.test(refParam)) {
      window.localStorage.setItem('tadribi_pending_ref', refParam);
    }
  } catch {
    // ignore storage restriction
  }

  const slug = window.location.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
  const mode = sp.get('mode')?.trim() || '';
  const oobCode = sp.get('oobCode')?.trim() || '';
  const token = sp.get('token')?.trim() || '';
  const at = sp.get('at')?.trim() || '';
  const rid = sp.get('rid')?.trim() || '';
  const sig = sp.get('sig')?.trim() || '';

  if (mode === 'resetPassword' && oobCode) {
    return {
      view: 'reset-password',
      params: { oobCode, actionToken: at || undefined, resetToken: token || undefined },
      search: rawSearch,
    };
  }

  if (slug === 'reset-password') {
    return {
      view: 'reset-password',
      params: {
        resetToken: token || undefined,
        actionToken: at || undefined,
        oobCode: oobCode || undefined,
      },
      search: rawSearch,
    };
  }

  if (slug === 'verify-receipt') {
    return {
      view: 'verify-receipt',
      params: { receiptId: rid || undefined, receiptSig: sig || undefined },
      search: rawSearch,
    };
  }

  if (slug && VALID_VIEWS.includes(slug as AppView)) {
    return { view: slug as AppView, params: {}, search: '' };
  }
  return { view: 'home', params: {}, search: '' };
}

function getInitialViewFromPath(): AppView {
  return getInitialViewAndParams().view;
}

function getInitialLanguage(): Language {
  if (typeof window === 'undefined') return 'ar';
  try {
    const saved = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (saved === 'ar' || saved === 'fr' || saved === 'en') {
      return saved;
    }
  } catch {
    // ignore storage restriction
  }
  return 'ar';
}

function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  } catch {
    // ignore storage access issues
  }
  return 'light';
}

const AppContext = createContext<AppContextValue | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Language>(getInitialLanguage);
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [selectedTrack, setSelectedTrack] = useState<TrackSlug>('all');
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [activeSub, setActiveSub] = useState<ActiveSubscriptionSummary | null>(null);
  const [serverSub, setServerSub] = useState<ActiveSubscriptionSummary | null>(null);
  const [serverExpiredSub, setServerExpiredSub] = useState<ActiveSubscriptionSummary | null>(null);
  const [serverUserMeta, setServerUserMeta] = useState<Partial<User> | null>(null);
  const [canCopy, setCanCopy] = useState(false);
  const [lessonProgressMap, setLessonProgressMap] = useState<
    Record<string, { completed: boolean; isFavorite: boolean }>
  >({});
  const [authDisabledNotice, setAuthDisabledNotice] = useState<string | null>(null);

  const [baseCatalog, setBaseCatalog] = useState<CatalogData>(emptyCatalog);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodConfig[]>([]);
  const [annualSavings, setAnnualSavings] = useState<AnnualSavingsSummary | null>(null);
  const [freeLimits, setFreeLimits] = useState<PlanLimitsConfig | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadSupportCount, setUnreadSupportCount] = useState(0);
  const [activeExam, setActiveExam] = useState<{ attempt: ExamAttempt; questions: Question[] } | null>(
    null
  );
  const [currentView, setCurrentView] = useState<AppView>(() => getInitialViewAndParams().view);
  const [viewParams, setViewParams] = useState<ViewParams>(() => getInitialViewAndParams().params);
  const [historyStack, setHistoryStack] = useState<Array<{ view: AppView; params: ViewParams }>>(() => {
    const init = getInitialViewAndParams();
    return [{ view: init.view, params: init.params }];
  });
  const [upgradeModal, setUpgradeModal] = useState<{ open: boolean; featureLabel?: string }>({
    open: false,
  });
  const [advancedSearchOpen, setAdvancedSearchOpen] = useState(false);
  const [bootLoading, setBootLoading] = useState(true);

  const seededOnceRef = useRef(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next: ThemeMode = prev === 'dark' ? 'light' : 'dark';
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const setLang = useCallback((nextLang: Language) => {
    speechEngine.stop();
    const safeLang: Language = nextLang === 'fr' || nextLang === 'en' ? nextLang : 'ar';
    setLangState(safeLang);
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, safeLang);
    } catch {
      // ignore
    }
    document.documentElement.lang = safeLang;
    document.documentElement.dir = safeLang === 'ar' ? 'rtl' : 'ltr';
  }, []);

  const refreshCopyPermission = useCallback(async () => {
    if (!auth.currentUser) {
      setCanCopy(false);
      return;
    }
    try {
      const res = await apiRequest<{ canCopy?: boolean }>('/api/auth/copy-permission');
      setCanCopy(Boolean(res?.canCopy));
    } catch {
      setCanCopy(false);
    }
  }, []);

  const refreshPlans = useCallback(async () => {
    try {
      const res = await apiRequest<{
        plans?: SubscriptionPlan[];
        paymentMethods?: PaymentMethodConfig[];
        annualSavings?: AnnualSavingsSummary;
        planLimits?: { free?: PlanLimitsConfig };
        currentSubscription?: ActiveSubscriptionSummary | null;
        latestExpiredSubscription?: ActiveSubscriptionSummary | null;
      }>('/api/plans');
      if (Array.isArray(res.plans) && res.plans.length > 0) {
        setPlans(res.plans);
      }
      if (Array.isArray(res.paymentMethods)) {
        setPaymentMethods(res.paymentMethods);
      }
      if (res.annualSavings) {
        setAnnualSavings(res.annualSavings);
      }
      if (res.planLimits?.free) {
        setFreeLimits(res.planLimits.free);
      }
      setServerSub(res.currentSubscription || null);
      setServerExpiredSub(res.latestExpiredSubscription || null);
      return;
    } catch {
      // Fall back to Firestore plans only when API is unavailable
    }
    try {
      const fsPlans = await fetchFirestorePlans();
      if (fsPlans.length > 0) {
        setPlans(fsPlans);
      }
    } catch {
      // ignore
    }
  }, []);

  const refreshCatalog = useCallback(async () => {
    try {
      const [apiCat, fsLessons, fsSections, fsSiteConfig] = await Promise.all([
        apiRequest<CatalogData>('/api/catalog').catch(() => null),
        fetchFirestoreLessons(false).catch(() => [] as Lesson[]),
        fetchFirestoreLessonSections(false).catch(() => [] as LessonSection[]),
        fetchFirestoreSiteConfig().catch(() => null),
      ]);

      const validApiCat =
        apiCat &&
        typeof apiCat === 'object' &&
        apiCat.bankStats &&
        typeof apiCat.bankStats.totalVerifiedQuestions === 'number'
          ? apiCat
          : null;

      setBaseCatalog((prev) => {
        const source = validApiCat || prev || emptyCatalog;
        const mergedLessons =
          fsLessons.length > 0
            ? fsLessons
            : Array.isArray(source.lessons)
              ? source.lessons
              : [];
        const mergedSiteConfig: SiteConfig =
          fsSiteConfig && fsSiteConfig.heroSlides?.length > 0
            ? {
                tickerMessages: fsSiteConfig.tickerMessages,
                heroSlides: fsSiteConfig.heroSlides,
                supportEnabled: fsSiteConfig.supportEnabled,
                maintenanceMode: fsSiteConfig.maintenanceMode,
              }
            : source.siteConfig || emptySiteConfig;

        const mergedGrading =
          fsSiteConfig?.gradingPolicy || source.gradingPolicy || emptyCatalog.gradingPolicy;

        const rawBankStats = source.bankStats || emptyCatalog.bankStats;
        const normalizedBankStats: BankStats = {
          totalVerifiedQuestions:
            typeof rawBankStats.totalVerifiedQuestions === 'number'
              ? rawBankStats.totalVerifiedQuestions
              : 0,
          officialThreshold:
            typeof rawBankStats.officialThreshold === 'number'
              ? rawBankStats.officialThreshold
              : emptyCatalog.bankStats.officialThreshold,
          isComprehensiveOfficialReady: Boolean(rawBankStats.isComprehensiveOfficialReady),
          bySubject: Array.isArray(rawBankStats.bySubject) ? rawBankStats.bySubject : [],
        };

        return {
          tracks: Array.isArray(source.tracks) ? source.tracks : [],
          subjects: Array.isArray(source.subjects) ? source.subjects : [],
          lessons: mergedLessons,
          lessonSections: fsSections,
          summaries: Array.isArray(source.summaries) ? source.summaries : [],
          bankStats: normalizedBankStats,
          gradingPolicy: mergedGrading,
          siteConfig: mergedSiteConfig,
        };
      });
    } catch {
      // ignore
    }
  }, []);

  const refreshActiveExam = useCallback(async () => {
    if (!auth.currentUser) {
      setActiveExam(null);
      return;
    }
    try {
      const data = await apiRequest<{ attempt: ExamAttempt | null; questions: Question[] }>(
        '/api/exams/active'
      );
      if (data.attempt && data.questions.length > 0) {
        setActiveExam({ attempt: data.attempt, questions: data.questions });
      } else {
        setActiveExam(null);
      }
    } catch {
      setActiveExam(null);
    }
  }, []);

  const syncServerUserAndSession = useCallback(async () => {
    if (!auth.currentUser) {
      setServerUserMeta(null);
      return;
    }
    try {
      await apiRequest('/api/auth/sessions/heartbeat', { method: 'POST', json: {} }).catch((err: any) => {
        if (err?.status === 401 && err?.data?.code === 'SESSION_REVOKED') throw err;
      });

      const pendingRef = window.localStorage.getItem('tadribi_pending_ref');
      if (pendingRef) {
        await apiRequest('/api/referrals/claim', { method: 'POST', json: { code: pendingRef } }).catch(() => {});
        window.localStorage.removeItem('tadribi_pending_ref');
      }

      const me = await apiRequest<{ user?: Partial<User> | null }>('/api/auth/me');
      if (me?.user) {
        setServerUserMeta(me.user);
      }
    } catch {
      // ignore non-fatal background sync
    }
  }, []);

  const refreshUser = useCallback(async () => {
    const cur = auth.currentUser;
    if (!cur) {
      setUser(null);
      setServerUserMeta(null);
      return;
    }
    await cur.reload().catch(() => {});
    if (cur.emailVerified) {
      await cur.getIdToken(true).catch(() => {});
    }
    const profile = await ensureUserDocuments(cur);
    if (profile.disabled) {
      await signOut(auth);
      setUser(null);
      setAuthDisabledNotice(
        lang === 'ar'
          ? 'تم تعليق هذا الحساب من قبل الإدارة.'
          : 'Ce compte a été désactivé par l’administration.'
      );
      return;
    }
    setFirebaseUser(auth.currentUser);
    setUser(profile);
    await Promise.all([refreshCopyPermission(), refreshPlans(), syncServerUserAndSession()]);
  }, [lang, refreshCopyPermission, refreshPlans, syncServerUserAndSession]);

  const resendVerificationEmail = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    const cur = auth.currentUser;
    if (!cur) return { ok: false, error: 'Not signed in' };
    try {
      await sendEmailVerification(cur);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: translateFirebaseAuthError(err, lang) };
    }
  }, [lang]);

  const reloadVerificationStatus = useCallback(async (): Promise<{
    verified: boolean;
    error?: string;
  }> => {
    const cur = auth.currentUser;
    if (!cur) return { verified: false, error: 'Not signed in' };
    try {
      await cur.reload();
      if (cur.emailVerified) {
        await cur.getIdToken(true);
        await refreshUser();
        return { verified: true };
      }
      return { verified: false };
    } catch (err) {
      return { verified: false, error: translateFirebaseAuthError(err, lang) };
    }
  }, [lang, refreshUser]);

  // Boot: test Firestore connection + load public catalog + listen to Firebase Auth
  useEffect(() => {
    const initialLang = getInitialLanguage();
    document.documentElement.lang = initialLang;
    document.documentElement.dir = initialLang === 'ar' ? 'rtl' : 'ltr';

    trackAnalyticsEvent({ eventType: 'site_visit', pageView: getInitialViewFromPath() });
    trackAnalyticsEvent({ eventType: 'page_view', pageView: getInitialViewFromPath() });

    const onGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const btn = target?.closest('button, a');
      if (!btn) return;
      const label = (btn.getAttribute('aria-label') || btn.textContent || '').trim().slice(0, 60);
      if (label) {
        trackAnalyticsEvent({ eventType: 'site_click', target: label });
      }
    };
    document.addEventListener('click', onGlobalClick, { passive: true });

    void testConnection();
    void Promise.all([refreshCatalog(), refreshPlans()]);

    // Capture ?ref=CODE parameter into localStorage when visiting referral links
    try {
      const sp = new URLSearchParams(window.location.search);
      const refParam = sp.get('ref')?.trim().toUpperCase();
      if (refParam && /^[A-Z0-9_-]{4,24}$/.test(refParam)) {
        window.localStorage.setItem('tadribi_pending_ref', refParam);
      }
    } catch {
      // ignore URL/storage issues
    }

    const onSessionRevoked = () => {
      void signOut(auth).catch(() => {});
      setUser(null);
      setServerUserMeta(null);
      setAuthDisabledNotice(
        lang === 'ar'
          ? 'تم إنهاء جلسة هذا الجهاز من صفحة إدارة الأجهزة النشطة. يرجى تسجيل الدخول مجدداً.'
          : 'Cette session d’appareil a été déconnectée depuis la gestion des appareils.'
      );
    };
    window.addEventListener('tadribi-session-revoked', onSessionRevoked);

    const unsubAuth = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);
      if (!fbUser) {
        setUser(null);
        setActiveSub(null);
        setServerSub(null);
        setServerExpiredSub(null);
        setServerUserMeta(null);
        setCanCopy(false);
        setLessonProgressMap({});
        setNotifications([]);
        setUnreadSupportCount(0);
        setActiveExam(null);
        setAuthToken(null);
        setAuthReady(true);
        setBootLoading(false);
        return;
      }

      try {
        const profile = await ensureUserDocuments(fbUser);
        if (profile.disabled) {
          await signOut(auth);
          setUser(null);
          setCanCopy(false);
          setAuthDisabledNotice(
            'تم إيقاف هذا الحساب مؤقتاً من قبل الإدارة. تواصل مع الدعم لمزيد من التفاصيل.'
          );
          setAuthReady(true);
          setBootLoading(false);
          return;
        }

        setUser(profile);
        if (profile.track) {
          setSelectedTrack(profile.track);
        }

        // If Official Admin signed in, ensure initial Firestore collections are seeded once
        if (profile.isAdmin && isOfficialAdminEmail(fbUser.email) && !seededOnceRef.current) {
          seededOnceRef.current = true;
          try {
            const [apiCat, apiPlans] = await Promise.all([
              apiRequest<CatalogData>('/api/catalog'),
              apiRequest<{ plans: SubscriptionPlan[] }>('/api/plans'),
            ]);
            await seedFirestoreCatalogIfNeeded({
              subjects: apiCat.subjects || [],
              lessons: apiCat.lessons || [],
              plans: apiPlans.plans || [],
              siteConfig: apiCat.siteConfig || emptySiteConfig,
              gradingPolicy: apiCat.gradingPolicy || { maxScore: 20, wrongPenalty: 0, passingScore: 10 },
            });
            await Promise.all([refreshCatalog(), refreshPlans()]);
          } catch (seedErr) {
            console.error('Initial catalog seeding check failed:', seedErr);
          }
        } else {
          void refreshPlans();
        }

        await Promise.all([refreshActiveExam(), refreshCopyPermission(), syncServerUserAndSession()]);
      } catch (err) {
        console.error('Auth state bootstrap failed:', err);
      } finally {
        setAuthReady(true);
        setBootLoading(false);
      }
    });

    return () => {
      document.removeEventListener('click', onGlobalClick);
      window.removeEventListener('tadribi-session-revoked', onSessionRevoked);
      unsubAuth();
    };
  }, [lang, refreshActiveExam, refreshCatalog, refreshCopyPermission, refreshPlans, syncServerUserAndSession]);

  // Periodic device heartbeat to keep session activity accurate & enforce remote revocations
  useEffect(() => {
    if (!authReady || !firebaseUser || !user) return;
    const iv = window.setInterval(() => {
      void apiRequest('/api/auth/sessions/heartbeat', { method: 'POST', json: {} }).catch(() => {});
    }, 60_000);
    return () => window.clearInterval(iv);
  }, [authReady, firebaseUser?.uid, user?.uid]);

  // Refresh ElevenLabs HD voice permission whenever user auth or active subscription changes
  useEffect(() => {
    void speechEngine.refreshElevenLabsStatus();
  }, [authReady, firebaseUser?.uid, activeSub?.id, activeSub?.status, serverSub?.id, serverSub?.status]);

  // Attach real-time Firestore listeners strictly when user is authenticated & verified
  useEffect(() => {
    if (!authReady || !firebaseUser || !user) return;
    const uid = firebaseUser.uid;
    const isAdminUser = Boolean(user.isAdmin);
    const createdMs = Date.parse(user.created_at) || Date.now();

    const unsubProgress = subscribeLessonProgress(uid, (map) => {
      setLessonProgressMap(map);
    });

    const unsubSub = subscribeMyActiveSubscription(uid, (sub) => {
      setActiveSub(sub);
    });

    const unsubConvos = isAdminUser
      ? subscribeAllConversationsForAdmin((list) => {
          setUnreadSupportCount(list.reduce((acc, c) => acc + (c.unreadForAdmin || 0), 0));
        })
      : subscribeUserConversations(uid, (list) => {
          setUnreadSupportCount(list.reduce((acc, c) => acc + (c.unreadForUser || 0), 0));
        });

    return () => {
      unsubProgress();
      unsubSub();
      unsubConvos();
    };
  }, [authReady, firebaseUser, user?.uid, user?.isAdmin]);

  // Separate notification listener so user track/level/subscription filters stay always fresh
  useEffect(() => {
    if (!authReady || !firebaseUser || !user) return;
    const createdMs = Date.parse(user.created_at) || Date.now();
    const unsubNotifs = subscribeUserNotifications({
      uid: firebaseUser.uid,
      userCreatedAtMs: createdMs,
      userTrack: user.track,
      userLevel: user.level,
      hasPaidSub: Boolean(activeSub && activeSub.billing_cycle !== 'free'),
      onUpdate: (items) => {
        setNotifications(items);
      },
    });
    return () => {
      unsubNotifs();
    };
  }, [authReady, firebaseUser, user?.uid, user?.created_at, user?.track, user?.level, activeSub]);

  // Merge user profile + live active/expired subscription + server-verified copy permission
  const effectiveCanCopy = Boolean(
    canCopy && user && user.isAdmin && isOfficialAdminEmail(user.email) && firebaseUser?.emailVerified
  );

  const userWithSub = useMemo(() => {
    if (!user) return null;
    const mergedActive = activeSub || serverSub;
    return {
      ...user,
      referral_code: serverUserMeta?.referral_code || user.referral_code,
      referral_points:
        serverUserMeta?.referral_points !== undefined
          ? serverUserMeta.referral_points
          : user.referral_points,
      phone: user.phone || serverUserMeta?.phone || '',
      last_profile_updated_at: serverUserMeta?.last_profile_updated_at || user.last_profile_updated_at || null,
      last_password_updated_at: serverUserMeta?.last_password_updated_at || user.last_password_updated_at || null,
      last_active_at: serverUserMeta?.last_active_at || user.last_active_at || null,
      canCopy: effectiveCanCopy,
      activeSubscription: mergedActive,
      latestExpiredSubscription: mergedActive ? null : serverExpiredSub,
    };
  }, [user, serverUserMeta, activeSub, serverSub, serverExpiredSub, effectiveCanCopy]);

  // Merge catalog lessons + real-time user progress/favorites
  const catalog = useMemo<CatalogData>(() => {
    const mergedLessons = (baseCatalog.lessons || []).map((l) => {
      const key = l.firestoreId || String(l.id);
      const p = lessonProgressMap[key] || lessonProgressMap[String(l.id)];
      return {
        ...l,
        completed: p ? p.completed : Boolean(l.completed),
        is_favorite: p ? p.isFavorite : Boolean(l.is_favorite),
      };
    });
    return {
      ...baseCatalog,
      lessons: mergedLessons,
    };
  }, [baseCatalog, lessonProgressMap]);

  const unreadNotificationCount = useMemo(() => {
    if (!user || notifications.length === 0) return 0;
    return notifications.filter((n) => !n.is_read).length;
  }, [notifications, user]);

  const refreshNotifications = useCallback(async () => {
    // Notifications update via real-time onSnapshot listener automatically when signed in
  }, []);

  const markNotificationsRead = useCallback(async () => {
    if (!firebaseUser || notifications.length === 0) return;
    const unreadIds = notifications
      .filter((n) => !n.is_read && n.firestoreId)
      .map((n) => n.firestoreId as string);
    if (unreadIds.length === 0) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
    await markNotificationsReadInFirestore(firebaseUser.uid, unreadIds);
  }, [firebaseUser, notifications]);

  const navigate = useCallback((view: AppView, params: ViewParams = {}) => {
    speechEngine.stop();
    setCurrentView(view);
    setViewParams(params);
    setHistoryStack((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.view === view && JSON.stringify(last.params) === JSON.stringify(params)) {
        return prev;
      }
      return [...prev.slice(-24), { view, params }];
    });
    trackAnalyticsEvent({ eventType: 'page_view', pageView: view });
    if (typeof window !== 'undefined') {
      let targetPath = view === 'home' ? '/' : `/${view}`;
      if (view === 'verify-receipt' && params.receiptId && params.receiptSig) {
        targetPath = `/verify-receipt?rid=${encodeURIComponent(params.receiptId)}&sig=${encodeURIComponent(params.receiptSig)}`;
      } else if (view === 'reset-password') {
        const qp = new URLSearchParams();
        if (params.resetToken) qp.set('token', params.resetToken);
        if (params.actionToken) qp.set('at', params.actionToken);
        if (params.oobCode) qp.set('oobCode', params.oobCode);
        const qs = qp.toString();
        if (qs) targetPath = `/reset-password?${qs}`;
      }
      const currentFull = `${window.location.pathname}${window.location.search}`;
      if (currentFull !== targetPath) {
        window.history.pushState({ view, params }, '', targetPath);
      } else {
        window.history.replaceState({ view, params }, '', targetPath);
      }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const goBack = useCallback(() => {
    speechEngine.stop();
    if (typeof window !== 'undefined' && window.history.length > 1 && historyStack.length > 1) {
      window.history.back();
      return;
    }
    if (historyStack.length > 1) {
      const nextStack = historyStack.slice(0, -1);
      const target = nextStack[nextStack.length - 1] || { view: 'home' as AppView, params: {} };
      setHistoryStack(nextStack);
      setCurrentView(target.view);
      setViewParams(target.params);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    navigate('home');
  }, [historyStack, navigate]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const init = getInitialViewAndParams();
    const initPath = `${init.view === 'home' ? '/' : `/${init.view}`}${init.search}`;
    window.history.replaceState({ view: init.view, params: init.params }, '', initPath);

    const onPopState = (ev: PopStateEvent) => {
      speechEngine.stop();
      const state = ev.state as { view?: AppView; params?: ViewParams } | null;
      const nextView =
        state?.view && VALID_VIEWS.includes(state.view)
          ? state.view
          : getInitialViewFromPath();
      const nextParams = state?.params || {};
      setCurrentView(nextView);
      setViewParams(nextParams);
      setHistoryStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : [{ view: nextView, params: nextParams }]));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Mandatory profile completion guard for incomplete Google / Apple OAuth users
  useEffect(() => {
    if (!authReady || !user || user.isAdmin) return;
    const allowedWhileIncomplete: AppView[] = [
      'account-complete',
      'privacy',
      'terms',
      'about',
      'contact',
      'login',
      'register',
      'reset-password',
      'verify-receipt',
      'home',
    ];
    if (user.profileCompleted === false && !allowedWhileIncomplete.includes(currentView)) {
      navigate('account-complete');
    }
  }, [authReady, user, currentView, navigate]);

  const openUpgradeModal = useCallback((featureLabel?: string) => {
    setUpgradeModal({ open: true, featureLabel });
  }, []);

  const closeUpgradeModal = useCallback(() => {
    setUpgradeModal({ open: false });
  }, []);

  const goToAuth = useCallback(
    (mode: 'login' | 'register' | 'forgot' = 'login') => {
      if (mode === 'register') {
        navigate('register');
      } else if (mode === 'forgot') {
        navigate('forgot-password');
      } else {
        navigate('login');
      }
    },
    [navigate]
  );

  const logout = useCallback(async () => {
    speechEngine.stop();
    try {
      await signOut(auth);
      await apiRequest('/api/auth/logout', { method: 'POST' }).catch(() => {});
    } catch {
      // ignore
    }
    setAuthToken(null);
    setUser(null);
    setActiveExam(null);
    navigate('home');
  }, [navigate]);

  const siteConfig = catalog.siteConfig || emptySiteConfig;

  return (
    <AppContext.Provider
      value={{
        lang,
        setLang,
        theme,
        toggleTheme,
        selectedTrack,
        setSelectedTrack,
        firebaseUser,
        authReady,
        user: userWithSub,
        setUser,
        refreshUser,
        resendVerificationEmail,
        reloadVerificationStatus,
        authDisabledNotice,
        clearAuthDisabledNotice: () => setAuthDisabledNotice(null),
        catalog,
        refreshCatalog,
        plans,
        refreshPlans,
        paymentMethods,
        annualSavings,
        freeLimits,
        canCopy: effectiveCanCopy,
        siteConfig,
        notifications,
        unreadNotificationCount,
        unreadSupportCount,
        refreshNotifications,
        markNotificationsRead,
        activeExam,
        setActiveExam,
        refreshActiveExam,
        currentView,
        viewParams,
        navigate,
        canGoBack: historyStack.length > 1 || currentView !== 'home',
        goBack,
        upgradeModal,
        openUpgradeModal,
        closeUpgradeModal,
        goToAuth,
        advancedSearchOpen,
        setAdvancedSearchOpen,
        logout,
        bootLoading,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
