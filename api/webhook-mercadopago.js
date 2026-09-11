// Recebe o aviso do Mercado Pago quando um pagamento ou assinatura muda de
// status. Em vez de confiar no conteúdo do aviso em si (que poderia ser
// forjado), busca o status oficial direto na API deles usando nosso Access
// Token — só libera (ou bloqueia) a conta se a confirmação vier da fonte real.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true });
  }

  try {
    const body = req.body || {};
    const topic = body.type || body.topic;
    const dataId = body?.data?.id;
    if (!dataId) return res.status(200).json({ ok: true });

    if (topic === 'order') {
      await handleOrderEvent(dataId);
    } else if (topic === 'preapproval' || topic === 'subscription_preapproval') {
      await handlePreapprovalEvent(dataId);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('webhook-mercadopago.js error:', err);
    // sempre 200 — devolver erro faria a Mercado Pago tentar de novo
    // indefinidamente pro mesmo evento
    return res.status(200).json({ ok: true });
  }
}

// Plano anual — compra única (Orders API)
async function handleOrderEvent(orderId) {
  const orderResponse = await fetch(`https://api.mercadopago.com/v1/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` }
  });
  if (!orderResponse.ok) {
    console.error('Could not fetch order', orderId);
    return;
  }
  const order = await orderResponse.json();

  const approved =
    order?.status === 'processed' ||
    (order?.transactions?.payments || []).some(p => p.status === 'approved');
  if (!approved) return;

  const match = (order.external_reference || '').match(/^(.+)-anual$/);
  if (!match) return;

  const paidUntil = new Date();
  paidUntil.setFullYear(paidUntil.getFullYear() + 1);

  await updateLawyer(match[1], {
    paid: true,
    paid_until: paidUntil.toISOString(),
    plan_type: 'anual',
    mp_payment_id: order.id
  });
}

// Plano mensal — assinatura recorrente (Preapproval API)
async function handlePreapprovalEvent(preapprovalId) {
  const response = await fetch(`https://api.mercadopago.com/preapproval/${preapprovalId}`, {
    headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` }
  });
  if (!response.ok) {
    console.error('Could not fetch preapproval', preapprovalId);
    return;
  }
  const preapproval = await response.json();

  const match = (preapproval.external_reference || '').match(/^(.+)-mensal$/);
  if (!match) return;
  const lawyerToken = match[1];

  if (preapproval.status === 'authorized') {
    await updateLawyer(lawyerToken, {
      paid: true,
      paid_until: null, // recorrente — sem data fixa, vale enquanto a assinatura estiver ativa
      plan_type: 'mensal',
      mp_payment_id: preapproval.id
    });
  } else if (preapproval.status === 'cancelled' || preapproval.status === 'paused') {
    // assinatura cancelada ou pausada — bloqueia de volta
    await updateLawyer(lawyerToken, { paid: false });
  }
}

async function updateLawyer(token, fields) {
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/lawyers?token=eq.${encodeURIComponent(token)}`, {
    method: 'PATCH',
    headers: {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify(fields)
  });
}
