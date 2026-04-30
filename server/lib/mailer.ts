import nodemailer from 'nodemailer';

if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
  throw new Error('SMTP_HOST, SMTP_USER, and SMTP_PASS must be set');
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 2525),
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 15_000,
});

const FROM = process.env.SMTP_FROM || 'LubriConnect <no-reply@lubritec.local>';
const APP_URL = process.env.APP_URL || 'http://localhost:5173';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendInviteEmail(to: string, name: string, tokenId: string, rawToken: string) {
  const url = `${APP_URL}/auth/setup?id=${tokenId}&token=${rawToken}`;
  const safeName = escapeHtml(name);
  await transporter.sendMail({
    from: FROM,
    to,
    subject: 'Configure seu acesso ao LubriConnect',
    text: `Olá ${name},\n\nVocê foi convidado para o LubriConnect. Configure sua senha em:\n\n${url}\n\nO link expira em 7 dias.`,
    html: `<p>Olá <strong>${safeName}</strong>,</p><p>Você foi convidado para o LubriConnect.</p><p><a href="${url}">Configurar minha senha</a></p><p style="color:#666">O link expira em 7 dias.</p>`,
  });
}

export async function sendResetEmail(to: string, name: string, tokenId: string, rawToken: string) {
  const url = `${APP_URL}/auth/reset?id=${tokenId}&token=${rawToken}`;
  const safeName = escapeHtml(name);
  await transporter.sendMail({
    from: FROM,
    to,
    subject: 'Redefina sua senha — LubriConnect',
    text: `Olá ${name},\n\nVocê pediu redefinição de senha. Acesse:\n\n${url}\n\nO link expira em 1 hora. Se não foi você, ignore.`,
    html: `<p>Olá <strong>${safeName}</strong>,</p><p>Você pediu redefinição de senha.</p><p><a href="${url}">Redefinir senha</a></p><p style="color:#666">O link expira em 1 hora. Se não foi você, ignore este e-mail.</p>`,
  });
}
