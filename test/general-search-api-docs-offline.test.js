import test from 'node:test';
import assert from 'node:assert/strict';
import { extractReadablePageText } from '../src/web-page-content.js';
import { parseEvidenceExtractionResponse } from '../src/general-search-llm-extraction.js';
import { runGeneralSearchChat } from '../src/general-search-chat.js';
import { selectGeneralSearchSources, selectRelevantSourceSpans } from '../src/general-search-source-selection.js';

const fact = (url, subject, relation, value, quote) => ({ sourceUrl: url, subject, relation, value,
  unit: '', quote, appliesAt: null, requiredAnswerItems: [], uncertainties: [] });

test('the reported question selects a relevant official API body and method spans', () => {
  const question = 'Node.js 공식 문서에서 AsyncLocalStorage.run()은 어떻게 사용하는지 간단한 사용 순서와 함께 알려줘';
  const official = { url: 'https://nodejs.org/api/async_context.html#asynclocalstoragerunstore-callback-args',
    title: 'Asynchronous context tracking', pageText: 'AsyncLocalStorage.run(store, callback) runs callback within the context.\nconst result = asyncLocalStorage.run(store, () => work());' };
  const other = { url: 'https://example.org/unrelated', title: 'AsyncLocalStorage notes', pageText: 'General notes about JavaScript.' };
  const selected = selectGeneralSearchSources(question, [other, official]);
  assert.equal(selected.selected[0].url, official.url);
  const spans = selectRelevantSourceSpans(question, official);
  assert.ok(spans.blocks.some((block) => block.text.includes('AsyncLocalStorage.run')));
  assert.ok(spans.blocks.some((block) => block.text.includes('asyncLocalStorage.run')));
});

test('a linked API section keeps its description and code after a long document prefix', () => {
  const html = `<main><p>${'Introduction '.repeat(600)}</p><h2 id="method">client.run(store, callback)</h2>
    <p>client.run(store, callback) runs callback within the supplied store.</p>
    <pre><code>const result = client.run(store, () =&gt; work());</code></pre><h2>Other method</h2><p>Unrelated.</p></main>`;
  const oldShape = extractReadablePageText(html, 5000);
  assert.doesNotMatch(oldShape.text, /const result/);
  const section = extractReadablePageText(html, 5000, { fragment: '#method' });
  assert.match(section.text, /runs callback within the supplied store/);
  assert.match(section.text, /const result = client\.run/);
  assert.doesNotMatch(section.text, /Unrelated/);
});

test('strict semantic approval uses exact API calls and rejects changed arguments across services', () => {
  for (const [url, subject, quote, wrong] of [
    ['https://nodejs.org/api/async_context.html', 'asyncLocalStorage.run', 'asyncLocalStorage.run(store, callback) runs callback within the context.', 'asyncLocalStorage.run(store, missing)'],
    ['https://react.dev/reference/react/useMemo', 'useMemo', 'useMemo(calculateValue, dependencies) caches a calculation.', 'useMemo(calculateValue, missing)'],
    ['https://docs.python.org/3/library/contextlib.html', 'contextlib.contextmanager', 'contextlib.contextmanager(func) creates a context manager.', 'contextlib.contextmanager(missing)'],
  ]) {
    const pages = [{ url, pageText: quote }];
    const good = parseEvidenceExtractionResponse({ facts: [fact(url, subject, 'usage', quote.split(' ')[0], quote)] }, pages, { strictSemantic: true });
    const bad = parseEvidenceExtractionResponse({ facts: [fact(url, subject, 'usage', wrong, quote)] }, pages, { strictSemantic: true });
    assert.equal(good.verified.length, 1, url);
    assert.equal(bad.verified.length, 0, url);
  }
});

test('a general how-to document keeps the operation tied to its subject', () => {
  const url = 'https://docs.docker.com/get-started/';
  const quote = 'docker run IMAGE starts a container from IMAGE.';
  const pages = [{ url, pageText: quote }];
  const good = parseEvidenceExtractionResponse({ facts: [fact(url, 'docker run', 'starts', 'a container', quote)] }, pages, { strictSemantic: true });
  const bad = parseEvidenceExtractionResponse({ facts: [fact(url, 'docker run', 'starts', 'a virtual machine', quote)] }, pages, { strictSemantic: true });
  assert.equal(good.verified.length, 1);
  assert.equal(bad.verified.length, 0);
});

test('empty, rejected, and invalid extraction have distinct safe outcomes', async () => {
  const url = 'https://react.dev/reference/react/useMemo';
  const pages = [{ url, pageText: 'useMemo(calculateValue, dependencies) caches a calculation.' }];
  const data = { results: [{}] };
  for (const facts of [[], [fact(url, 'useMemo', 'usage', 'useMemo(wrong)', pages[0].pageText)]]) {
    const result = await runGeneralSearchChat('useMemo 사용 방법', data, { mode: 'on', pages,
      extract: async () => ({ responseSchemaValid: true, facts, diagnostics: { responseReceived: true, candidateCount: 1,
        finishReason: 'STOP', responseTextLength: 42, parseStatus: facts.length ? 'facts-present' : 'empty-facts',
        inputSourceCount: 1, inputSegmentCount: 1 } }) });
    assert.equal(result.action, 'hold');
    assert.equal(result.outcome, 'hold');
    assert.equal(result.extractionDiagnostics.rawFacts, facts.length);
    assert.equal(result.extractionDiagnostics.parseStatus, facts.length ? 'facts-present' : 'empty-facts');
    assert.equal(result.extractionDiagnostics.inputSegmentCount, 1);
    assert.doesNotMatch(result.answer, /wrong/);
  }
  const invalid = await runGeneralSearchChat('useMemo 사용 방법', data, { mode: 'on', pages,
    extract: async () => ({ responseSchemaValid: false, failures: ['invalid-json'], facts: [] }) });
  assert.equal(invalid.action, 'legacy');
  assert.deepEqual(invalid.extractionDiagnostics.failures, ['invalid-json']);
});
