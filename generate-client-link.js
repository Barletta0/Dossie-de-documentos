import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { lawyerToken, clientName } = req.body;

    if (!lawyerToken) {
      return res.status(400).json({ error: 'Missing lawyerToken' });
    }

    const lawyerRows = await supabaseGet(`lawyers?token=eq.${encodeURIComponent(lawyerToken)}&select=token`);
    if (!lawyerRows.length) {
      return res.status(401).json({ error: 'Invalid lawyer token' });
    }

    const clientToken = crypto.randomBytes(9).toString('base64url');

    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/client_links`, {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify({
        lawyer_token: lawyerToken,
        token: clientToken,
        client_name: clientName || null
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Supabase insert error:', errText);
      return res.status(500).json({ error: 'Could not generate link' });
    }

    const siteUrl = process.env.SITE_URL || `https://${req.headers.host}`;
    const link = `${siteUrl}/?token=${clientToken}`;

    return res.status(200).json({ link });
  } catch (err) {
    console.error('generate-client-link.js error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
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
