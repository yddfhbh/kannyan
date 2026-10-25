import test from 'node:test';
import assert from 'node:assert/strict';
import { assessRequiredAnswerItems, buildEvidenceExtractionInput, buildEvidenceExtractionPrompt, createGeminiEvidenceExtractor, parseEvidenceExtractionResponse, parseGeminiEvidenceResponse, validateExtractedEvidenceFact } from '../src/general-search-llm-extraction.js';

test('quote 복원은 한국어와 이모지의 JavaScript UTF-16 위치를 사용한다', () => {
  const source = { url: 'https://source.test/ko', pageText: '고양이 🐈‍⬛ 서울의 기온은 20도이다.' };
  const quote = '서울의 기온은 20도이다.';
  const result = parseEvidenceExtractionResponse(JSON.stringify({ facts: [{ subject: '서울', relation: '기온', value: '20도', unit: '도', sourceUrl: source.url, quote, sourceSpan: { start: 0, end: 1 }, appliesAt: null }] }), [source]);
  const fact = result.facts[0];
  assert.equal(fact.status, 'verified');
  assert.equal(fact.sourceSpan.start, source.pageText.indexOf(quote));
  assert.equal(source.pageText.slice(fact.sourceSpan.start, fact.sourceSpan.end), quote);
});

test('중간 quote는 모델 span과 무관하게 전체 문서에서 복원한다', () => {
  const source = { url: 'https://source.test/middle', pageText: '앞 문장. 중간에 있는 정확한 인용문이다. 뒤 문장.' };
  const fact = validateExtractedEvidenceFact({ subject: '인용문', relation: '설명', value: '정확한 인용문', unit: '', sourceUrl: source.url, quote: '중간에 있는 정확한 인용문이다.', sourceSpan: { start: 1, end: 2 }, appliesAt: null }, [source]);
  assert.equal(fact.status, 'verified');
  assert.equal(fact.sourceSpan.start, source.pageText.indexOf(fact.quote));
  assert.equal(fact.sourceSpanOrigin, 'quote-search');
});

test('반복 quote는 chunk 힌트 없이는 보류하고 chunk가 구분하면 복원한다', () => {
  const source = { url: 'https://source.test/repeat', pageText: '반복 문장이다. 첫 문단. 반복 문장이다. 둘째 문단.' };
  const quote = '반복 문장이다.';
  const ambiguous = validateExtractedEvidenceFact({ subject: '문장', relation: '내용', value: quote, unit: '', sourceUrl: source.url, quote, appliesAt: null }, [source]);
  assert.equal(ambiguous.status, 'rejected');
  assert.ok(ambiguous.validationFailures.includes('quote-ambiguous-in-source'));
  const selected = validateExtractedEvidenceFact({ subject: '문장', relation: '내용', value: quote, unit: '', sourceUrl: source.url, quote, sourceChunkId: 'source-1-segment-3', appliesAt: null }, [source]);
  assert.equal(selected.status, 'verified');
  assert.equal(selected.quoteOccurrenceCount, 2);
});

test('없는 quote, 잘못된 URL, 날짜, 값 지지는 거부 또는 의미 검토 대상으로 남긴다', () => {
  const source = { url: 'https://source.test/value', pageText: '현재 값은 42이다.' };
  const missing = validateExtractedEvidenceFact({ subject: '값', relation: '설명', value: '99', unit: '', sourceUrl: source.url, quote: '원문에 없음', appliesAt: null }, [source]);
  assert.ok(missing.validationFailures.includes('quote-not-in-source'));
  const badUrl = validateExtractedEvidenceFact({ subject: '값', relation: '설명', value: '42', unit: '', sourceUrl: 'https://wrong.test', quote: '현재 값은 42이다.', appliesAt: null }, [source]);
  assert.ok(badUrl.validationFailures.includes('source-url-not-supplied'));
  const badDate = validateExtractedEvidenceFact({ subject: '값', relation: '설명', value: '42', unit: '', sourceUrl: source.url, quote: '현재 값은 42이다.', appliesAt: '2026-10', }, [source]);
  assert.ok(badDate.validationFailures.includes('invalid-applies-at'));
  const badValue = validateExtractedEvidenceFact({ subject: '값', relation: '설명', value: '99', unit: '', sourceUrl: source.url, quote: '현재 값은 42이다.', appliesAt: null }, [source]);
  assert.equal(badValue.status, 'verified');
  assert.equal(badValue.semanticSupport, false);
});

test('AWS 무료 요청 quote는 위치 검증 후에도 무료 tier 근거로 보존한다', () => {
  const source = { url: 'https://aws.amazon.com/ko/lambda/pricing/', pageText: 'AWS Lambda 프리 티어에는 월 100만 건의 무료 요청이 포함되어 있다.' };
  const parsed = parseEvidenceExtractionResponse(JSON.stringify({ facts: [{ subject: 'AWS Lambda 프리 티어', relation: '포함 내역', value: '월 100만 건의 무료 요청', unit: '건', sourceUrl: source.url, quote: source.pageText, appliesAt: null }] }), [source]);
  assert.equal(parsed.verified.length, 1);
  const requirements = assessRequiredAnswerItems('AWS Lambda 요청 요금', parsed.verified);
  assert.ok(requirements.satisfied.includes('free-tier'));
  assert.ok(requirements.missing.includes('request-price'));
});

