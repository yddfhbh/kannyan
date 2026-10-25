import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGeneralSearchPlan, classifyOfficialSource, rankGeneralCandidates, requestedAnswerRequirements, runGeneralSearchPipeline, validateAtomicFact, verifyAtomicFacts } from '../src/general-search-pipeline.js';
import { createGeminiFactReviewer } from '../src/general-search-gemini.js';
import { assessRequiredAnswerItems, buildEvidenceExtractionInput, buildEvidenceExtractionPrompt, parseEvidenceExtractionResponse } from '../src/general-search-llm-extraction.js';
import { parseSiteRestrictions, selectGeneralSearchSources } from '../src/general-search-source-selection.js';
import { buildGeneralSearchSourceSnapshot } from '../src/general-search-snapshot.js';

test('stores normalized source text and reproducible source spans without HTTP', () => {
  const source = { url: 'https://kubernetes.io/docs/probes', status: 200, title: 'Probes', pageText: 'Liveness probe checks whether the application is alive.' };
  const snapshot = buildGeneralSearchSourceSnapshot('Kubernetes liveness probe 설명', source, { requiredAnswerItems: ['definition'] });
  assert.equal(snapshot.status, 'captured');
  assert.equal(snapshot.body.text, 'Liveness probe checks whether the application is alive.');
  assert.equal(snapshot.body.length, snapshot.body.text.length);
  assert.equal(snapshot.source.official, true);
  assert.deepEqual(snapshot.relevantSegments, []);
});

test('marks URL-only legacy material as body-snapshot-missing and blocks secrets', () => {
  assert.equal(buildGeneralSearchSourceSnapshot('Python 최신 안정 버전', { url: 'https://python.org/downloads/' }).status, 'body-snapshot-missing');
  const blocked = buildGeneralSearchSourceSnapshot('secret', { url: 'https://source.test', pageText: 'api_key=abc123 and ordinary text' });
  assert.equal(blocked.status, 'sensitive-content-blocked');
  assert.equal(blocked.body.text, null);
});

const page = { url: 'https://source.test/weather', title: '부산 예보', pageText: '2026년 10월 23일 부산은 흐리고 저녁부터 비가 내리겠다. 2026년 10월 23일 예상 강수량은 20mm이다. 메뉴 추천 광고' };

test('understands a new question without a site-specific registry', () => {
  const plan = buildGeneralSearchPlan('2026년 10월 23일 부산 날씨와 강수량은?');
  assert.deepEqual(plan.understanding.dates, ['2026년 10월 23일']);
  assert.ok(plan.understanding.locations.includes('부산'));
});

test('generates question-derived queries without service-specific domains', () => {
  for (const question of ['MDN Fetch API 공식 문서에서 abort signal 사용법', 'PostgreSQL과 MySQL의 공식 문서상 JSON 기능 비교', 'AWS Lambda 요청 요금', 'React 최신 버전']) {
    const queries = buildGeneralSearchPlan(question).queries;
    assert.equal(queries[0], question);
    assert.ok(queries.every((query) => !query.includes('site:')));
  }
});

test('resolves relative dates from the supplied evaluation clock', () => {
  const understanding = buildGeneralSearchPlan('내일 제주 날씨', { now: '2026-10-23T00:00:00Z' }).understanding;
  assert.deepEqual(understanding.relativeDates, ['2026-10-24']);
  assert.deepEqual(understanding.locations, ['제주']);
});

test('ranks body access and relevance separately from authority', () => {
  const ranked = rankGeneralCandidates('Node.js 최신 LTS', [{ url: 'https://a.test', title: 'Node.js 최신 LTS', snippet: '문서' }, { url: 'https://b.test', title: 'Node.js 최신 LTS 공식 문서', pageText: 'Node.js' }]);
  assert.equal(ranked[0].candidate.url, 'https://b.test');
  assert.equal(ranked[0].signals.hasBody, true);
});

test('separates official host provenance from official wording signals', () => {
  assert.equal(classifyOfficialSource('https://www.postgresql.org/docs/current/datatype-json.html'), true);
  assert.equal(classifyOfficialSource('https://namu.wiki/w/PostgreSQL'), false);
  const ranked = rankGeneralCandidates('PostgreSQL 공식 문서 JSON', [
    { url: 'https://namu.wiki/w/PostgreSQL', title: 'PostgreSQL 공식 문서 설명', pageText: 'JSON 기능' },
  ]);
  assert.equal(ranked[0].signals.officialHost, false);
  assert.equal(ranked[0].signals.officialTextSignal, true);
});

