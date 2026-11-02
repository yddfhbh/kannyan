import fs from 'node:fs/promises';
import { parse } from 'dotenv';
import { searchWeb } from '../src/web-search.js';
import { searchPyhokWiki, getPyhokWikiSearchConfig } from '../src/pyhok-wiki-search.js';
import { fetchWebPageText } from '../src/web-page-content.js';

const path = process.argv[2];
if (!path) throw new Error('Usage: node scripts/verify-native-search-live.js /path/to/.env');
const env = parse(await fs.readFile(path));
for (const provider of ['duckduckgo', 'naver']) {
  try {
    const result = await searchWeb('TETR.IO patch notes', { providerOrder: [provider], queryVariants: ['TETR.IO patch notes'], timeoutMs: 6500, maxResults: 3 });
    console.log(JSON.stringify({ provider, status: result.status, attempts: result.attempts.map(a => ({ httpStatus: a.httpStatus, status: a.status })), count: result.results.length, firstUrl: result.results[0]?.url }));
    if (result.results[0]) {
      try {
        const page = await fetchWebPageText(result.results[0].url, { totalTimeoutMs: 6500, timeoutMs: 5500 });
        console.log(JSON.stringify({ provider, read: 'success', url: page.url, bodyLength: page.text?.length, bodyQuality: page.bodyQuality }));
      } catch (error) { console.log(JSON.stringify({ provider, read: 'failed', httpStatus: error.status ?? null, error: error.code || error.name })); }
    }
  } catch (error) { console.log(JSON.stringify({ provider, error: error.code || error.name })); }
}
const config = getPyhokWikiSearchConfig(env);
for (const query of ['깐냥', '푝무위키 대문']) {
  try {
    const result = await searchPyhokWiki(query, { ...config, maxResults: 3, timeoutMs: 5000, logger: { log() {}, warn() {} } });
    console.log(JSON.stringify({ wikiQuery: query, status: result.status, httpStatus: result.httpStatus, count: result.results.length, titles: result.results.map(r => r.documentTitle), bodyLengths: result.results.map(r => r.primaryContent?.length ?? 0) }));
  } catch (error) { console.log(JSON.stringify({ wikiQuery: query, httpStatus: error.status ?? null, error: error.code || error.name })); }
}
for (const url of ['https://pyhok.com', 'https://pyhok.com/w/%ED%91%9D%EB%AC%B4%EC%9C%84%ED%82%A4:%EB%8C%80%EB%AC%B8']) {
  try { const page = await fetchWebPageText(url, { totalTimeoutMs: 6500, timeoutMs: 5500 }); console.log(JSON.stringify({ page: url, status: 'success', bodyLength: page.text?.length, bodyQuality: page.bodyQuality })); }
  catch (error) { console.log(JSON.stringify({ page: url, status: 'failed', httpStatus: error.status ?? null, error: error.code || error.name })); }
}
