import { createHash } from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { clientName, files, token, meta } = req.body;

    if (!token) return res.status(401).json({ error: 'Invalid token' });
    const resolved = await resolveToken(token);
    if (!resolved) return res.status(401).json({ error: 'Invalid token' });

    const lawyer = await getLawyerByToken(resolved.lawyerToken);
    if (!lawyer) return res.status(401).json({ error: 'Invalid token' });

    if (!clientName || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'Missing clientName or files' });
    }

    // mesmo conteúdo já enviado há poucos minutos (duplo clique, reenvio da mesma lista)
    const fingerprint = makeFingerprint(files);
    if (await jaEnviadoRecentemente(resolved.lawyerToken, fingerprint)) {
      return res.status(409).json({ error: 'Duplicate send' });
    }

    const attachments = files.map(f => ({
      filename: f.filename,
      content: f.base64
    }));

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: process.env.FROM_EMAIL,
        to: lawyer.email,
        subject: `Documentos organizados — ${clientName}`,
        text: `Documentos de ${clientName} chegaram e já estão organizados por tipo, em anexo.`,
        attachments
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Resend API error:', errText);
      await logEvento(resolved.lawyerToken, 'envio', false, { ...{ ...safeMeta(meta, files), fingerprint }, status: response.status });
      return res.status(response.status).json({ error: 'Email send error' });
    }

    if (resolved.clientLinkId) {
      await markClientLinkUsed(resolved.clientLinkId);
    }

    await logEvento(resolved.lawyerToken, 'envio', true, { ...safeMeta(meta, files), fingerprint });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('send-email.js error:', err);
    await logEvento(null, 'envio', false, { interno: String(err && err.message || err).slice(0, 200) });
    return res.status(500).json({ error: 'Internal error' });
  }
}

async function getLawyerByToken(token) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/lawyers?token=eq.${encodeURIComponent(token)}&select=email`;
  const response = await fetch(url, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
    }
  });
  if (!response.ok) return null;
  const rows = await response.json();
  return rows.length ? rows[0] : null;
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

async function resolveToken(token) {
  // aceita o token de envio (link novo) ou, enquanto não for trocado, o link antigo
  const t = encodeURIComponent(token);
  let lawyerRows = await supabaseGet(`lawyers?send_token=eq.${t}&select=token`);
  if (!lawyerRows.length) lawyerRows = await supabaseGet(`lawyers?token=eq.${t}&legacy_link_enabled=eq.true&select=token`);
  if (lawyerRows.length) return { lawyerToken: lawyerRows[0].token, clientLinkId: null };

  const clientRows = await supabaseGet(`client_links?token=eq.${encodeURIComponent(token)}&used=eq.false&select=id,lawyer_token`);
  if (!clientRows.length) return null;
  return { lawyerToken: clientRows[0].lawyer_token, clientLinkId: clientRows[0].id };
}

async function markClientLinkUsed(clientLinkId) {
  try {
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/client_links?id=eq.${encodeURIComponent(clientLinkId)}`, {
      method: 'PATCH',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({ used: true })
    });
  } catch (err) {
    console.error('markClientLinkUsed error:', err);
  }
}


// Só números e nomes de tipo — nada do conteúdo dos documentos.
function makeFingerprint(files) {
  const raw = files.map(f => `${f.filename}:${(f.base64 || '').length}`).sort().join('|');
  return createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

async function jaEnviadoRecentemente(lawyerToken, fingerprint) {
  try {
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const url = `${process.env.SUPABASE_URL}/rest/v1/eventos?tipo=eq.envio&ok=eq.true&lawyer_token=eq.${encodeURIComponent(lawyerToken)}&created_at=gte.${since}&detalhe->>fingerprint=eq.${fingerprint}&select=id&limit=1`;
    const r = await fetch(url, { headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` } });
    if (!r.ok) return false;
    return (await r.json()).length > 0;
  } catch (e) {
    return false; // na dúvida, deixa enviar
  }
}

function safeMeta(meta, files) {
  const m = meta && typeof meta === 'object' ? meta : {};
  const n = v => (Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    arquivos_pdf: Array.isArray(files) ? files.length : null,
    documentos: n(m.documentos),
    outros: n(m.outros),
    falhas_classificacao: n(m.falhas_classificacao),
    sem_data: n(m.sem_data),
    tipos: Array.isArray(m.tipos) ? m.tipos.slice(0, 20).map(t => String(t).slice(0, 40)) : null
  };
}

async function logEvento(lawyerToken, tipo, ok, detalhe) {
  try {
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/eventos`, {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({ lawyer_token: lawyerToken, tipo, ok, detalhe })
    });
  } catch (e) {
    console.error('logEvento error:', e);
  }
}