test('prefers topical release documents over utility and menu pages', () => {
  const ranked = rankGeneralCandidates('React 최신 버전', [
    { url: 'https://noise.test', title: 'React 설치 방법 메뉴 추천', pageText: 'npm install react' },
    { url: 'https://release.test', title: 'React 19.2 release notes', pageText: 'React 19.2 release' },
  ]);
  assert.equal(ranked[0].candidate.url, 'https://release.test');
  assert.equal(ranked[0].signals.releaseSignal, 3);
});

test('rejects unrelated site-restricted candidates and preserves official Kubernetes documents', () => {
  const mdn = selectGeneralSearchSources('MDN Fetch API 공식 문서에서 abort signal 사용법', [
    { url: 'https://developer.mozilla.org/en-US/docs/Web/API/AbortController/signal', title: 'AbortController signal' },
    { url: 'https://papago-plus.com/about', title: '파파고 플러스' },
  ]);
  assert.deepEqual(mdn.selected.map((source) => source.url), ['https://developer.mozilla.org/en-US/docs/Web/API/AbortController/signal']);
  assert.equal(mdn.counts.eligibleCandidateCount, 1);
  const kubernetes = selectGeneralSearchSources('Kubernetes 공식 문서의 liveness probe 설명', [
    { url: 'https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/', title: 'Configure Liveness Probes' },
    { url: 'https://kubernetes.io/docs/concepts/workloads/pods/probes/', title: 'Liveness Readiness Startup Probes' },
  ]);
  assert.equal(kubernetes.selected.length, 2);
});

test('matches site hostname and path prefix at URL boundaries', () => {
  assert.deepEqual(parseSiteRestrictions(['site:kubernetes.io/docs liveness']), [{ hostname: 'kubernetes.io', pathPrefix: '/docs' }]);
  const result = selectGeneralSearchSources('Kubernetes 공식 문서의 liveness probe 설명', [
    { url: 'https://kubernetes.io/docs/concepts/workloads/pods/probes/', title: 'Liveness probes' },
    { url: 'https://kubernetes.io/docsify/guide', title: 'Liveness probes' },
    { url: 'https://evil-kubernetes.io/docs/probes', title: 'Liveness probes' },
    { url: 'https://kubernetes.io.evil.com/docs/probes', title: 'Liveness probes' },
  ], { siteQueries: ['site:kubernetes.io/docs liveness probe'] });
  assert.deepEqual(result.selected.map((source) => source.url), ['https://kubernetes.io/docs/concepts/workloads/pods/probes/']);
});

test('returns zero eligible candidates for unrelated Python and database site results', () => {
  assert.equal(selectGeneralSearchSources('Python 최신 안정 버전', [{ url: 'https://papago-plus.com/about', title: '파파고 플러스' }, { url: 'https://www.navercorp.com/', title: 'NAVER Corp.' }]).counts.eligibleCandidateCount, 0);
  assert.equal(selectGeneralSearchSources('PostgreSQL과 MySQL의 공식 문서상 JSON 기능 비교', [{ url: 'https://papago-plus.com/about', title: '파파고 플러스' }, { url: 'https://www.navercorp.com/', title: 'NAVER Corp.' }]).counts.eligibleCandidateCount, 0);
});

test('prefers React 19.2 release evidence over older release and security posts', () => {
  const result = selectGeneralSearchSources('React 최신 버전', [
    { url: 'https://react.dev/blog/2024/12/05/react-19', title: 'React 19' },
    { url: 'https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components', title: 'Critical Security Vulnerability in React Server Components' },
    { url: 'https://react.dev/blog/2025/10/01/react-19-2', title: 'React 19.2' },
  ]);
  assert.equal(result.selected[0].url, 'https://react.dev/blog/2025/10/01/react-19-2');
  assert.ok(!result.selected.some((source) => /security-vulnerability/i.test(source.url)));
});

test('keeps exact quotations while validating facts independently', () => {
  const evidence = verifyAtomicFacts('2026년 10월 23일 부산 날씨와 강수량', [page]);
  assert.equal(evidence.status, 'verified');
  assert.ok(evidence.verified.some((fact) => fact.quote.includes('20mm')));
  assert.equal(validateAtomicFact('부산 날씨', { ...evidence.facts[0], quote: '없는 문장' }, page).status, 'rejected');
});

