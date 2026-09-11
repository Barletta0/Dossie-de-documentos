import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Missing email' });

    const rows = await supabaseGet(`lawyers?email=eq.${encodeURIComponent(email)}&select=token`);

    // sempre responde sucesso, mesmo se o e-mail não existir — evita que
    // alguém descubra quais e-mails estão cadastrados testando um por um
    if (!rows.length) {
      return res.status(200).json({ success: true });
    }

    const lawyerToken = rows[0].token;
    const resetToken = crypto.randomBytes(24).toString('base64url');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // válido por 1 hora

    await fetch(`${process.env.SUPABASE_URL}/rest/v1/lawyers?token=eq.${encodeURIComponent(lawyerToken)}`, {
      method: 'PATCH',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        reset_token: resetToken,
        reset_token_expires: expires.toISOString()
      })
    });

    const siteUrl = process.env.SITE_URL || `https://${req.headers.host}`;
    const resetUrl = `${siteUrl}/redefinir-senha.html?token=${resetToken}`;

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: process.env.FROM_EMAIL,
        to: email,
        subject: 'Redefinir sua senha — DossiêDoc',
        text: `Recebemos um pedido pra redefinir sua senha. Clique no link abaixo pra criar uma senha nova (válido por 1 hora):\n\n${resetUrl}\n\nSe você não pediu isso, pode ignorar este e-mail — sua senha continua a mesma.`
      })
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('request-password-reset.js error:', err);
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
