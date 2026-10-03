import crypto from 'crypto';

const TRIAL_LIMIT = parseInt(process.env.TRIAL_LIMIT || '3', 10);

// GET  ?token=...  → dados do advogado.
//   - token da CONTA (guardado no login): devolve tudo, inclusive o token do link do cliente.
//   - token de ENVIO (link do cliente): devolve só o que a tela de envio precisa (nome e e-mail).
// POST { token, action: 'rotate-link' } → só com o token da conta: gera um novo link de envio
//   e desativa o anterior (inclusive o link antigo que ainda era igual ao identificador interno).
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (req.method === 'POST') return await rotateLink(req, res);

    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Missing token' });

    const t = encodeURIComponent(token);
    const accountRows = await supabaseGet(`lawyers?account_token=eq.${t}&select=token,name,email,paid,paid_until,send_token`);
    if (accountRows.length) {
      const row = accountRows[0];
      const paid = isStillPaid(row);
      let trialExhausted = false;
      if (!paid) {
        const usageRows = await supabaseGet(`usage_events?token=eq.${encodeURIComponent(row.token)}&select=id`);
        trialExhausted = usageRows.length >= TRIAL_LIMIT;
      }
      return res.status(200).json({
        account: true,
        name: row.name,
        email: row.email,
        paid,
        paidUntil: row.paid_until,
        trialExhausted,
        sendToken: row.send_token
      });
    }

    const resolved = await resolveSendToken(token);
    if (!resolved) return res.status(404).json({ error: 'Invalid token' });
    return res.status(200).json({ account: false, name: resolved.name, email: resolved.email });
  } catch (err) {
    console.error('lawyer-info.js error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}

async function rotateLink(req, res) {
  const { token, action } = req.body || {};
  if (!token || action !== 'rotate-link') return res.status(400).json({ error: 'Bad request' });

  const rows = await supabaseGet(`lawyers?account_token=eq.${encodeURIComponent(token)}&select=token`);
  if (!rows.length) return res.status(401).json({ error: 'Invalid token' });

  const sendToken = crypto.randomBytes(24).toString('base64url');
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/lawyers?token=eq.${encodeURIComponent(rows[0].token)}`, {
    method: 'PATCH',
    headers: {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify({ send_token: sendToken, legacy_link_enabled: false })
  });
  if (!response.ok) {
    console.error('rotate-link error:', await response.text());
    return res.status(500).json({ error: 'Could not rotate link' });
  }
  return res.status(200).json({ sendToken });
}

async function supabaseGet(path) {
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
    }
  });
  if (!response.ok) return [];
  return response.json();
}

// Token de envio: o do link novo, o link antigo (enquanto não for trocado)
// ou um token de cliente de uso único.
async function resolveSendToken(token) {
  const t = encodeURIComponent(token);
  let rows = await supabaseGet(`lawyers?send_token=eq.${t}&select=name,email`);
  if (!rows.length) rows = await supabaseGet(`lawyers?token=eq.${t}&legacy_link_enabled=eq.true&select=name,email`);
  if (rows.length) return { name: rows[0].name, email: rows[0].email };

  const clientRows = await supabaseGet(`client_links?token=eq.${t}&used=eq.false&select=lawyer_token`);
  if (!clientRows.length) return null;
  const lawyerRows = await supabaseGet(`lawyers?token=eq.${encodeURIComponent(clientRows[0].lawyer_token)}&select=name,email`);
  if (!lawyerRows.length) return null;
  return { name: lawyerRows[0].name, email: lawyerRows[0].email };
}

function isStillPaid(row) {
  if (!row.paid) return false;
  if (!row.paid_until) return true;
  return new Date(row.paid_until).getTime() > Date.now();
}