test('allows partial evidence and does not invent missing attributes', async () => {
  const result = await runGeneralSearchPipeline('2026년 10월 23일 부산 날씨와 습도', { candidates: [page, { url: 'https://source.test/old', title: '부산 기록', pageText: '2025년 1월 1일 부산 기온은 3도였다.' }], maxReads: 2 });
  assert.equal(result.evidence.status, 'verified');
  assert.equal(result.evidence.partial, true);
  assert.ok(!result.evidence.verified.some((fact) => /습도/.test(fact.quote)));
});

test('rejects a quote about another region even when the page mentions the requested region elsewhere', () => {
  const source = { url: 'https://source.test/weather-wide', title: '전국 날씨', pageText: '서울 참고 정보. 제주와 남부지방은 오늘 밤 비가 오겠다.' };
  const evidence = verifyAtomicFacts('오늘 서울 날씨', [source]);
  assert.equal(evidence.verified.length, 0);
  assert.ok(evidence.facts.some((fact) => fact.validationFailures.includes('requested-location-not-in-scope')));
});

test('does not treat a topic noun in a news question as a location', () => {
  const plan = buildGeneralSearchPlan('최근 일주일 AI 뉴스', { now: '2026-10-23T00:00:00Z' });
  assert.deepEqual(plan.understanding.locations, []);
});

test('resolves a yearless forecast day against the source publication context', () => {
  const source = { url: 'https://source.test/jeju', title: '내일 제주 예보', publishedAt: '2026-10-23T17:47:31+09:00', pageText: '내일(24일) 제주도 예상 강수량은 80~150mm이다.' };
  const evidence = verifyAtomicFacts('내일 제주 날씨', [source], { now: '2026-10-23T00:00:00Z' });
  assert.ok(evidence.verified.some((fact) => fact.quote.includes('80~150mm')));
  assert.ok(!evidence.verified.some((fact) => fact.validationFailures?.includes('requested-date-not-in-scope')));
});

test('splits independently scoped forecast clauses', () => {
  const source = { url: 'https://source.test/jeju', title: '제주 예보', publishedAt: '2026-10-23', pageText: '내일(24일) 제주도 80~150mm, 전남과 경남 20~80mm의 비가 예보됐다.' };
  const evidence = verifyAtomicFacts('내일 제주 날씨', [source], { now: '2026-10-23T00:00:00Z' });
  assert.ok(evidence.facts.some((fact) => fact.quote.includes('제주도') && fact.quote.includes('80~150mm')));
  assert.ok(!evidence.facts.some((fact) => fact.quote.includes('전남') && fact.quote.includes('80~150mm')));
});

test('can apply an optional semantic reviewer only after quote validation', async () => {
  const result = await runGeneralSearchPipeline('부산 날씨', {
    candidates: [page],
    semanticReview: async ({ facts }) => ({ approveFactIds: [], rejectFactIds: facts.map((fact) => fact.id), reasonById: Object.fromEntries(facts.map((fact) => [fact.id, '검토 거부'])) }),
  });
  assert.equal(result.evidence.status, 'insufficient-evidence');
  assert.equal(result.metrics.geminiCalls, 1);
  assert.ok(result.evidence.facts[0].validationFailures.includes('semantic-review-rejected'));
});

test('assigns stable question-wide IDs across documents and rejects ambiguous reviewer output', async () => {
  const sources = [
    { url: 'https://a.test', title: '서울 날씨', pageText: '2026년 10월 23일 서울은 맑고 20도이다.' },
    { url: 'https://b.test', title: '서울 날씨', pageText: '2026년 10월 23일 서울은 흐리고 18도이다.' },
  ];
  const evidence = verifyAtomicFacts('2026년 10월 23일 서울 날씨', sources);
  assert.equal(new Set(evidence.facts.map((fact) => fact.id)).size, evidence.facts.length);
  const result = await runGeneralSearchPipeline('2026년 10월 23일 서울 날씨', {
    candidates: sources,
    semanticReview: async ({ facts }) => ({ approveFactIds: [facts[0].id], rejectFactIds: [] }),
  });
  assert.equal(result.evidence.verified.length, 0);
  assert.ok(result.evidence.facts.every((fact) => fact.validationFailures.includes('semantic-review-missing-id')));
});

