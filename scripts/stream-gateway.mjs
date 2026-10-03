// Gera texto em streaming pelo Vercel AI Gateway.
// Uso: AI_GATEWAY_API_KEY=... node scripts/stream-gateway.mjs ["seu prompt"]
// O modelo pode ser trocado com AI_GATEWAY_MODEL (padrão: openai/gpt-6-astra).
import { streamText } from 'ai';

if (!process.env.AI_GATEWAY_API_KEY) {
  console.error('Defina AI_GATEWAY_API_KEY no ambiente (nunca no código).');
  process.exit(1);
}

const model = process.env.AI_GATEWAY_MODEL || 'openai/gpt-6-astra';
const prompt =
  process.argv.slice(2).join(' ') ||
  'Explique em um parágrafo curto o que o DossiêDoc faz por advogados.';

try {
  const result = streamText({ model, prompt });

  for await (const chunk of result.textStream) {
    process.stdout.write(chunk);
  }
  process.stdout.write('\n');

  const usage = await result.usage;
  console.error(`\n[modelo: ${model} | tokens: ${usage?.totalTokens ?? 'n/d'}]`);
} catch (err) {
  const status = err?.statusCode ?? err?.status;
  const hints = {
    401: 'Chave inválida ou revogada.',
    402: 'Sem créditos no AI Gateway, ou orçamento da chave esgotado.',
    403: 'Acesso negado (o gateway pode exigir um método de pagamento válido).',
    429: 'Limite de requisições atingido; tente de novo em instantes.',
    503: 'Provedor indisponível no momento; tente de novo.',
  };
  console.error(`Falha na requisição${status ? ` (${status})` : ''}: ${hints[status] ?? err?.message ?? err}`);
  process.exit(1);
}
