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

    // o token que chega aqui é o da CONTA (guardado no login), nunca o do link do cliente
    const lawyerRows = await supabaseGet(`lawyers?account_token=eq.${encodeURIComponent(token)}&select=token,email`);
    if (!lawyerRows.length) return res.status(404).json({ error: 'Lawyer not found' });
    const lawyerId = lawyerRows[0].token; // identificador interno usado no external_reference

    const siteUrl = process.env.SITE_URL || `https://${req.headers.host}`;
    const returnUrl = `${siteUrl}/conta.html`; // a conta abre pelo login salvo, sem token na URL

    const tokenPrefix = (process.env.MP_ACCESS_TOKEN || 'MISSING').substring(0, 12);
    console.log('MP_ACCESS_TOKEN prefix in use:', tokenPrefix);

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
        external_reference: `${lawyerId}-${planKey}`,
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
      return res.status(500).json({ error: 'Could not create checkout' });
    }

    const preference = await response.json();
    const checkoutUrl = preference.init_point;

    if (!checkoutUrl) {
      console.error('No init_point in preference response:', JSON.stringify(preference));
      return res.status(500).json({ error: 'No checkout URL returned' });
    }

    return res.status(200).json({ checkoutUrl, preferenceId: preference.id });
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
