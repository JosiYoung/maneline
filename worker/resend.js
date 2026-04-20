/**
 * Mane Line — Resend email client (Phase 6).
 *
 * Used for transactional emails that need the Mane Line brand (invitations
 * in v1; password-reset + trainer-reject in v1.1). Supabase default emails
 * remain the fallback for auth flows we haven't migrated yet.
 *
 * Env:
 *   RESEND_API_KEY   — required; if missing, isResendConfigured()=false
 *                      and every send returns { ok:false, status:501 }.
 *   RESEND_FROM      — optional; default "Mane Line <hello@maneline.co>".
 */

export function isResendConfigured(env) {
  return !!env.RESEND_API_KEY;
}

export function resendFrom(env) {
  return env.RESEND_FROM || 'Mane Line <hello@maneline.co>';
}

export async function sendEmail(env, { to, subject, html, text, replyTo, tags }) {
  if (!isResendConfigured(env)) {
    return { ok: false, status: 501, error: 'resend_not_configured' };
  }
  const payload = {
    from: resendFrom(env),
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    text,
  };
  if (replyTo) payload.reply_to = replyTo;
  if (tags && typeof tags === 'object') {
    payload.tags = Object.entries(tags).map(([name, value]) => ({
      name,
      value: String(value).slice(0, 256),
    }));
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const textBody = await res.text();
  let data;
  try { data = textBody ? JSON.parse(textBody) : null; } catch { data = textBody; }
  return { ok: res.ok, status: res.status, data };
}
