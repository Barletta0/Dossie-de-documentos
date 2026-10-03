import crypto from 'crypto';
import bcrypt from 'bcryptjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Missing email or password' });
    }

    const url = `${process.env.SUPABASE_URL}/rest/v1/lawyers?email=eq.${encodeURIComponent(email)}&select=token,account_token,password_hash`;
    const response = await fetch(url, {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
      }
    });
    if (!response.ok) {
      const errText = await response.text();
      console.error('Supabase lookup error:', errText);
      return res.status(500).json({ error: 'Internal error' });
    }

    const rows = await response.json();
    if (!rows.length || !rows[0].password_hash) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, rows[0].password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // devolve o token da CONTA (guardado no navegador de quem fez login);
    // o token do link do cliente é outro e nunca abre a conta
    let accountToken = rows[0].account_token;
    if (!accountToken) {
      accountToken = crypto.randomBytes(24).toString('base64url');
      await fetch(`${process.env.SUPABASE_URL}/rest/v1/lawyers?token=eq.${encodeURIComponent(rows[0].token)}`, {
        method: 'PATCH',
        headers: {
          apikey: process.env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify({ account_token: accountToken })
      });
    }
    return res.status(200).json({ token: accountToken });
  } catch (err) {
    console.error('login.js error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
