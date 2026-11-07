(() => {
  const diagnostic = { stage: '초기 JavaScript 준비 중', error: '' };
  window.__chessleDiagnostic = diagnostic;
  const record = (value) => { diagnostic.error = String(value?.message || value || 'Unknown error').slice(0, 300); console.error('[Chessle startup diagnostic]', diagnostic.error); };
  window.addEventListener('error', (event) => record(event.message || event.error || 'Script error'), true);
  window.addEventListener('unhandledrejection', (event) => record(event.reason));
  setTimeout(() => { const loading = document.getElementById('loading'); if (!loading || loading.hidden || document.getElementById('startup-diagnostic')) return; const message = document.createElement('p'); message.id = 'startup-diagnostic'; message.textContent = diagnostic.error ? `초기화 오류: ${diagnostic.error}` : `초기화 지연 — 마지막 단계: ${diagnostic.stage}`; loading.appendChild(message); }, 9000);
})();
