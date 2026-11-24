/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { MailCheck, RefreshCw, ShieldAlert } from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { UpgradePromptModal } from './components/UpgradePromptModal';
import { AppProvider, useApp } from './context/AppContext';
import { AccountCompletionPage } from './pages/AccountCompletionPage';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { AllSubjectsPage } from './pages/AllSubjectsPage';
import { BaccalaureatePage } from './pages/BaccalaureatePage';
import { DashboardPage } from './pages/DashboardPage';
import { ExamCenterPage } from './pages/ExamCenterPage';
import { FavoritesPage } from './pages/FavoritesPage';
import { HomePage } from './pages/HomePage';
import { InfoPages } from './pages/InfoPages';
import { LessonsPage } from './pages/LessonsPage';
import { LoginPage } from './pages/LoginPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { PaymentCheckoutPage } from './pages/PaymentCheckoutPage';
import { ProfilePage } from './pages/ProfilePage';
import { QuestionBankPage } from './pages/QuestionBankPage';
import { RegisterPage } from './pages/RegisterPage';
import { ReportIssuePage } from './pages/ReportIssuePage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { ReviewCenterPage } from './pages/ReviewCenterPage';
import { SubscriptionsPage } from './pages/SubscriptionsPage';
import { SummariesPage } from './pages/SummariesPage';
import { SupportPage } from './pages/SupportPage';
import { VerifyReceiptPage } from './pages/VerifyReceiptPage';

