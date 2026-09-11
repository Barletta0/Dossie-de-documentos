const PLANS = {
  mensal: { title: 'DossiêDoc — Plano Mensal', price: 39.9 },
  anual: { title: 'DossiêDoc — Plano Anual', price: 399.0 }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { token, plan } = req.body;
    if (!token) return res.status(400).json({ error: 'Missing token' });
    const planKey = PLANS[plan] ? plan : 'mensal';
    const planInfo = PLANS[planKey];

    const lawyerRows = await supabaseGet(`lawyers?token=eq.${encodeURIComponent(token)}&select=email`);
    if (!lawyerRows.length) return res.status(404).json({ error: 'Lawyer not found' });

    const siteUrl = process.env.SITE_URL || `https://${req.headers.host}`;
    const returnUrl = `${siteUrl}/conta.html?token=${encodeURIComponent(token)}`;

    const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`
      },
      body: JSON.stringify({
        items: [
          { title: planInfo.title, quantity: 1, currency_id: 'BRL', unit_price: planInfo.price }
        ],
        external_reference: `${token}-${planKey}`,
        back_urls: {
          success: returnUrl,
          pending: returnUrl,
          failure: returnUrl
        },
        auto_return: 'approved'
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Mercado Pago preference error:', errText);
      return res.status(500).json({ error: 'Could not create checkout', detail: errText });
    }

    const preference = await response.json();
    const checkoutUrl = preference.init_point;

    if (!checkoutUrl) {
      console.error('No init_point in preference response:', JSON.stringify(preference));
      return res.status(500).json({ error: 'No checkout URL returned' });
    }

    return res.status(200).json({ checkoutUrl });
  } catch (err) {
    console.error('create-checkout.js error:', err);
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
