export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Missing token' });

    const resolved = await resolveToken(token);
    if (!resolved) return res.status(404).json({ error: 'Invalid token' });

    return res.status(200).json({ name: resolved.name, email: resolved.email, paid: resolved.paid });
  } catch (err) {
    console.error('lawyer-info.js error:', err);
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

// Aceita dois tipos de token no mesmo parâmetro:
// 1) o token fixo do advogado (link reutilizável, um por advogado)
// 2) um token de cliente de uso único (gerado em /gerar-link.html), que
//    fica marcado como "usado" depois do primeiro envio bem-sucedido
async function resolveToken(token) {
  const lawyerRows = await supabaseGet(`lawyers?token=eq.${encodeURIComponent(token)}&select=token,name,email,paid`);
  if (lawyerRows.length) {
    return { lawyerToken: lawyerRows[0].token, name: lawyerRows[0].name, email: lawyerRows[0].email, paid: !!lawyerRows[0].paid, clientLinkId: null };
  }

  const clientRows = await supabaseGet(`client_links?token=eq.${encodeURIComponent(token)}&used=eq.false&select=id,lawyer_token`);
  if (!clientRows.length) return null;

  const lawyerToken = clientRows[0].lawyer_token;
  const lawyerRows2 = await supabaseGet(`lawyers?token=eq.${encodeURIComponent(lawyerToken)}&select=name,email,paid`);
  if (!lawyerRows2.length) return null;

  return { lawyerToken, name: lawyerRows2[0].name, email: lawyerRows2[0].email, paid: !!lawyerRows2[0].paid, clientLinkId: clientRows[0].id };
}
