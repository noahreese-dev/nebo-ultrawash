// NEBO UltraWash — financing application handler.
// On submit: emails the customer a branded confirmation and emails NEBO a branded
// lead notification, both via Resend. Config via env vars (set on Vercel):
//   RESEND_API_KEY  — required. From resend.com → API Keys.
//   MAIL_FROM       — e.g. "NEBO UltraWash <noreply@ultrawash.com>" once the domain
//                     is verified; until then "onboarding@resend.dev" (test mode:
//                     can only deliver to the Resend account's own email).
//   NEBO_NOTIFY     — internal address that receives each new application.
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

  const vehicle = `${d.vYear || ''} ${d.vMake || ''} ${d.vModel || ''}`.trim() || 'their vehicle';
  const services = Array.isArray(d.service) ? d.service.join(', ') : (d.service || '');
  let submitted = '';
  try { submitted = d.submittedAt ? new Date(d.submittedAt).toLocaleString('en-CA') : ''; } catch (e) {}
  const fields = {
    firstName: d.firstName || 'there', lastName: d.lastName || '',
    email: d.email || '', phone: d.phone || '', city: d.city || '—',
    vehicle, services, plan: d.plan || '',
    serviceTotal: money(d.serviceTotal), deposit: money(d.deposit), monthly: money(d.monthly),
    payMethod: d.payMethod === 'paypal' ? 'PayPal' : 'Credit / Debit card',
    ref: d.ref || 'direct',
    notes: ((d.notes || '').toString().trim()) || '—',
    referenceCode: d.referenceCode || 'NEBO',
    submittedAt: submitted,
  };

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const base = `${proto}://${host}`;
  const fill = (t) => t.replace(/\{\{(\w+)\}\}/g, (_, k) => (fields[k] != null ? String(fields[k]) : ''));
  async function tpl(name, fallback) {
    try { return fill(await fetch(`${base}/assets/${name}`).then((r) => r.text())); }
    catch (e) { return fallback; }
  }

  const custHtml = await tpl('email-confirmation.html',
    `<p>Hi ${fields.firstName}, your NEBO UltraWash 0% financing application is received. Reference ${fields.referenceCode}. A NEBO team member will reach out to schedule your appointment.</p>`);
  const leadHtml = await tpl('email-lead.html',
    `<p>New application: ${fields.firstName} ${fields.lastName} — ${fields.services} — deposit ${fields.deposit}. Email ${fields.email}, phone ${fields.phone}. Ref ${fields.referenceCode}.</p>`);

  const send = (to, subject, html, replyTo) =>
    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to, subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
    }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.text().catch(() => '') }));

  const results = {};
  if (d.email) results.customer = await send(d.email, 'Your NEBO UltraWash 0% Financing application', custHtml);
  if (NOTIFY) results.nebo = await send(
    NOTIFY,
    `New financing application — ${fields.firstName} ${fields.lastName} (${fields.referenceCode})`,
    leadHtml, d.email || undefined
  );

  const ok = (!d.email || results.customer?.ok) && (!NOTIFY || results.nebo?.ok);
  res.status(ok ? 200 : 502).json({ ok, results });
}
