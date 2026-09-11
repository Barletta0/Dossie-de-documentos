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

    const links = [];
    for (const file of files) {
      const path = `${resolved.lawyerToken}/${Date.now()}_${sanitizeFilename(file.filename)}`;
      const bytes = Buffer.from(file.base64, 'base64');

      const uploadResponse = await fetch(
        `${process.env.SUPABASE_URL}/storage/v1/object/documents/${path}`,
        {
          method: 'POST',
          headers: {
            apikey: process.env.SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/pdf'
          },
          body: bytes
        }
      );

      if (!uploadResponse.ok) {
        const errText = await uploadResponse.text();
        console.error('Storage upload error:', errText);
        continue;
      }

      const signResponse = await fetch(
        `${process.env.SUPABASE_URL}/storage/v1/object/sign/documents/${path}`,
        {
          method: 'POST',
          headers: {
            apikey: process.env.SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ expiresIn: 259200 }) // 3 dias
        }
      );

      if (!signResponse.ok) {
        const errText = await signResponse.text();
        console.error('Storage sign error:', errText);
        continue;
      }

      const signData = await signResponse.json();
      links.push({ filename: file.filename, url: `${process.env.SUPABASE_URL}/storage/v1${signData.signedURL}` });
    }

    if (links.length === 0) {
      return res.status(500).json({ error: 'Could not upload any file' });
    }

    const linksText = links.map(l => `${l.filename}: ${l.url}`).join('\n');
    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: process.env.FROM_EMAIL,
        to: lawyer.email,
        subject: `Documentos organizados — ${clientName} (arquivo grande, veja o link)`,
        text: `Os documentos de ${clientName} chegaram, mas o arquivo total era grande demais pra anexar direto no e-mail. Baixe pelos links abaixo (válidos por 3 dias):\n\n${linksText}`
      })
    });

    if (!emailResponse.ok) {
      const errText = await emailResponse.text();
      console.error('Resend API error:', errText);
      return res.status(500).json({ error: 'Could not send notification email' });
    }

    if (resolved.clientLinkId) {
      await markClientLinkUsed(resolved.clientLinkId);
    }

    return res.status(200).json({ success: true, count: links.length });
  } catch (err) {
    console.error('upload-large.js error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}

function sanitizeFilename(name) {
  return (name || 'documento.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
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

async function getLawyerByToken(token) {
  const rows = await supabaseGet(`lawyers?token=eq.${encodeURIComponent(token)}&select=email`);
  return rows.length ? rows[0] : null;
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