test('requires explicit approval and preserves reason-to-fact identity', async () => {
  const result = await runGeneralSearchPipeline('부산 날씨', { candidates: [page], semanticReview: async ({ facts }) => ({
    approveFactIds: [], rejectFactIds: facts.map((fact) => fact.id), reasonById: Object.fromEntries(facts.map((fact) => [fact.id, '연락처 정보'])),
  }) });
  assert.equal(result.evidence.verified.length, 0);
  assert.equal(result.evidence.facts.filter((fact) => fact.validationFailures.includes('semantic-review-rejected')).length, 1);
  assert.ok(result.evidence.facts.some((fact) => fact.validationFailures.includes('semantic-review-reason: 연락처 정보')));
});

test('rejects omitted, unknown, duplicate, and malformed reviewer IDs', async () => {
  const cases = [
    async (facts) => ({ approveFactIds: [], rejectFactIds: [] }),
    async () => ({ approveFactIds: ['fact-1-0', 'unknown'], rejectFactIds: [] }),
    async () => ({ approveFactIds: ['fact-1-0'], rejectFactIds: ['fact-1-0'] }),
    async () => ({ invalid: true }),
  ];
  for (const semanticReview of cases) {
    const result = await runGeneralSearchPipeline('부산 날씨', { candidates: [page], semanticReview });
    assert.equal(result.evidence.verified.length, 0);
    assert.ok(result.evidence.facts.some((fact) => fact.validationFailures.some((reason) => reason.startsWith('semantic-review-'))));
  }
});

test('does not accept tomorrow evidence for a today question, but accepts a dated tomorrow request', () => {
  const tomorrow = { url: 'https://source.test/forecast', title: '서울 예보', publishedAt: '2026-10-23', pageText: '내일 아침 기온은 서울 13도, 부산 17도로 오늘보다 5~7도 정도 높겠습니다.' };
  const today = verifyAtomicFacts('오늘 서울 날씨', [tomorrow], { now: '2026-10-23T00:00:00Z' });
  assert.equal(today.verified.length, 0);
  assert.ok(today.facts[0].validationFailures.includes('relative-date-mismatch'));
  const nextDay = verifyAtomicFacts('내일 서울 날씨', [tomorrow], { now: '2026-10-23T00:00:00Z' });
  assert.ok(nextDay.verified.some((fact) => fact.quote.includes('내일')));
});

test('rejects future weekday forecasts and preserves inherited tomorrow context', () => {
  const source = { url: 'https://source.test/broadcast', title: '서울 예보', publishedAt: '2026-10-23', pageText: '내일 서울 낮 기온은 21도이다. 다음 주 수요일에는 서울 아침 기온이 2도까지 떨어지겠다.' };
  const today = verifyAtomicFacts('오늘 서울 날씨', [source], { now: '2026-10-23T00:00:00Z' });
  assert.equal(today.verified.length, 0);
  assert.ok(today.facts.some((fact) => fact.quote.includes('2도') && fact.validationFailures.includes('requested-date-not-in-scope')));
  assert.ok(today.facts.some((fact) => fact.quote.includes('21도') && fact.validationFailures.includes('relative-date-mismatch')));
  const tomorrow = verifyAtomicFacts('내일 서울 날씨', [source], { now: '2026-10-23T00:00:00Z' });
  assert.ok(tomorrow.verified.some((fact) => fact.quote.includes('21도')));
});

test('holds a bare value when only publication date is available', () => {
  const source = { url: 'https://source.test/weather', title: '서울 예보', publishedAt: '2026-10-23', pageText: '서울 낮 기온은 21도이다.' };
  const evidence = verifyAtomicFacts('오늘 서울 날씨', [source], { now: '2026-10-23T00:00:00Z' });
  assert.equal(evidence.verified.length, 0);
  assert.ok(evidence.facts[0].validationFailures.includes('temporal-context-missing'));
});

test('resolves a yearless 24th against the verified publication year and month', () => {
  const source = { url: 'https://source.test/jeju', title: '제주 예보', publishedAt: '2026-10-23', pageText: '24일 제주 아침 최저기온은 19도이다.' };
  const evidence = verifyAtomicFacts('내일 제주 날씨', [source], { now: '2026-10-23T00:00:00Z' });
  assert.ok(evidence.verified.some((fact) => fact.targetDate === '2026-10-24'));
});

