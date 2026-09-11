export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Missing token' });

    const lawyerRows = await supabaseGet(`lawyers?token=eq.${encodeURIComponent(token)}&select=email`);
    if (!lawyerRows.length) return res.status(404).json({ error: 'Lawyer not found' });
    const lawyer = lawyerRows[0];

    const siteUrl = process.env.SITE_URL || `https://${req.headers.host}`;

    const response = await fetch('https://api.mercadopago.com/preapproval', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`
      },
      body: JSON.stringify({
        reason: 'DossiêDoc — Plano Mensal',
        external_reference: `${token}-mensal`,
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months',
          transaction_amount: 39.9,
          currency_id: 'BRL'
        },
        back_url: `${siteUrl}/conta.html?token=${encodeURIComponent(token)}`,
        status: 'pending'
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Mercado Pago preapproval error:', errText);
      return res.status(500).json({ error: 'Could not create subscription checkout', detail: errText });
    }

    const preapproval = await response.json();
    const checkoutUrl = preapproval.init_point;

    if (!checkoutUrl) {
      console.error('No init_point in preapproval response:', JSON.stringify(preapproval));
      return res.status(500).json({ error: 'No checkout URL returned' });
    }

    return res.status(200).json({ checkoutUrl });
  } catch (err) {
    console.error('create-checkout-mensal.js error:', err);
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
