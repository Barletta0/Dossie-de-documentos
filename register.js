import crypto from 'crypto';
import bcrypt from 'bcryptjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Missing name, email or password' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password too short' });
    }

    const token = crypto.randomBytes(9).toString('base64url');
    const passwordHash = await bcrypt.hash(password, 10);

    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/lawyers`, {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify({ name, email, token, password_hash: passwordHash })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Supabase insert error:', errText);
      if (errText.includes('duplicate') || errText.includes('unique')) {
        return res.status(409).json({ error: 'E-mail já cadastrado' });
      }
      return res.status(500).json({ error: 'Could not register' });
    }

    return res.status(200).json({ token });
  } catch (err) {
    console.error('register.js error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