test('separates 춘천 and 서울 values instead of mixing attributes', () => {
  const source = { url: 'https://source.test/weather', title: '서울 예보', pageText: '오늘 아침 기온은 서울 7도, 춘천 2.5도이고 낮 최고기온은 서울 21도이다.' };
  const evidence = verifyAtomicFacts('오늘 서울 날씨', [source], { now: '2026-10-23T00:00:00Z' });
  assert.ok(evidence.facts.some((fact) => fact.quote.includes('서울 21도') && fact.attributes.includes('21도')));
  assert.ok(!evidence.verified.some((fact) => fact.subject === '서울' && fact.attributes.includes('2.5도')));
});

test('does not count repeated identical quotations as independent evidence', () => {
  const source = { url: 'https://source.test/weather', title: '서울 예보', pageText: '오늘 서울은 맑고 20도이다. 오늘 서울은 맑고 20도이다.' };
  const evidence = verifyAtomicFacts('오늘 서울 날씨', [source], { now: '2026-10-23T00:00:00Z' });
  assert.equal(evidence.verified.length, 1);
  assert.ok(evidence.facts.some((fact) => fact.validationFailures.includes('duplicate-evidence')));
});

test('does not approve a compound Jeju fact merely because one part is relevant', () => {
  const source = { url: 'https://source.test/jeju', title: '제주 예보', publishedAt: '2026-10-23', pageText: '내일 제주도 예상 강수량은 80~150mm, 최대 250mm는 산지에 적용된다. 서울 사진 설명과 광고 메뉴.' };
  const evidence = verifyAtomicFacts('내일 제주 날씨', [source], { now: '2026-10-23T00:00:00Z' });
  assert.ok(evidence.facts.every((fact) => !fact.quote.includes('사진 설명')));
  assert.ok(evidence.verified.every((fact) => !fact.quote.includes('광고')));
});

test('filters contact, menu, unrelated latest-version, shopping, and menu material', () => {
  const sources = [{ url: 'https://source.test/mixed', title: '자료', publishedAt: '2026-10-23', pageText: '서울 날씨는 맑고 20도이다. 전화 02-1234-5678 이메일 a@example.com 메뉴 추천 상품 9,900원. Python 3.11 최신 버전.' }];
  const evidence = verifyAtomicFacts('오늘 서울 날씨', sources, { now: '2026-10-23T00:00:00Z' });
  assert.ok(evidence.facts.every((fact) => !/전화|이메일|메뉴|Python|상품/.test(fact.quote)));
});

test('does not turn unrelated numeric prose into a generic version or price fact', () => {
  assert.equal(verifyAtomicFacts('OpenAI API 최신 가격', [{ url: 'https://fixture.test/news', title: '한글날', pageText: '2026년 한글날은 10월 9일 금요일입니다.' }]).verified.length, 0);
  assert.equal(verifyAtomicFacts('Node.js 최신 LTS', [{ url: 'https://fixture.test/php', title: 'PHP', pageText: 'VM에서 PHP 파일을 실행할 때마다 파일 내용을 확인 후 처리합니다.' }]).verified.length, 0);
});

test('requires an official source for latest version and price claims', () => {
  const react = verifyAtomicFacts('React 최신 버전', [{ url: 'https://example.test/wiki', title: 'React 19 정식 버전', pageText: 'React 19 정식 버전이 발표되었다.' }]);
  assert.equal(react.verified.length, 0);
  assert.ok(react.facts[0].validationFailures.includes('latest-version-official-source-required'));
  const price = verifyAtomicFacts('OpenAI API 최신 가격', [{ url: 'https://apimaster.ai/pricing', title: '공식 요금표', pageText: 'OpenAI API GPT-4o 입력 5 USD / 1M tokens, 출력 15 USD / 1M tokens' }]);
  assert.equal(price.verified.length, 0);
  assert.ok(price.facts[0].validationFailures.includes('latest-price-official-source-required'));
  assert.deepEqual(price.facts[0].priceDetails.modelNames, ['GPT-4o']);
  assert.match(price.facts[0].priceDetails.input, /입력/);
  assert.match(price.facts[0].priceDetails.output, /출력/);
});

test('rejects Lambda menu text but retains the free request tier', () => {
  const source = { url: 'https://aws.amazon.com/ko/lambda/pricing/', title: 'AWS Lambda 요금', pageText: 'AWS Lambda 무료로 시작하세요. AWS Lambda 프리 티어에는 월 100만 건의 무료 요청이 포함된다.' };
  const evidence = verifyAtomicFacts('AWS Lambda 요청 요금', [source]);
  assert.ok(evidence.facts.some((fact) => fact.validationFailures.includes('pricing-menu-not-request-price')));
  const free = evidence.verified.find((fact) => fact.quote.includes('100만'));
  assert.equal(free.normalizedQuantity, 1000000);
  assert.equal(free.unit, '건');
});

