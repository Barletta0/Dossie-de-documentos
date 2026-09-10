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

    const url = `${process.env.SUPABASE_URL}/rest/v1/lawyers?email=eq.${encodeURIComponent(email)}&select=token,password_hash`;
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

    return res.status(200).json({ token: rows[0].token });
  } catch (err) {
    console.error('login.js error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
