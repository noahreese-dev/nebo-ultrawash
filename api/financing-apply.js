// NEBO UltraWash — financing application handler.
// Receives the application payload, emails the customer a branded confirmation
// and emails NEBO the lead, both via Resend. Config via env vars (set on Vercel):
//   RESEND_API_KEY  — required. From resend.com → API Keys.
//   MAIL_FROM       — e.g. "NEBO UltraWash <noreply@yourdomain.com>".
//                     Until a domain is verified in Resend, use "onboarding@resend.dev"
//                     (test mode: can only deliver to your Resend account email).
//   NEBO_NOTIFY     — internal address that should receive each new application.
const money = (n) => '$' + (Number(n) || 0).toLocaleString('en-CA');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }

  const KEY = process.env.RESEND_API_KEY;
  const FROM = process.env.MAIL_FROM || 'NEBO UltraWash <onboarding@resend.dev>';
  const NOTIFY = process.env.NEBO_NOTIFY || '';
  if (!KEY) { res.status(500).json({ error: 'missing_resend_key' }); return; }

  let d = req.body;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = {}; } }
  d = d || {};

  const vehicle = `${d.vYear || ''} ${d.vMake || ''} ${d.vModel || ''}`.trim() || 'your vehicle';
  const services = Array.isArray(d.service) ? d.service.join(', ') : (d.service || '');
  const fields = {
    firstName: d.firstName || 'there',
    vehicle, services, plan: d.plan || '',
    serviceTotal: money(d.serviceTotal),
    deposit: money(d.deposit),
    monthly: money(d.monthly),
    referenceCode: d.referenceCode || 'NEBO',
  };

  // Customer confirmation: pull the branded template and fill {{placeholders}}.
  let custHtml;
  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const tpl = await fetch(`${proto}://${host}/assets/email-confirmation.html`).then((r) => r.text());
    custHtml = tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (fields[k] != null ? String(fields[k]) : ''));
  } catch (e) {
    custHtml = `<p>Hi ${fields.firstName}, your NEBO UltraWash 0% financing application is received.</p>
      <p>Reference: <b>${fields.referenceCode}</b>. A NEBO team member will reach out to schedule your appointment.</p>`;
  }

  const send = (to, subject, html, replyTo) =>
    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to, subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
    }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.text().catch(() => '') }));

  const results = {};
  if (d.email) {
    results.customer = await send(d.email, 'Your NEBO UltraWash 0% Financing application', custHtml);
  }
  if (NOTIFY) {
    const lead = `<h2 style="font-family:Arial">New 0% financing application</h2>
      <p><b>Ref:</b> ${fields.referenceCode}</p>
      <p><b>Name:</b> ${d.firstName || ''} ${d.lastName || ''}<br>
         <b>Email:</b> ${d.email || ''}<br><b>Phone:</b> ${d.phone || ''}<br><b>City:</b> ${d.city || ''}</p>
      <p><b>Vehicle:</b> ${vehicle}<br><b>Services:</b> ${services}<br><b>Plan:</b> ${fields.plan}</p>
      <p><b>Est. total:</b> ${fields.serviceTotal} &middot; <b>Deposit (20%):</b> ${fields.deposit} &middot; <b>Est. monthly:</b> ${fields.monthly}</p>
      <p><b>Pay method:</b> ${d.payMethod || ''}<br><b>Source:</b> ${d.ref || 'direct'}</p>
      <p><b>Notes:</b> ${(d.notes || '—')}</p>`;
    results.nebo = await send(
      NOTIFY,
      `New financing application — ${(d.firstName || '')} ${(d.lastName || '')} (${fields.referenceCode})`,
      lead,
      d.email || undefined
    );
  }

  const ok = (!d.email || results.customer?.ok) && (!NOTIFY || results.nebo?.ok);
  res.status(ok ? 200 : 502).json({ ok, results });
}