test('skips semantic review when there are no fact candidates', async () => {
  let calls = 0;
  const result = await runGeneralSearchPipeline('Kubernetes 공식 문서의 liveness probe 설명', {
    candidates: [{ url: 'https://kubernetes.io/docs/probes', title: 'Probes', pageText: 'readiness probe는 트래픽을 받을 준비를 확인한다.' }],
    semanticReview: async () => { calls += 1; throw new Error('must not call'); },
  });
  assert.equal(result.evidence.facts.length, 0);
  assert.equal(calls, 0);
  assert.equal(result.semanticReview.skipped, 'no-candidates');
  assert.equal(result.metrics.geminiCalls, 0);
});

test('direct evidence extraction contract preserves prose access and rejects fabricated quotes', () => {
  const source = { url: 'https://developer.mozilla.org/ko/docs/Web/API/Window/fetch', title: 'fetch()', pageText: 'fetch()는 네트워크에서 리소스를 취득하는 절차를 시작하고 프로미스를 반환합니다.' };
  const input = buildEvidenceExtractionInput('MDN Fetch API abort signal 설명', [source], { referenceTime: '2026-10-24T00:19:00+09:00' });
  assert.equal(input.sources[0].segments.length, 1);
  assert.match(buildEvidenceExtractionPrompt('MDN Fetch API abort signal 설명', [source]), /exact, contiguous quote/);
  const valid = parseEvidenceExtractionResponse(JSON.stringify({ facts: [{ subject: 'fetch()', relation: '설명', value: '네트워크에서 리소스를 취득', unit: '', sourceUrl: source.url, quote: source.pageText, appliesAt: null }] }), [source]);
  assert.equal(valid.verified.length, 1);
  const fabricated = parseEvidenceExtractionResponse(JSON.stringify({ facts: [{ subject: 'fetch()', relation: '설명', value: 'abort', unit: '', sourceUrl: source.url, quote: '원문에 없는 abort 설명', appliesAt: null }] }), [source]);
  assert.equal(fabricated.verified.length, 0);
  assert.ok(fabricated.facts[0].validationFailures.includes('quote-not-in-source'));
});

test('passes source-selection bounded segments with document-wide UTF-16 offsets', () => {
  const body = '머리말 🐈. AbortController로 fetch를 취소할 수 있다.';
  const start = body.indexOf('AbortController');
  const source = {
    url: 'https://developer.mozilla.org/en-US/docs/Web/API/AbortController',
    snapshotId: 'mdn-snapshot-1', pageText: body,
    body: { storedLength: body.length, fullLength: body.length, truncated: false },
    relevantSegments: [{ id: 'mdn-snapshot-1-segment-1', text: 'AbortController로 fetch를 취소할 수 있다.', contextSpan: 'AbortController로 fetch를 취소할 수 있다.', start, end: body.length }],
  };
  const input = buildEvidenceExtractionInput('MDN Fetch API abort signal 사용법', [source], { requiredAnswerItems: ['usage-procedure'] });
  assert.equal(input.sources[0].snapshotId, 'mdn-snapshot-1');
  assert.deepEqual(input.sources[0].segments[0].sourceSpan, { start, end: body.length });
  assert.equal(body.slice(input.sources[0].segments[0].sourceSpan.start, input.sources[0].segments[0].sourceSpan.end), input.sources[0].segments[0].text);
  assert.equal(input.sources[0].segmentBasis, 'source-selection-bounded-body-offsets-utf16');
});

test('direct evidence extraction does not turn an old official release into latest', () => {
  const source = { url: 'https://www.python.org/downloads/release/python-3913/', title: 'Python 3.9.13', pageText: 'Python 3.9.13 has been superseded by Python 3.9.25. Python 3.11 is now the latest feature release series.' };
  const parsed = parseEvidenceExtractionResponse(JSON.stringify({ facts: [{ subject: 'Python', relation: 'latest-version', value: '3.9.13', unit: '', sourceUrl: source.url, quote: 'Python 3.9.13 has been superseded by Python 3.9.25.', appliesAt: null }] }), [source]);
  assert.equal(parsed.verified.length, 1);
  assert.match(parsed.verified[0].quote, /superseded/);
});

