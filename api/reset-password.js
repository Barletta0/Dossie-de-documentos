import bcrypt from 'bcryptjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Missing token or password' });
    if (password.length < 6) return res.status(400).json({ error: 'Password too short' });

    const rows = await supabaseGet(`lawyers?reset_token=eq.${encodeURIComponent(token)}&select=token,reset_token_expires`);
    if (!rows.length) {
      return res.status(400).json({ error: 'Link inválido ou já usado' });
    }

    const row = rows[0];
    if (!row.reset_token_expires || new Date(row.reset_token_expires).getTime() < Date.now()) {
      return res.status(400).json({ error: 'Esse link expirou. Pede um novo.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await fetch(`${process.env.SUPABASE_URL}/rest/v1/lawyers?token=eq.${encodeURIComponent(row.token)}`, {
      method: 'PATCH',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        password_hash: passwordHash,
        reset_token: null,
        reset_token_expires: null
      })
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('reset-password.js error:', err);
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
