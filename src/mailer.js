// mailer.js — transactional email via Brevo SMTP (nodemailer).
// Credentials come from env (.env). If they're missing, the mailer runs in
// "dry" mode: it logs what it *would* send and returns gracefully, so the rest
// of the app keeps working before you paste the Brevo key.
import nodemailer from 'nodemailer';
import { getSetting } from './db.js';

const HOST = process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com';
const PORT = Number(process.env.BREVO_SMTP_PORT || 587);
const USER = process.env.BREVO_SMTP_USER || '';
const KEY = process.env.BREVO_SMTP_KEY || '';
const FROM = process.env.MAIL_FROM || 'TikTok Studio <softsynerg@gmail.com>';

export const mailerReady = Boolean(USER && KEY);

let transport = null;
if (mailerReady) {
  transport = nodemailer.createTransport({
    host: HOST,
    port: PORT,
    secure: PORT === 465,
    auth: { user: USER, pass: KEY }
  });
}

/**
 * Send an email. Falls back to a logged "dry run" when Brevo is not configured.
 * @returns {Promise<{ok:boolean, dry?:boolean, id?:string, error?:string}>}
 */
export async function sendMail({ to, subject, html, text }) {
  const recipient = to || getSetting('mail_to', 'softsynerg@gmail.com');
  if (!mailerReady) {
    console.log(`[mailer:dry] would send "${subject}" -> ${recipient}`);
    return { ok: true, dry: true };
  }
  try {
    const info = await transport.sendMail({
      from: FROM,
      to: recipient,
      subject,
      text: text || stripHtml(html || ''),
      html
    });
    console.log(`[mailer] sent "${subject}" -> ${recipient} (${info.messageId})`);
    return { ok: true, id: info.messageId };
  } catch (err) {
    console.error('[mailer] error:', err.message);
    return { ok: false, error: err.message };
  }
}

function stripHtml(s) {
  return s.replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
}

// Shared dark email shell so every studio email looks consistent.
export function emailShell(title, bodyHtml) {
  return `<!DOCTYPE html><html><body style="margin:0;background:#0d0f14;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#e7e9ee">
  <div style="max-width:620px;margin:0 auto;padding:28px 22px">
    <div style="font-size:13px;letter-spacing:3px;text-transform:uppercase;color:#7c5cff;font-weight:700">TikTok Studio · Soft Synergy</div>
    <h1 style="font-size:26px;margin:8px 0 18px;line-height:1.15;color:#fff">${title}</h1>
    ${bodyHtml}
    <div style="margin-top:30px;padding-top:16px;border-top:1px solid #20242e;font-size:12px;color:#6b7280">
      Wysłane automatycznie przez TikTok Studio. Konfigurację maili zmienisz w zakładce Ustawienia.
    </div>
  </div></body></html>`;
}