test('keeps publication, fetch, preparation, reference, and effective dates distinct', () => {
  const source = { url: 'https://source.test/weather', title: '서울 예보', pageText: '오늘 서울은 맑고 20도이다.', publishedAt: null, fetchedAt: '2026-10-23T14:37:04.208Z', preparedAt: '2026-10-24T00:20:00+09:00', referenceTime: '2026-10-24T00:19:00+09:00' };
  const fact = verifyAtomicFacts('오늘 서울 날씨', [source], { now: source.referenceTime }).verified[0];
  assert.equal(fact.publishedAt, null);
  assert.equal(fact.publicationDate, null);
  assert.equal(fact.fetchedAt, source.fetchedAt);
  assert.equal(fact.preparedAt, source.preparedAt);
  assert.equal(fact.referenceTime, source.referenceTime);
  assert.equal(fact.effectiveDate, '2026-10-24');
});

test('keeps answer completeness separate from structural quotation validation', async () => {
  const result = await runGeneralSearchPipeline('서울 이번 달 무료 개발자 행사 일정', { candidates: [{
    url: 'https://example.test/event', title: '웰니스 행사', pageText: '서울 한남동에서 5일간 웰니스 축제를 개최한다.'
  }] });
  assert.equal(result.evidence.verified.length, 0);
  assert.equal(result.answerRequirements.complete, false);
  assert.ok(result.answerRequirements.missing.includes('free'));
  assert.ok(result.answerRequirements.missing.includes('date'));
  assert.ok(requestedAnswerRequirements(result.plan.understanding).includes('location'));
});

test('normalizes Korean scale quantities and rejects pricing templates/calculation examples', () => {
  const source = { url: 'https://aws.amazon.com/ko/lambda/pricing/', title: 'AWS Lambda 요금', pageText: 'AWS Lambda 프리 티어에는 월 100만 건의 무료 요청과 월 40만 GB-초의 컴퓨팅 시간이 포함된다. 요청 1백만 건당 {priceOf!lambda} 총 월별 요금 = 20 USD + 48.96 USD = 68.96 USD.' };
  const evidence = verifyAtomicFacts('AWS Lambda 요청 요금', [source]);
  const free = evidence.facts.find((fact) => fact.quote.includes('100만'));
  assert.equal(free.normalizedQuantity, 1000000);
  assert.equal(free.unit, '건');
  assert.ok(!evidence.verified.some((fact) => /priceOf|총 월별 요금/.test(fact.quote)));
});

test('requires the requested relation rather than accepting a related API or probe sentence', () => {
  assert.equal(verifyAtomicFacts('MDN Fetch API 공식 문서에서 abort signal 사용법', [{ url: 'https://developer.mozilla.org/ko/docs/Web/API/Fetch_API', title: 'Fetch API', pageText: 'Fetch API를 사용하면 네트워크 리소스를 요청할 수 있습니다.' }]).verified.length, 0);
  assert.equal(verifyAtomicFacts('Kubernetes 공식 문서의 liveness probe 설명', [{ url: 'https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/', title: 'Probes', pageText: 'readiness probe는 컨테이너가 트래픽을 받을 준비가 되었는지 확인합니다.' }]).verified.length, 0);
});

test('usage explanations remain partial until a procedure or example is quoted', () => {
  const result = assessRequiredAnswerItems('MDN Fetch API 공식 문서에서 abort signal 사용법', [
    { status: 'verified', quote: 'signal은 AbortSignal 객체 인스턴스입니다. 필요한 경우 AbortController를 통해 요청을 중단할 수 있습니다.', sourceUrl: 'https://developer.mozilla.org/ko/docs/Web/API/Window/fetch' },
  ], { requirementQuestion: 'MDN Fetch API 공식 문서에서 abort signal 사용법' });
  assert.ok(result.satisfied.includes('fact-value'));
  assert.ok(result.missing.includes('usage-procedure'));
  assert.equal(result.outcome, 'partial');
});

test('non-official Kubernetes evidence is reference-only and held from the answer', () => {
  const result = assessRequiredAnswerItems('Kubernetes 공식 문서의 liveness probe 설명', [
    { status: 'verified', quote: 'liveness는 컨테이너 재시작이 필요한 상태인지를 확인합니다.', sourceUrl: 'https://example.test/kubernetes-blog' },
  ]);
  assert.deepEqual(result.answerEligible, []);
  assert.equal(result.referenceOnly.length, 1);
  assert.equal(result.outcome, 'hold');
});

