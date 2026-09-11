// Recebe o aviso do Mercado Pago quando um pagamento muda de status.
// Em vez de confiar no conteúdo do aviso em si (que poderia ser forjado),
// busca o status oficial direto na API deles usando nosso Access Token —
// só libera a conta se a confirmação vier da fonte real.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true });
  }

  try {
    const orderId = req.body?.data?.id;
    if (!orderId) return res.status(200).json({ ok: true });

    const orderResponse = await fetch(`https://api.mercadopago.com/v1/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` }
    });
    if (!orderResponse.ok) {
      console.error('Could not fetch order', orderId);
      return res.status(200).json({ ok: true });
    }
    const order = await orderResponse.json();

    const approved =
      order?.status === 'processed' ||
      (order?.transactions?.payments || []).some(p => p.status === 'approved');
    if (!approved) return res.status(200).json({ ok: true });

    const match = (order.external_reference || '').match(/^(.+)-anual$/);
    if (!match) return res.status(200).json({ ok: true });
    const lawyerToken = match[1];

    const paidUntil = new Date();
    paidUntil.setFullYear(paidUntil.getFullYear() + 1);

    await fetch(`${process.env.SUPABASE_URL}/rest/v1/lawyers?token=eq.${encodeURIComponent(lawyerToken)}`, {
      method: 'PATCH',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        paid: true,
        paid_until: paidUntil.toISOString(),
        plan_type: 'anual',
        mp_payment_id: order.id
      })
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('webhook-mercadopago.js error:', err);
    // sempre 200 — devolver erro faria a Mercado Pago tentar de novo
    // indefinidamente pro mesmo evento
    return res.status(200).json({ ok: true });
  }
}
