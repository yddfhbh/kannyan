import { classifyOfficialSource } from './general-search-pipeline.js';

// Shared by the live experiment runner and the saved-response replay.
export function assessFocusedCase(item, facts, fallback) {
  if (item.execution?.focusedEvidenceOnly !== true) return fallback;
  const pages = item.sources || [];
  const supported = facts.filter((fact) => fact.status === 'verified' && fact.semanticSupport === true
    && classifyOfficialSource(fact.sourceUrl || pages.find((page) => page.sourceId === fact.sourceId)?.url));
  const satisfied = [];
  if (item.id === 'focus-02') {
    const plans = ['GitHub Free', 'GitHub Pro', 'GitHub Free for organizations', 'GitHub Team', 'GitHub Enterprise Cloud'];
    if (plans.every((plan) => supported.some((fact) => fact.relation === 'free-minutes-per-month' && fact.subject === plan))) satisfied.push('free-allowance-by-plan');
    if (supported.some((fact) => fact.relation === 'overage-billing-rule')) satisfied.push('overage-billing-rule');
  }
  if (item.id === 'focus-05') {
    if (supported.some((fact) => fact.subject === '배경훈' && fact.quote.includes('배경훈 부총리 겸 과학기술정보통신부 장관'))) satisfied.push('minister-name-and-title');
    if (supported.some((fact) => fact.relation === 'evidence-date' && fact.value === '2026-10-19')) satisfied.push('evidence-date');
  }
  const required = item.requiredAnswerItems || [];
  const missing = required.filter((name) => !satisfied.includes(name));
  return { ...fallback, required, satisfied, missing, officialSatisfied: supported.length > 0,
    outcome: missing.length === 0 && supported.length > 0 ? 'complete' : supported.length > 0 ? 'partial' : 'hold' };
}
