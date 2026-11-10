import { fileURLToPath } from 'node:url';

export const OWN_MASTERS_MAIL_DESIGN = 'own-masters-letter-v1';

export const ownMastersMailLogo = Object.freeze({
  filename: 'own-masters-logo.png',
  path: fileURLToPath(new URL('../../../public/own-masters-logo.png', import.meta.url)),
  cid: 'own-masters-logo@ownmasters.invalid',
  contentType: 'image/png',
  contentDisposition: 'inline',
});

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
const emailAddress = value => /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(value || '') ? value : '';
const webUrl = value => {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Invalid Own Masters email URL.');
  return url;
};

// The single visual letterhead for all application emails. Callers provide
// content, never HTML; names, paragraphs, notices and links are escaped here.
export function renderOwnMastersLetter({
  subject, name, titleLines, subtitle = '', preheader = '',
  eyebrow = 'YOUR MUSIC. YOUR BUSINESS.', body, button = null,
  instruction = '', notice = null, footnote = '',
  securityNote = 'Own Masters will never ask you to share your password by email.',
  appOrigin, supportEmail = '',
}) {
  if (typeof subject !== 'string' || !subject.trim() || /[\r\n]/.test(subject))
    throw new Error('Invalid Own Masters email subject.');
  const origin = webUrl(appOrigin).origin;
  const paragraphs = (Array.isArray(body) ? body : [body]).filter(value => typeof value === 'string' && value.trim());
  if (!Array.isArray(titleLines) || !titleLines.length || !paragraphs.length)
    throw new Error('Own Masters emails require a heading and body.');
  if (button && (!button.label?.trim() || !button.url)) throw new Error('Email buttons require a label and URL.');
  const destination = button ? webUrl(button.url).href : '';
  const safeLink = escapeHtml(destination);
  const firstName = String(name || '').trim().split(/\s+/)[0].slice(0, 60);
  const greeting = firstName ? 'Hi ' + firstName + ',' : 'Hi there,';
  const title = titleLines.map(escapeHtml).join('<br />');
  const support = emailAddress(supportEmail);
  const contactUrl = new URL('/contact', origin).href;
  const supportHref = support ? 'mailto:' + encodeURIComponent(support) : contactUrl;
  const help = 'Need a hand? ' + (support || contactUrl);
  return {
    subject,
    text: [titleLines.join(' '), greeting, ...paragraphs,
      button ? button.label + ':\n' + destination : '', instruction,
      notice ? notice.title + ' ' + notice.body : '', footnote, securityNote,
      help, 'Own Masters\nBe the label. Own the masters.',
    ].filter(Boolean).join('\n\n'),
    html: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${escapeHtml(subject)} | Own Masters</title>
  <style>
    body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }
    img { border:0; height:auto; line-height:100%; outline:none; text-decoration:none; }
    @media screen and (max-width:600px) {
      .outer { padding:20px 12px !important; }
      .content { padding:30px 24px !important; }
      .hero { padding:28px 24px 32px !important; }
      .headline { font-size:36px !important; line-height:39px !important; }
      .button { display:block !important; text-align:center !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;width:100%;background-color:#f4f6fa;font-family:Arial,Helvetica,sans-serif;color:#17202e;">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f4f6fa">
    <tr><td class="outer" align="center" style="padding:40px 20px;">
      <!--[if mso]><table role="presentation" width="600"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;">
        <tr><td style="border:1px solid #d5dce6;border-radius:24px;overflow:hidden;background-color:#ffffff;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td class="hero" bgcolor="#0b0f17" style="padding:32px 40px 38px;border-radius:23px 23px 0 0;background-color:#0b0f17;color:#ffffff;">
              <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                <td width="52" valign="middle"><img src="cid:${ownMastersMailLogo.cid}" width="42" height="42" alt="" style="display:block;width:42px;height:42px;" /></td>
                <td valign="middle" style="font-size:18px;line-height:24px;font-weight:700;letter-spacing:-0.3px;color:#ffffff;">Own Masters</td>
              </tr></table>
              <p style="margin:34px 0 14px;font-size:11px;line-height:18px;letter-spacing:2px;font-weight:700;color:#aeb8c8;">${escapeHtml(eyebrow)}</p>
              <h1 class="headline" style="margin:0;font-size:44px;line-height:47px;letter-spacing:-1.6px;font-weight:700;color:#ffffff;">${title}</h1>
              <p style="margin:18px 0 0;font-size:15px;line-height:23px;color:#c6ceda;">${escapeHtml(subtitle)}</p>
            </td></tr>
            <tr><td class="content" style="padding:34px 40px 36px;">
              <p style="margin:0 0 12px;font-size:17px;line-height:26px;font-weight:700;color:#17202e;">${escapeHtml(greeting)}</p>
              <p style="margin:0 0 26px;font-size:16px;line-height:26px;color:#586374;">${paragraphs.map(escapeHtml).join('</p><p style="margin:0 0 26px;font-size:16px;line-height:26px;color:#586374;">')}</p>
${button ? `              <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="left">
                <a class="button" href="${safeLink}" style="display:inline-block;min-width:176px;border:1px solid #17202e;border-radius:14px;background-color:#17202e;padding:16px 25px;font-size:16px;line-height:22px;font-weight:700;text-align:center;text-decoration:none;color:#ffffff;mso-padding-alt:0;"><!--[if mso]><i style="mso-font-width:150%;mso-text-raise:30pt;" hidden>&emsp;</i><span style="mso-text-raise:15pt;"><![endif]-->${escapeHtml(button.label)}&nbsp; &#8594;<!--[if mso]></span><i style="mso-font-width:150%;" hidden>&emsp;&#8203;</i><![endif]--></a>
              </td></tr></table>` : ''}
${instruction ? `              <p style="margin:16px 0 0;font-size:13px;line-height:21px;color:#586374;">${escapeHtml(instruction)}</p>` : ''}
${notice ? `              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;"><tr><td bgcolor="#edf1f6" style="padding:14px 16px;border:1px solid #d5dce6;border-radius:12px;background-color:#edf1f6;">
                <p style="margin:0;font-size:13px;line-height:21px;color:#17202e;"><strong>${escapeHtml(notice.title)}</strong> ${escapeHtml(notice.body)}</p>
              </td></tr></table>` : ''}
${button ? `              <p style="margin:26px 0 8px;font-size:12px;line-height:20px;color:#586374;">Button not opening? Copy and paste this link into your browser:</p>
              <p style="margin:0;font-size:12px;line-height:19px;word-break:break-all;overflow-wrap:anywhere;"><a href="${safeLink}" style="color:#17202e;text-decoration:underline;word-break:break-all;">${safeLink}</a></p>` : ''}
            </td></tr>
            <tr><td class="content" style="padding:24px 40px 28px;border-top:1px solid #d5dce6;">
              <p style="margin:0 0 8px;font-size:12px;line-height:20px;color:#586374;">${escapeHtml(footnote)}</p>
              <p style="margin:0 0 18px;font-size:12px;line-height:20px;color:#586374;">${escapeHtml(securityNote)}</p>
              <p style="margin:0;font-size:12px;line-height:20px;color:#586374;">Need a hand? <a href="${escapeHtml(supportHref)}" style="color:#17202e;font-weight:700;text-decoration:underline;">${escapeHtml(support || 'Contact support')}</a></p>
            </td></tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding:24px 16px 4px;"><p style="margin:0;font-size:12px;line-height:20px;font-weight:700;letter-spacing:0.2px;color:#586374;">Be the label. Own the masters.</p></td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>`,
    attachments: [{ ...ownMastersMailLogo }],
    ...(support ? { replyTo: { address: support } } : {}),
  };
}

export function renderDeliveryTestMail({ appOrigin, supportEmail = '' }) {
  return renderOwnMastersLetter({
    subject: 'Own Masters email delivery test',
    titleLines: ['Your Own Masters', 'email is connected.'],
    eyebrow: 'OWN MASTERS EMAIL',
    subtitle: 'The same signature, wherever you hear from us.',
    preheader: 'Your requested Own Masters email delivery check.',
    body: 'This is the Own Masters email delivery test you requested. Confirmation and password-recovery messages use this same letter design and sender connection.',
    button: { label: 'Open Own Masters', url: webUrl(appOrigin).origin },
    notice: { title: 'No action required.', body: 'This test did not create an account, change a password, or generate a confirmation link.' },
    footnote: 'Didn’t request this delivery test? You can ignore this email.',
    appOrigin, supportEmail,
  });
}