const EmailVerificationGateBanner: React.FC = () => {
  const {
    lang,
    firebaseUser,
    user,
    resendVerificationEmail,
    reloadVerificationStatus,
    logout,
  } = useApp();
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null);

  if (!firebaseUser || !user || firebaseUser.emailVerified) return null;

  const handleResend = async () => {
    if (cooldown > 0 || busy) return;
    setBusy(true);
    setFeedback(null);
    const res = await resendVerificationEmail();
    setBusy(false);
    if (res.ok) {
      setFeedback({
        text:
          lang === 'ar'
            ? 'تم إرسال رابط التفعيل إلى بريدك الإلكتروني بنجاح. تحقق من البريد الوارد أو الرسائل غير المرغوب فيها.'
            : 'E-mail de vérification envoyé avec succès. Vérifiez votre boîte de réception ou spams.',
        ok: true,
      });
      setCooldown(45);
      const iv = window.setInterval(() => {
        setCooldown((prev) => {
          if (prev <= 1) {
            window.clearInterval(iv);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      setFeedback({
        text:
          res.error ||
          (lang === 'ar' ? 'تعذر إرسال رابط التفعيل.' : 'Impossible d’envoyer le lien.'),
        ok: false,
      });
    }
  };

  const handleCheck = async () => {
    setBusy(true);
    setFeedback(null);
    const res = await reloadVerificationStatus();
    setBusy(false);
    if (!res.verified) {
      setFeedback({
        text:
          res.error ||
          (lang === 'ar'
            ? 'لم يتم تأكيد البريد الإلكتروني بعد. افتح الرابط المرسل إلى بريدك ثم أعد الفحص.'
            : 'E-mail non encore vérifié. Cliquez sur le lien reçu puis réessayez.'),
        ok: false,
      });
    }
  };

  return (
    <div className="bg-[#fff8e6] border-b border-[#e8cf86] px-4 py-3 text-xs text-[#544006]">
      <div className="max-w-[1200px] mx-auto flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <MailCheck className="w-4 h-4 text-[#9a7209] shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">
              {lang === 'ar'
                ? 'حسابك بانتظار تأكيد البريد الإلكتروني:'
                : 'Votre compte attend la vérification par e-mail :'}{' '}
            </span>
            <span dir="ltr" className="font-mono font-bold">
              {user.email}
            </span>
            <span className="ms-1">
              {lang === 'ar'
                ? 'فعّل بريدك لإتاحة الاشتراكات والدعم المباشر وحفظ التقدم.'
                : 'Vérifiez votre adresse pour activer les abonnements et le support.'}
            </span>
            {feedback && (
              <div className={`mt-1 font-bold ${feedback.ok ? 'text-[#4e8b1f]' : 'text-red-700'}`}>
                {feedback.text}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            disabled={busy}
            onClick={handleCheck}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-[4px] bg-[#384D55] text-white font-bold cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
            <span>{lang === 'ar' ? 'تم التفعيل — تحقق الآن' : 'J’ai vérifié'}</span>
          </button>
          <button
            type="button"
            disabled={busy || cooldown > 0}
            onClick={handleResend}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-[4px] bg-white border border-[#d1b45a] text-[#544006] font-bold cursor-pointer disabled:opacity-60"
          >
            {cooldown > 0
              ? lang === 'ar'
                ? `إعادة الإرسال (${cooldown}ث)`
                : `Renvoyer (${cooldown}s)`
              : lang === 'ar'
                ? 'إعادة إرسال رابط التفعيل'
                : 'Renvoyer le lien'}
          </button>
          <button
            type="button"
            onClick={() => void logout()}
            className="underline font-bold text-[#6b5514] cursor-pointer"
          >
            {lang === 'ar' ? 'تسجيل الخروج' : 'Déconnexion'}
          </button>
        </div>
      </div>
    </div>
  );
};

const MainRouter: React.FC = () => {
  const { currentView, bootLoading, lang, user, authDisabledNotice, clearAuthDisabledNotice } =
    useApp();

  if (bootLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f4f6f7] text-[#384D55] font-bold text-sm">
        {lang === 'ar' ? 'جارٍ تحميل منصة التدريب الحر...' : 'Chargement de la plateforme...'}
      </div>
    );
  }

  const renderView = () => {
    switch (currentView) {
      case 'home':
        return <HomePage />;
      case 'all-subjects':
        return <AllSubjectsPage />;
      case 'lessons':
        return <LessonsPage />;
      case 'summaries':
        return <SummariesPage />;
      case 'question-bank':
        return <QuestionBankPage />;
      case 'review-center':
        return <ReviewCenterPage />;
      case 'exams':
        return <ExamCenterPage />;
      case 'baccalaureate':
        return <BaccalaureatePage />;
      case 'favorites':
        return <FavoritesPage />;
      case 'notifications':
        return <NotificationsPage />;
      case 'report':
        return <ReportIssuePage />;
      case 'dashboard':
        return <DashboardPage />;
      case 'profile':
        return <ProfilePage />;
      case 'account-complete':
        return <AccountCompletionPage />;
      case 'support':
        return <SupportPage />;
      case 'about':
        return <InfoPages mode="about" />;
      case 'privacy':
        return <InfoPages mode="privacy" />;
      case 'terms':
        return <InfoPages mode="terms" />;
      case 'contact':
        return <InfoPages mode="contact" />;
      case 'admin':
        return user?.isAdmin ? (
          <AdminDashboardPage />
        ) : (
          <div className="max-w-3xl mx-auto px-4 py-12">
            <div className="bg-white border border-[#d8dfe2] p-8 text-center space-y-3 rounded-[4px]">
              <ShieldAlert className="w-10 h-10 text-red-600 mx-auto" />
              <h1 className="text-lg font-extrabold text-[#384D55]">
                {lang === 'ar' ? 'وصول مقيّد بالإدارة الرسمية فقط' : 'Accès strictement réservé'}
              </h1>
              <p className="text-xs text-[#6b787e]">
                {lang === 'ar'
                  ? 'لوحة الإدارة متاحة فقط لحساب المدير الرسمي المعتمد.'
                  : 'Ce panneau est exclusivement réservé à l’administrateur officiel.'}
              </p>
            </div>
          </div>
        );
      case 'login':
        return <LoginPage initialMode="login" />;
      case 'forgot-password':
        return <LoginPage initialMode="forgot" />;
      case 'reset-password':
        return <ResetPasswordPage />;
      case 'verify-receipt':
        return <VerifyReceiptPage />;
      case 'register':
        return <RegisterPage />;
      case 'subscriptions':
        return <SubscriptionsPage />;
      case 'checkout':
        return <PaymentCheckoutPage />;
      default:
        return <HomePage />;
    }
  };

  return (
    <Layout>
      {authDisabledNotice && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2.5 text-xs text-red-800 flex items-center justify-between max-w-[1200px] mx-auto">
          <span className="font-bold">{authDisabledNotice}</span>
          <button
            type="button"
            onClick={clearAuthDisabledNotice}
            className="font-bold underline cursor-pointer"
          >
            {lang === 'ar' ? 'إغلاق' : 'Fermer'}
          </button>
        </div>
      )}
      <EmailVerificationGateBanner />
      {renderView()}
      <UpgradePromptModal />
    </Layout>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <MainRouter />
      </AppProvider>
    </ErrorBoundary>
  );
}
