export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Missing token' });

    const url = `${process.env.SUPABASE_URL}/rest/v1/lawyers?token=eq.${encodeURIComponent(token)}&select=name`;
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
    if (!rows.length) return res.status(404).json({ error: 'Invalid token' });

    return res.status(200).json({ name: rows[0].name });
  } catch (err) {
    console.error('lawyer-info.js error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
