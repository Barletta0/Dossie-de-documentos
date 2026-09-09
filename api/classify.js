const DAILY_LIMIT = parseInt(process.env.DAILY_LIMIT || '60', 10);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { base64, mediaType, docTypes, token } = req.body;

    if (!token || !(await isValidToken(token))) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    if (await countUsageToday(token) >= DAILY_LIMIT) {
      return res.status(429).json({ error: 'Daily limit reached' });
    }

    if (!base64 || !mediaType || !Array.isArray(docTypes)) {
      return res.status(400).json({ error: 'Missing base64, mediaType or docTypes' });
    }

    const typeList = docTypes.join(', ');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 50,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            {
              type: 'text',
              text: `Classifique este documento em UMA destas categorias exatas: ${typeList}. Responda APENAS com o nome exato da categoria, nada mais.`
            }
          ]
        }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', errText);
      return res.status(response.status).json({ error: 'Anthropic API error' });
    }

    const data = await response.json();
    const textBlock = (data.content || []).find(b => b.type === 'text');
    const raw = textBlock ? textBlock.text.trim() : '';

    await logUsage(token);

    return res.status(200).json({ raw });
  } catch (err) {
    console.error('classify.js error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}

async function isValidToken(token) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/lawyers?token=eq.${encodeURIComponent(token)}&select=id`;
  const response = await fetch(url, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
    }
  });
  if (!response.ok) return false;
  const rows = await response.json();
  return rows.length > 0;
}

async function countUsageToday(token) {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const url = `${process.env.SUPABASE_URL}/rest/v1/usage_events?token=eq.${encodeURIComponent(token)}&created_at=gte.${since.toISOString()}&select=id`;
  const response = await fetch(url, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
    }
  });
  if (!response.ok) return 0;
  const rows = await response.json();
  return rows.length;
}

async function logUsage(token) {
  try {
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/usage_events`, {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({ token })
    });
  } catch (err) {
    console.error('logUsage error:', err);
  }
}
