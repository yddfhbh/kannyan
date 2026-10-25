# General search generality audit (offline development set)

Scope: production HEAD `be39bdc60a72a1604183c713f714e7f4307c8178`; no sealed holdout, web, Gemini, Discord, or production writes. The seven synthetic topics in `test/general-search-novel-cases.test.js` were fixed before implementation changes. Each has a supported fact and a crossed or unsupported fact.

## Measured result

| Measure | Before | After |
| --- | ---: | ---: |
| Supported claims verified | 1/7 (14.3%) | 7/7 (100%) |
| Incorrect claims rejected | 7/7 (100%) | 7/7 (100%) |
| Quote and UTF-16 sourceSpan recovered | 14/14 (100%) | 14/14 (100%) |
| Correct outcome on supported cases | 0/7 (0%) | 7/7 (100%) |
| Correct Hold on incorrect only cases | 7/7 (100%) | 7/7 (100%) |

Supported-case outcomes after change: Complete 4, Partial 3, Hold 0. Incorrect-only outcomes: Hold 7. Before change, supported-case outcomes were Hold 6 and Partial 1. These are deterministic fixtures, not a statistical estimate of real-world accuracy. The official-host policy is not exercised for unknown owners by this set.

## Hardcoding inventory

Classification: **safety/source**, **general semantics**, **case overfit**. Line references identify modules; numbers may shift as code evolves.

| Module | Finding | Class | Action |
| --- | --- | --- | --- |
| `general-search-llm-extraction.js` | Exact quote, source ID/URL, unique occurrence, UTF-16 span, strict semantic gate | safety/source | Retained |
| `general-search-llm-extraction.js` | `free-minutes-per-month` fixed plan table, `overage-billing-rule` exact sentence, `evidence-date` `nttCn2`/`pstgBgngDt` record | case overfit | Removed; checks row/header/column or same article/record, subject, value, relation, and unit |
| `general-search-source-selection.js` | Service-name to official-host bonuses and mandatory host gate | case overfit | Removed; explicit `site:` restrictions and official-source policy remain |
| `general-search-source-selection.js` | GitHub Actions billing URL, React-shaped release URL and version rank | case overfit | Replaced with generic document path and version signals |
| `general-search-source-selection.js` | Documentation, price, freshness, prerelease, security relevance signals | general semantics | Retained; `probe`/`signal` terms still favor those example topics |
| `general-search-pipeline.js` | MDN, Kubernetes, Python, PostgreSQL/MySQL, AWS Lambda, React exact query strings | case overfit | Replaced with question-derived queries |
| `general-search-pipeline.js` | Lambda-only request-price rules | case overfit | Changed to request-price topic rules |
| `general-search-pipeline.js` | Exact official-host allowlist and URL boundary checks | safety/source | Retained. Unknown official domains can still be held; ownership verification needs a separate design |
| `general-search-pipeline.js` | Named comparison services, PostgreSQL/MySQL approval, WHO headquarters | case overfit | Replaced with question-derived subject ownership and requested headquarters relation |
| `general-search-pipeline.js` | 부산 event names and known Korean locations | case overfit | Still present in the legacy extraction/assessment path; these should be removed before claiming end-to-end generality |
| `general-search-focused-assessment.js` | Fixed GitHub plans, relation IDs, and exact ministry date | case overfit | Still present only in focused experiment assessment; production chat uses `assessRequiredAnswerItems` |

The retained safety rules can cause false Holds for a new service because the official-host allowlist does not establish ownership for arbitrary domains. The new tests verify deterministic semantic checks and sourceSpan mapping only; they do not prove retrieval quality or live model behavior.
