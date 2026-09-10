// Roda diariamente (configurado em vercel.json) e apaga do Storage qualquer
// arquivo com mais de 7 dias — o link assinado que o advogado recebe já
// expira em 3 dias, então nada de legítimo precisa sobreviver além disso.
// Dado sensível de cliente não deve ficar guardado sem prazo definido.

export default async function handler(req, res) {
  // protege contra qualquer um disparar essa rota manualmente —
  // só aceita a chamada automática do Vercel Cron, que envia esse header
  const authHeader = req.headers['authorization'];
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const MAX_AGE_DAYS = 7;
    const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

    // lista tudo dentro do bucket (a estrutura é lawyer_token/arquivo.pdf,
    // então lista as "pastas" de cada advogado primeiro)
    const foldersResponse = await fetch(
      `${process.env.SUPABASE_URL}/storage/v1/object/list/documents`,
      {
        method: 'POST',
        headers: {
          apikey: process.env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ prefix: '', limit: 1000 })
      }
    );

    if (!foldersResponse.ok) {
      const errText = await foldersResponse.text();
      console.error('List folders error:', errText);
      return res.status(500).json({ error: 'Could not list storage' });
    }

    const folders = await foldersResponse.json();
    let deletedCount = 0;
    let checkedCount = 0;

    for (const folder of folders) {
      // cada "folder" aqui é o token do advogado; lista os arquivos dentro dele
      const filesResponse = await fetch(
        `${process.env.SUPABASE_URL}/storage/v1/object/list/documents`,
        {
          method: 'POST',
          headers: {
            apikey: process.env.SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ prefix: `${folder.name}/`, limit: 1000 })
        }
      );

      if (!filesResponse.ok) continue;
      const files = await filesResponse.json();

      for (const file of files) {
        checkedCount++;
        const createdAt = new Date(file.created_at).getTime();
        if (createdAt < cutoff) {
          const path = `${folder.name}/${file.name}`;
          const deleteResponse = await fetch(
            `${process.env.SUPABASE_URL}/storage/v1/object/documents`,
            {
              method: 'DELETE',
              headers: {
                apikey: process.env.SUPABASE_SERVICE_KEY,
                Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ prefixes: [path] })
            }
          );
          if (deleteResponse.ok) deletedCount++;
        }
      }
    }

    return res.status(200).json({ checked: checkedCount, deleted: deletedCount });
  } catch (err) {
    console.error('cleanup-storage.js error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
