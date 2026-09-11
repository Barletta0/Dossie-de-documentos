const DAILY_LIMIT = parseInt(process.env.DAILY_LIMIT || '60', 10);
const TRIAL_LIMIT = parseInt(process.env.TRIAL_LIMIT || '3', 10);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { base64, mediaType, docTypes, token, isDocument } = req.body;

    const resolved = await resolveToken(token);
    if (!resolved) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    if (!resolved.paid && (await countUsageTotal(resolved.lawyerToken)) >= TRIAL_LIMIT) {
      return res.status(402).json({ error: 'Trial limit reached' });
    }

    if (await countUsageToday(resolved.lawyerToken) >= DAILY_LIMIT) {
      return res.status(429).json({ error: 'Daily limit reached' });
    }

    if (!base64 || !mediaType || !Array.isArray(docTypes)) {
      return res.status(400).json({ error: 'Missing base64, mediaType or docTypes' });
    }

    const typeList = docTypes.join(', ');
    const contentBlock = isDocument
      ? { type: 'document', source: { type: 'base64', media_type: mediaType, data: base64 } }
      : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } };

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 250,
        messages: [{
          role: 'user',
          content: [
            contentBlock,
            {
              type: 'text',
              text: `Analise este documento e responda APENAS com um JSON, sem nenhum texto antes ou depois, no formato exato: {"tipo": "<uma destas categorias: ${typeList}>", "competencia": "<data de competência ou emissão do documento no formato AAAA-MM-DD, ou null se não houver data identificável>", "pagina_atual": <número inteiro da página deste documento específico, extraído de marcações visíveis como "Página 1 de 2", "1/3", numeração de rodapé/cabeçalho, ou null se não houver nenhuma indicação de página visível>, "lado": "<se for um documento de identidade com frente e verso (RG, CNH, CIN), diga 'frente' (lado com foto e dados pessoais) ou 'verso' (lado com assinatura, impressão digital, ou informações complementares); para qualquer outro tipo de documento, use null>", "orientacao_atual": "<uma destas exatas: correta (o texto já está legível, de cabeça para cima), invertida (o documento está de ponta-cabeça, 180 graus), girada_horario (parece que a câmera foi girada no sentido horário ao tirar a foto, o texto está deitado com o topo apontando para a direita da imagem), girada_antihorario (parece que a câmera foi girada no sentido anti-horário, o texto está deitado com o topo apontando para a esquerda da imagem)>"}. Se o documento for um documento de identidade pessoal com foto (carteira de identidade tradicional, ou a nova Carteira de Identidade Nacional - CIN, ou qualquer RG estadual), classifique como "RG" mesmo que a palavra "RG" não apareça escrita no documento.`
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

    await logUsage(resolved.lawyerToken);

    return res.status(200).json({ raw });
  } catch (err) {
    console.error('classify.js error:', err);
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

async function resolveToken(token) {
  if (!token) return null;
  const lawyerRows = await supabaseGet(`lawyers?token=eq.${encodeURIComponent(token)}&select=token,paid`);
  if (lawyerRows.length) return { lawyerToken: lawyerRows[0].token, paid: !!lawyerRows[0].paid, clientLinkId: null };

  const clientRows = await supabaseGet(`client_links?token=eq.${encodeURIComponent(token)}&used=eq.false&select=id,lawyer_token`);
  if (!clientRows.length) return null;

  const parentLawyer = await supabaseGet(`lawyers?token=eq.${encodeURIComponent(clientRows[0].lawyer_token)}&select=paid`);
  const paid = parentLawyer.length ? !!parentLawyer[0].paid : false;

  return { lawyerToken: clientRows[0].lawyer_token, paid, clientLinkId: clientRows[0].id };
}

async function countUsageTotal(token) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/usage_events?token=eq.${encodeURIComponent(token)}&select=id`;
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
