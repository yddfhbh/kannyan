import fs from 'node:fs/promises';
import { parse } from 'dotenv';
import { createNativeSearchTools, nativeToolDeclarations, nativeToolGuidance, runGeminiNativeTools } from '../src/gemini-native-tools.js';
import { getPyhokWikiSearchConfig } from '../src/pyhok-wiki-search.js';
import { requestChatWithFallback } from '../src/gemini-chat-request.js';

const envPath = process.argv[2];
if (!envPath) throw new Error('Usage: node scripts/verify-native-tools-live.js /path/to/.env');
const env = parse(await fs.readFile(envPath));
const keys = [...new Set([...(env.GEMINI_API_KEYS || '').split(','), env.GEMINI_API_KEY, ...(env.GEMMA_API_KEYS || '').split(','), env.GEMMA_API_KEY].map(x => x?.trim()).filter(Boolean))];
if (!keys.length) throw new Error('No Gemini API key configured');
const models = [...new Set([env.GEMINI_MODEL, ...(env.GEMINI_FALLBACK_MODELS || '').split(','), 'gemini-2.5-flash'].map(x => x?.trim()).filter(Boolean))].slice(0, 3);
const wikiConfig = getPyhokWikiSearchConfig(env);
const allCases = [
  '안녕 깐냥아', '오늘 좀 피곤하다', '푝무위키에서 깐냥 찾아줘', '푝무위키 대문 내용 알려줘',
  '요즘 TETR.IO 업데이트 뭐 있어?', 'https://pyhok.com 이 사이트 설명해 줘',
  '푝무위키에서 깐냥 찾아보고 최신 정보도 확인해 줘',
];
const selected = process.argv[3]?.split(',').map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= allCases.length);
const cases = selected?.length ? selected.map(n => allCases[n - 1]) : allCases;
const tools = createNativeSearchTools({ wikiConfig });
if (process.argv.includes('--fail-web')) tools.web_search = async () => ({ status: 'blocked', results: [] });
let totalRequests = 0;
for (const prompt of cases) {
  const start = Date.now();
  const audit = [];
  const usage = [];
  let pinnedModel;
  try {
    const result = await runGeminiNativeTools({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      payload: { system_instruction: { parts: [{ text: ['너는 깐냥봇이다. 한국어로 친근하게 답한다. 검색 근거 URL을 인용한다.', ...nativeToolGuidance].join('\n') }] },
        tools: [{ functionDeclarations: nativeToolDeclarations }], toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
        generationConfig: { maxOutputTokens: 500, temperature: 0.4 } },
      tools, maxCalls: 3, deadlineMs: 35000, toolTimeoutMs: 6500,
      request: async (payload) => {
        if (totalRequests >= 24) throw new Error('API request budget exhausted');
        const prior = payload.contents.at(-1);
        const responses = (prior?.parts ?? []).filter(p => p.functionResponse).map(p => p.functionResponse);
        const modelCalls = payload.contents.at(-2)?.parts?.filter(p => p.functionCall).map(p => p.functionCall) ?? [];
        if (responses.length) audit.push({ responseCount: responses.length, idsPreserved: responses.every((r, i) => !modelCalls[i]?.id || r.id === modelCalls[i].id), signaturePreserved: Boolean(payload.contents.at(-2)?.parts?.some(p => p.thoughtSignature)) });
        totalRequests++;
        const response = await requestChatWithFallback(payload, {
          models: pinnedModel ? [pinnedModel] : models, keys, maxAttempts: 1,
          request: async (model, body, key) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 12000);
            try {
              const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal,
              });
              const json = await res.json();
              if (!res.ok) throw Object.assign(new Error(json.error?.status || 'API error'), { status: res.status });
              return json;
            } finally { clearTimeout(timer); }
          },
        });
        pinnedModel = response._requestMeta.model;
        usage.push(response.usageMetadata ?? {});
        audit.push({ functionCalls: response.candidates?.[0]?.content?.parts?.filter(p => p.functionCall).map(p => ({ name: p.functionCall.name, hasId: Boolean(p.functionCall.id), hasSignature: Boolean(p.thoughtSignature) })) ?? [] });
        return response;
      },
    });
    const answer = result.response?.candidates?.[0]?.content?.parts?.filter(p => p.text).map(p => p.text).join('') ?? '';
    console.log(JSON.stringify({ prompt, status: result.status, model: pinnedModel, requests: usage.length, durationMs: Date.now() - start,
      calls: result.calls, usage: usage.reduce((sum, u) => ({ input: sum.input + (u.promptTokenCount || 0), output: sum.output + (u.candidatesTokenCount || 0), thoughts: sum.thoughts + (u.thoughtsTokenCount || 0) }), { input: 0, output: 0, thoughts: 0 }),
      audit, answer: answer.slice(0, 1000) }));
  } catch (error) { console.log(JSON.stringify({ prompt, error: error.message, status: error.status, durationMs: Date.now() - start })); }
}
console.log(JSON.stringify({ totalRequests, wikiEnabled: wikiConfig.enabled }));
