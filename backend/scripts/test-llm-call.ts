/**
 * 快速测试 .env 中配置的 LLM 模型是否可用
 * 运行: npx tsx backend/scripts/test-llm-call.ts
 */
import 'dotenv/config';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/+$/, '');
const MODEL = process.env.AI_DEFAULT_MODEL || 'gpt-4o';

interface Endpoint {
  name: string;
  url: string;
  body: Record<string, unknown>;
  parse: (data: any) => { model: string; status: string; text: string; usage: string | null };
}

const endpoints: Endpoint[] = [
  {
    name: 'Responses API (/v1/responses)',
    url: `${OPENAI_BASE_URL}/v1/responses`,
    body: {
      model: MODEL,
      instructions: 'You are a helpful assistant. Reply in one short sentence.',
      input: 'Say hello and tell me what model you are.',
      max_output_tokens: 200,
      temperature: 0.7,
    },
    parse: (data) => ({
      model: data.model,
      status: data.status,
      text: data.output_text || data.output?.map((o: any) => o.content?.map((c: any) => c.text).join('')).join('') || '(empty)',
      usage: data.usage ? `input=${data.usage.input_tokens} output=${data.usage.output_tokens} total=${data.usage.total_tokens}` : null,
    }),
  },
  {
    name: 'Chat Completions API (/v1/chat/completions)',
    url: `${OPENAI_BASE_URL}/v1/chat/completions`,
    body: {
      model: MODEL,
      messages: [
        { role: 'system', content: 'You are a helpful assistant. Reply in one short sentence.' },
        { role: 'user', content: 'Say hello and tell me what model you are.' },
      ],
      max_completion_tokens: 200,
      temperature: 0.7,
    },
    parse: (data) => ({
      model: data.model,
      status: data.choices?.[0]?.finish_reason,
      text: data.choices?.[0]?.message?.content ?? '(empty)',
      usage: data.usage ? `input=${data.usage.prompt_tokens} output=${data.usage.completion_tokens} total=${data.usage.total_tokens}` : null,
    }),
  },
];

async function main() {
  console.log('=== LLM 调用测试 ===');
  console.log(`Base URL: ${OPENAI_BASE_URL}`);
  console.log(`Model:    ${MODEL}`);
  console.log('');

  for (const ep of endpoints) {
    console.log(`--- ${ep.name} ---`);
    const t0 = Date.now();
    try {
      const res = await fetch(ep.url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(ep.body),
      });
      const ms = Date.now() - t0;
      if (!res.ok) {
        console.log(`❌ HTTP ${res.status} (${ms}ms): ${(await res.text()).slice(0, 200)}\n`);
        continue;
      }
      const r = ep.parse(await res.json());
      console.log(`✅ 成功 (${ms}ms)`);
      console.log(`   Model:    ${r.model}`);
      console.log(`   Status:   ${r.status}`);
      console.log(`   Response: ${r.text}`);
      if (r.usage) console.log(`   Tokens:   ${r.usage}`);
      return;
    } catch (e: any) {
      console.log(`❌ 网络错误 (${Date.now() - t0}ms): ${e.message}\n`);
    }
  }
  console.error('所有端点均失败');
  process.exit(1);
}

main();