test('usage request includes bounded official segments and prompts for calls and argument relationships', () => {
  const quote = 'client.run(store, callback) runs callback within the supplied store.';
  const example = 'const result = client.run(store, () => work());';
  const argument = 'The store argument supplies the context for the callback.';
  const callback = 'The callback receives additional arguments after store.';
  const segments = [quote, example, argument, callback];
  const body = `${'Background details. '.repeat(240)}\n${segments.join('\n')}`;
  const page = { sourceId: 'source-1', url: 'https://docs.example.org/api/client', pageText: body,
    relevantSegments: segments.map((text, index) => ({ id: `segment-${index + 1}`, text,
      start: body.indexOf(text), end: body.indexOf(text) + text.length })) };
  const input = buildEvidenceExtractionInput('client.run 사용법', [page]);
  assert.equal(input.sources.length, 1);
  assert.equal(input.sources[0].segments.length, 4);
  assert.deepEqual(input.sources[0].segments.map((segment) => segment.text), segments);
  assert.ok(input.sources[0].body.length > 4800);
  const prompt = buildEvidenceExtractionPrompt(input.question, [page]);
  assert.ok(prompt.includes(quote));
  assert.ok(prompt.includes(example));
  assert.ok(prompt.includes('what each documented argument supplies'));
  assert.ok(!prompt.includes('Background details.'));
});

test('Gemini response diagnostics distinguish empty extraction, missing text, and rejected claims', () => {
  const quote = 'client.run(store, callback) runs callback within the supplied store.';
  const page = { sourceId: 'source-1', url: 'https://docs.example.org/api/client', pageText: quote,
    relevantSegments: [{ id: 'segment-1', text: quote, start: 0, end: quote.length }] };
  const response = (facts, finishReason = 'STOP') => ({ candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify({ facts, status: 'ok' }) }] } }] });
  const empty = parseGeminiEvidenceResponse(response([]), [page], { strictSemantic: true });
  assert.equal(empty.responseSchemaValid, true);
  assert.equal(empty.rawFactCount, 0);
  assert.deepEqual(empty.diagnostics, { responseReceived: true, candidateCount: 1, finishReason: 'STOP', responseTextLength: JSON.stringify({ facts: [], status: 'ok' }).length,
    parseStatus: 'empty-facts', inputSourceCount: 1, inputSegmentCount: 1 });
  const base = { sourceId: 'source-1', subject: 'client.run', relation: 'usage', unit: '', quote, appliesAt: null };
  const claims = parseGeminiEvidenceResponse(response([{ ...base, value: 'client.run(store, callback)' }, { ...base, value: 'client.run(missing, callback)' }]), [page], { strictSemantic: true });
  assert.equal(claims.rawFactCount, 2);
  assert.equal(claims.verified.length, 1);
  assert.equal(claims.facts[1].status, 'rejected');
  assert.equal(claims.diagnostics.parseStatus, 'facts-present');
  const noText = parseGeminiEvidenceResponse({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }] }, [page]);
  assert.equal(noText.responseSchemaValid, false);
  assert.equal(noText.diagnostics.parseStatus, 'empty-response-text');
  assert.equal(noText.diagnostics.finishReason, 'MAX_TOKENS');
  const noCandidate = parseGeminiEvidenceResponse({ candidates: [] }, [page]);
  assert.equal(noCandidate.diagnostics.parseStatus, 'missing-candidate');
  assert.equal(noCandidate.diagnostics.candidateCount, 0);
});

test('offline fetch replay confirms the outgoing request contains the selected source and records an empty model answer', async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  const previousKeys = process.env.GEMINI_API_KEYS;
  let payload;
  try {
    process.env.GEMINI_API_KEY = 'offline-test-key';
    delete process.env.GEMINI_API_KEYS;
    globalThis.fetch = async (_url, options) => {
      payload = JSON.parse(options.body);
      return { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"facts":[],"status":"evidence-insufficient"}' }] } }] }) };
    };
    const quote = 'client.run(store, callback) runs callback within the supplied store.';
    const pages = [{ sourceId: 'source-1', url: 'https://docs.example.org/api/client', pageText: quote,
      relevantSegments: [{ id: 'segment-1', text: quote, start: 0, end: quote.length }] }];
    const result = await createGeminiEvidenceExtractor()({ question: 'client.run 사용법', pages });
    const sent = JSON.parse(payload.contents[0].parts[0].text.split('Input: ')[1]);
    assert.equal(sent.sources[0].url, pages[0].url);
    assert.equal(sent.sources[0].segments[0].text, quote);
    assert.equal(result.rawFactCount, 0);
    assert.equal(result.diagnostics.parseStatus, 'empty-facts');
    assert.equal(result.diagnostics.inputSourceCount, 1);
    assert.equal(result.diagnostics.inputSegmentCount, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
    if (previousKeys === undefined) delete process.env.GEMINI_API_KEYS;
    else process.env.GEMINI_API_KEYS = previousKeys;
  }
});
