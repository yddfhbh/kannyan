import test from 'node:test';
import assert from 'node:assert/strict';
import { formatChatDisplayAnswer } from '../src/chat-display.js';
import { validateChatCitationsWithStatus } from '../src/chat-evidence.js';
import { runtime } from '../scripts/lib/chat-verification-runtime.js';

const message = question => ({content:`%${question}`,author:{id:'test',username:'test'},guildId:'g',channelId:'c',client:{user:{username:'깐냥'}},attachments:new Map(),channel:{send:async()=>{}}});
test('chat display removes Markdown, bare, automatic and reference links while retaining claims', () => {
  for (const link of ['[기상청](https://www.weather.go.kr/w/forecast/notice.do?stnId=159)', '<https://source.test/a>', 'https://source.test/a', '[1](https://source.test/a)', '[ETS](https://source.test/a_(b))', 'www.source.test/a', '[ETS][official]\n[official]: https://source.test/a']) {
    const displayed = formatChatDisplayAnswer(`부산 예보는 흐림이다냥.\n${link}\n출처: https://source.test/a`);
    assert.match(displayed,/부산 예보는 흐림/);
    assert.doesNotMatch(displayed,/https?:|www\.|source\.test|weather\.go\.kr|\]\(/);
  }
});
test('fabricated citations are rejected before display; automatic manifest remains internal', () => {
  const evidence = '[1] 제목: ETS 안내\nURL: https://www.ets.org/fees\n확인한 본문: ETS 등록비는 장소별 안내다.';
  const invalid = validateChatCitationsWithStatus('응시료는 999원이다. https://fake.test', evidence);
  assert.equal(invalid.valid,false);
  assert.match(formatChatDisplayAnswer(invalid.answer),/확인하지 못/);
  const valid = validateChatCitationsWithStatus('ETS 등록비는 장소별 안내다.', evidence);
  assert.equal(valid.valid,true);
  assert.equal(valid.reason,'supported-manifest-attached');
  assert.match(valid.answer,/https:/);
  assert.doesNotMatch(formatChatDisplayAnswer(valid.answer),/https:/);
  assert.match(evidence,/https:/);
});
test('fact and partial delivery retain the verified internal answer without sending URLs', async () => {
  for (const source of ['chat-news','chat-wiki-age','chat-no-evidence','chat-web-age']) {
    const r=runtime();
    const answer='ETS 공식 안내 기준 시험 장소를 선택해야 한다냥. 금액은 확인하지 못했다냥.\nhttps://www.ets.org/fees';
    await r.context.sendChatFactReply(message('질문'),'질문',answer,new Date(),source);
    assert.doesNotMatch(r.sent[0],/https:/);
    assert.match(r.sent[0],/금액은 확인하지 못/);
    assert.equal(r.stored[1].text,answer);
  }
});
test('ordinary generated chat delivery strips links after the answer is produced', async () => {
  const r=runtime({localAnswer:'확인한 설명 [자료](https://source.test)이다냥.'});
  await r.context.handleGeminiFallbackMessage(message('안녕'));
  assert.match(r.sent[0],/확인한 설명 자료/);
  assert.doesNotMatch(r.sent[0],/https:/);
  assert.match(r.stored[1].text,/https:/);
});

test('captured KMA mixed evidence reaches delivery with issue time distinct from target day', async () => {
  const fs=await import('node:fs');
  const {extractKmaDailyForecast}=await import('../src/evidence-review.js');
  const log=JSON.parse(fs.readFileSync(new URL('./fixtures/chat-common-recheck-20261017.json',import.meta.url))).mixed;
  const read=log.reads[0];
  const source={url:read.fetchedUrl,title:read.extractedTitle,discoveredTitle:read.searchTitle,pageText:read.extractedBody,metadataText:read.extractedMetadata,evidenceKind:'body'};
  const review=extractKmaDailyForecast(log.question,source,log.now);
  assert.ok(review);
  const data={status:'success',results:[{...source,bodyReview:{...review,relevant:true,requestSatisfied:true}}],context:source.pageText};
  const r=runtime({search:data,localAnswer:'나는 CODEX가 만든 챗봇 깐냥이다냥.',plan:{mode:'search',query:'부산 날씨',purpose:'오늘 예보',externalPrompt:'오늘 부산 날씨',localPrompt:'너 누구야?'}});
  await r.context.handleGeminiFallbackMessage(message(log.question),{now:new Date(log.now)});
  assert.match(r.sent[0],/CODEX.*깐냥/);
  assert.match(r.sent[0],/17일[^]*가끔 구름많다가 밤부터 흐려짐/);
  assert.match(r.sent[0],/발표/);
  assert.doesNotMatch(r.sent[0],/https?:|18일|10~50mm/);
  assert.match(r.stored.at(-1).text,/https:/);
  assert.equal(data.results[0].pageText,source.pageText);
});

test('ETS scoped partial delivery never invents an amount and preserves the internal quote and URL', async () => {
  const quote='등록비를 확인하려면 시험 장소를 선택하세요.';
  const url='https://www.kr.ets.org/toefl/test-takers/ibt/register/fees.html';
  const search={status:'sourced-partial',results:[],bodyVerification:{scopeEvidence:[{scope:'location-dependent-registration-fee',quote,url}],originalQuestion:'토플 응시료가 얼마야?'}};
  const r=runtime({search,localAnswer:'',plan:{mode:'search',query:'토플 응시료',purpose:'요금 확인',externalPrompt:'토플 응시료가 얼마야?'}});
  await r.context.handleGeminiFallbackMessage(message('토플 응시료가 얼마야?'));
  assert.match(r.sent[0],/ETS 공식 안내/);
  assert.match(r.sent[0],/기본 응시료 금액은 확인하지 못/);
  assert.match(r.sent[0],/국가·지역/);
  assert.doesNotMatch(r.sent[0],/https?:|\d+\s*(?:원|달러|USD|KRW)/);
  assert.ok(r.stored.at(-1).text.includes(url));
  assert.ok(r.stored.at(-1).text.includes(quote));
});