test('comparison needs the same attribute from official evidence for both products', () => {
  const result = assessRequiredAnswerItems('PostgreSQL과 MySQL의 공식 문서상 JSON 기능 비교', [
    { status: 'verified', subject: 'PostgreSQL', relation: 'JSON 타입', value: 'json과 jsonb', quote: 'PostgreSQL에는 json과 jsonb 타입이 있다.', sourceUrl: 'https://www.postgresql.org/docs/current/datatype-json.html' },
  ]);
  assert.ok(result.missing.includes('service-b'));
  assert.ok(result.missing.includes('authoritative-source'));
  assert.equal(result.outcome, 'hold');
});

test('AWS free-tier evidence survives while missing request price stays partial', () => {
  const result = assessRequiredAnswerItems('AWS Lambda 요청 요금', [
    { status: 'verified', quote: 'Lambda 프리 티어에는 월 100만 건의 무료 요청이 포함된다.', sourceUrl: 'https://aws.amazon.com/ko/lambda/pricing/' },
  ]);
  assert.ok(result.satisfied.includes('free-tier'));
  assert.ok(result.missing.includes('request-price'));
  assert.equal(result.outcome, 'partial');
});

test('React latest-version evidence from a blog is not answer-eligible', () => {
  const result = assessRequiredAnswerItems('React 최신 버전', [
    { status: 'verified', quote: 'React 19 정식 버전이 발표되었다.', sourceUrl: 'https://example.test/react-blog' },
  ]);
  assert.equal(result.answerEligible.length, 0);
  assert.equal(result.outcome, 'hold');
});

test('does not confuse a regional WHO office with WHO headquarters', () => {
  const evidence = verifyAtomicFacts('WHO 본부가 있는 도시와 기관 역할', [{ url: 'https://fixture.test/who', title: 'WHO 지역사무소', pageText: 'WHO 서태평양 지역사무소는 마닐라에 있습니다.' }]);
  assert.equal(evidence.verified.length, 0);
});

test('safe partial acceptance keeps independently validated facts only', async () => {
  const result = await runGeneralSearchPipeline('부산 날씨와 습도', { candidates: [page], semanticReview: async ({ facts }) => ({
    approveFactIds: facts.filter((fact) => fact.quote.includes('부산')).map((fact) => fact.id),
    rejectFactIds: facts.filter((fact) => !fact.quote.includes('부산')).map((fact) => fact.id),
    reasonById: Object.fromEntries(facts.filter((fact) => !fact.quote.includes('부산')).map((fact) => [fact.id, '질문 속성 불일치'])),
  }) });
  assert.ok(result.evidence.verified.length > 0);
  assert.equal(result.evidence.partial, true);
});

test('Gemini reviewer limits prompt facts and safely rejects omitted or malformed responses', async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousModel = process.env.GEMINI_MODEL;
  const previousFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.GEMINI_MODEL = 'test-model';
  let requestBody;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ approveFactIds: ['fact-1'], rejectFactIds: ['fact-2'], reasonById: { 'fact-2': '불확실' } }) }] } }] }), { status: 200 });
  };
  try {
    const reviewer = createGeminiFactReviewer({ maxCalls: 1, maxFactsPerReview: 2 });
    const facts = Array.from({ length: 5 }, (_, index) => ({ id: `fact-${index + 1}`, quote: index < 2 ? `서울 오늘 ${index + 1}도` : `무관한 문장 ${index}`, sourceUrl: 'https://source.test', sourceTitle: '자료', status: index < 2 ? 'verified' : 'rejected' }));
    const result = await reviewer({ question: '오늘 서울 날씨', pages: [], facts });
    const prompt = requestBody.contents[0].parts[0].text;
    assert.equal(JSON.parse(prompt.match(/Facts: (.+)\nPage titles/)[1]).length, 2);
    assert.deepEqual(result.approveFactIds, ['fact-1']);
    assert.deepEqual(new Set(result.rejectFactIds), new Set(['fact-2', 'fact-3', 'fact-4', 'fact-5']));
    assert.equal(result.omittedFactIds.length, 3);
    assert.equal(result.responseSchemaValid, true);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.GEMINI_MODEL; else process.env.GEMINI_MODEL = previousModel;
  }
});

