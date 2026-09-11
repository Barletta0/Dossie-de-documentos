import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Missing token' });

    const lawyerRows = await supabaseGet(`lawyers?token=eq.${encodeURIComponent(token)}&select=email,name`);
    if (!lawyerRows.length) return res.status(404).json({ error: 'Lawyer not found' });
    const lawyer = lawyerRows[0];

    const idempotencyKey = crypto.randomUUID();
    const externalReference = `${token}-anual`;

    const response = await fetch('https://api.mercadopago.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        'X-Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify({
        type: 'online',
        processing_mode: 'manual',
        total_amount: '399.00',
        external_reference: externalReference,
        items: [
          { title: 'DossiêDoc — Plano Anual', unit_price: '399.00', quantity: 1 }
        ],
        payer: { email: lawyer.email }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Mercado Pago create order error:', errText);
      return res.status(500).json({ error: 'Could not create checkout' });
    }

    const order = await response.json();
    const checkoutUrl = order?.checkout_pro?.init_point;

    if (!checkoutUrl) {
      console.error('No init_point in order response:', JSON.stringify(order));
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
