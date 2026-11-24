interface SendPasswordResetParams {
  to: string;
  name?: string;
  method: 'link' | 'otp';
  lang?: 'ar' | 'fr';
  resetUrl?: string;
  otp?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendPasswordResetEmail(params: SendPasswordResetParams): Promise<{ delivered: boolean }> {
  const isFr = params.lang === 'fr';
  const subject = isFr
    ? params.method === 'otp'
      ? 'Code de vérification (OTP) – Plateforme de Formation Libre'
      : 'Réinitialisation du mot de passe – Plateforme de Formation Libre'
    : params.method === 'otp'
      ? 'رمز التحقق (OTP) – منصة التدريب الحر'
      : 'استعادة كلمة المرور – منصة التدريب الحر';

  const safeName = escapeHtml(params.name || (isFr ? 'Apprenant' : 'متدربنا العزيز'));
  const html =
    params.method === 'otp'
      ? `<div dir="${isFr ? 'ltr' : 'rtl'}" style="font-family:Tahoma,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#f8f9f5;border:1px solid #d6dacb;border-radius:8px;color:#3a4650;">
          <h2 style="color:#7c9e1c;margin-top:0;">${isFr ? 'Code de vérification' : 'رمز التحقق لاستعادة كلمة المرور'}</h2>
          <p>${isFr ? `Bonjour ${safeName},` : `مرحباً ${safeName}،`}</p>
          <p>${isFr ? 'Utilisez le code ci-dessous pour réinitialiser votre mot de passe (valide 5 minutes) :' : 'استخدم رمز التحقق التالي لإعادة تعيين كلمة المرور (صالح لمدة 5 دقائق فقط):'}</p>
          <div style="font-size:28px;font-weight:700;letter-spacing:6px;text-align:center;background:#ffffff;border:2px dashed #a4cc39;border-radius:6px;padding:14px;margin:18px 0;color:#2b3a1a;" dir="ltr">${escapeHtml(params.otp || '')}</div>
          <p style="font-size:12px;color:#6f7468;">${isFr ? "Si vous n'avez pas demandé cette réinitialisation, ignorez cet e-mail." : 'إذا لم تطلب استعادة كلمة المرور، يمكنك تجاهل هذه الرسالة.'}</p>
        </div>`
      : `<div dir="${isFr ? 'ltr' : 'rtl'}" style="font-family:Tahoma,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#f8f9f5;border:1px solid #d6dacb;border-radius:8px;color:#3a4650;">
          <h2 style="color:#7c9e1c;margin-top:0;">${isFr ? 'Réinitialisation du mot de passe' : 'رابط استعادة كلمة المرور'}</h2>
          <p>${isFr ? `Bonjour ${safeName},` : `مرحباً ${safeName}،`}</p>
          <p>${isFr ? 'Cliquez sur le bouton ci-dessous pour définir un nouveau mot de passe (lien à usage unique valide 5 minutes) :' : 'اضغط على الزر التالي لتعيين كلمة مرور جديدة (رابط للاستخدام مرة واحدة وصالح لمدة 5 دقائق فقط):'}</p>
          <p style="text-align:center;margin:22px 0;">
            <a href="${escapeHtml(params.resetUrl || '')}" style="display:inline-block;background:#a4cc39;color:#2b3a1a;font-weight:700;text-decoration:none;padding:12px 26px;border-radius:4px;border:1px solid #7c9e1c;">${isFr ? 'Réinitialiser le mot de passe' : 'تعيين كلمة مرور جديدة'}</a>
          </p>
          <p style="font-size:12px;color:#6f7468;">${isFr ? "Si vous n'avez pas demandé cette réinitialisation, ignorez cet e-mail." : 'إذا لم تطلب استعادة كلمة المرور، يمكنك تجاهل هذه الرسالة.'}</p>
        </div>`;

  const resendKey = process.env.RESEND_API_KEY?.trim();
  const fromAddress = process.env.EMAIL_FROM?.trim() || 'منصة تدريبي <no-reply@tadribi.chtbqi.com>';

  if (resendKey) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromAddress,
          to: [params.to],
          subject,
          html,
        }),
      });
      return { delivered: response.ok };
    } catch (err) {
      console.error('[mailer] Resend dispatch error:', err);
      return { delivered: false };
    }
  }

  const webhookUrl = process.env.SMTP_WEBHOOK_URL?.trim();
  if (webhookUrl) {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: params.to,
          from: fromAddress,
          subject,
          html,
          method: params.method,
        }),
      });
      return { delivered: response.ok };
    } catch (err) {
      console.error('[mailer] Webhook dispatch error:', err);
      return { delivered: false };
    }
  }

  // No external email provider configured: never expose tokens or OTPs in HTTP responses.
  return { delivered: false };
}
