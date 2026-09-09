import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { name, email } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Missing name or email' });
    }

    const token = crypto.randomBytes(9).toString('base64url');

    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/lawyers`, {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify({ name, email, token })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Supabase insert error:', errText);
      return res.status(500).json({ error: 'Could not register' });
    }

    const siteUrl = process.env.SITE_URL || `https://${req.headers.host}`;
    const link = `${siteUrl}/?token=${token}`;

    return res.status(200).json({ token, link });
  } catch (err) {
    console.error('register.js error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
