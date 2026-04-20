/**
 * Mane Line — Invitation email template (Phase 6).
 *
 * Shared brand header/footer, owner/trainer role copy, magic-link
 * deep link to /welcome?i=<token>.
 */

const COLORS = {
  bg: '#0b0f14',
  surface: '#111821',
  text: '#e6edf3',
  muted: '#8b98a8',
  accent: '#d4a373',
  border: '#1f2a37',
};

function layout({ title, bodyHtml }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:${COLORS.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${COLORS.text};">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${COLORS.bg};">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:12px;">
        <tr><td style="padding:24px 28px;border-bottom:1px solid ${COLORS.border};">
          <div style="font-size:18px;font-weight:600;letter-spacing:0.02em;">Mane Line</div>
          <div style="font-size:12px;color:${COLORS.muted};margin-top:4px;">From Silver Lining Herbs</div>
        </td></tr>
        <tr><td style="padding:28px;">${bodyHtml}</td></tr>
        <tr><td style="padding:18px 28px;border-top:1px solid ${COLORS.border};font-size:12px;color:${COLORS.muted};">
          You're receiving this because an admin invited you to the Mane Line closed beta.<br />
          Questions? Reply to this email.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

export function renderInvitationEmail({ role, inviteUrl, barnName, expiresAt }) {
  const roleLabel = role === 'trainer' ? 'Trainer' : 'Owner';
  const greeting = role === 'trainer'
    ? `You've been invited to join Mane Line as a <strong>trainer</strong>.`
    : `You've been invited to join Mane Line — your barn's herbal-care portal from Silver Lining Herbs.`;
  const barnLine = barnName
    ? `<p style="margin:0 0 16px 0;font-size:14px;color:${COLORS.muted};">Barn: <strong style="color:${COLORS.text};">${escapeHtml(barnName)}</strong></p>`
    : '';
  const expires = expiresAt
    ? `<p style="margin:24px 0 0 0;font-size:12px;color:${COLORS.muted};">This link expires ${escapeHtml(new Date(expiresAt).toUTCString())}.</p>`
    : '';
  const subject = `Your Mane Line ${roleLabel} invite`;
  const body = `
    <h1 style="margin:0 0 12px 0;font-size:22px;color:${COLORS.text};">Welcome aboard</h1>
    ${barnLine}
    <p style="margin:0 0 20px 0;font-size:15px;line-height:1.55;color:${COLORS.text};">${greeting}</p>
    <p style="margin:0 0 28px 0;font-size:15px;line-height:1.55;color:${COLORS.text};">
      Click the button below to claim your account and sign in. Your email is already on the allowlist.
    </p>
    <p style="margin:0;">
      <a href="${escapeHtml(inviteUrl)}"
         style="display:inline-block;padding:12px 22px;background:${COLORS.accent};color:#111;
                font-weight:600;text-decoration:none;border-radius:8px;font-size:14px;">
        Accept invite
      </a>
    </p>
    <p style="margin:18px 0 0 0;font-size:12px;color:${COLORS.muted};word-break:break-all;">
      Or paste this link: <br /><a href="${escapeHtml(inviteUrl)}" style="color:${COLORS.accent};">${escapeHtml(inviteUrl)}</a>
    </p>
    ${expires}`;
  const text = [
    `Welcome aboard — Mane Line ${roleLabel} invite`,
    barnName ? `Barn: ${barnName}` : '',
    '',
    role === 'trainer'
      ? `You've been invited to join Mane Line as a trainer.`
      : `You've been invited to join Mane Line — your barn's herbal-care portal from Silver Lining Herbs.`,
    '',
    `Accept your invite: ${inviteUrl}`,
    '',
    expiresAt ? `This link expires ${new Date(expiresAt).toUTCString()}.` : '',
    '',
    'Silver Lining Herbs — Mane Line closed beta',
  ].filter(Boolean).join('\n');
  return { subject, html: layout({ title: subject, bodyHtml: body }), text };
}
