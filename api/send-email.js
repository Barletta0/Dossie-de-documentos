export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { clientName, files, token } = req.body;

    if (!token) return res.status(401).json({ error: 'Invalid token' });
    const resolved = await resolveToken(token);
    if (!resolved) return res.status(401).json({ error: 'Invalid token' });

    const lawyer = await getLawyerByToken(resolved.lawyerToken);
    if (!lawyer) return res.status(401).json({ error: 'Invalid token' });

    if (!clientName || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'Missing clientName or files' });
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
      return res.status(response.status).json({ error: 'Email send error' });
    }

    if (resolved.clientLinkId) {
      await markClientLinkUsed(resolved.clientLinkId);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('send-email.js error:', err);
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
  const lawyerRows = await supabaseGet(`lawyers?token=eq.${encodeURIComponent(token)}&select=token`);
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
