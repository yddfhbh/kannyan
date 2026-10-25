# 범용 검색 파이프라인 프로토타입

## 현재 구조 분석

운영 경로는 `src/index.js`에서 검색 필요 여부와 Gemini 검색 계획을 판단한 뒤 `web-search.js`의 DuckDuckGo/Naver 검색, `web-evidence.js`의 후보 정렬·본문 읽기, `evidence-review.js`의 Gemini JSON 검토, `chat-search-policy.js`의 답변 조립으로 이어진다. 뉴스는 `news-candidates.js`와 `news-evidence.js`가 별도 흐름을 가진다. 본문은 `web-page-content.js`에서 HTML을 정리해 하나의 긴 문자열로 만들고, 그 문자열이 모델 검토와 여러 도메인별 후처리에 재사용된다.

이 구조의 주요 위험은 후보 선정, 페이지 유형 판정, 의미 관련성, 요청 속성 충족, 인용 검증, 최종 답변이 한 번의 문서 단위 결정으로 엮인다는 점이다. 따라서 모델이 정상적인 자료를 `relevant=false`로 판단하거나, 후처리 정규식이 표현 차이를 놓치면 문서 전체가 버려진다. 검색 재시도는 예산 안에서 이루어지지만, 모델 검토와 전용 fallback이 검색·읽기 예산을 함께 소모한다.

전용 처리는 다음 역할로 유지된다.

- `extractKmaDailyForecast`: 기상청 부산·울산·경남 지역 통보문의 날짜·지역 범위를 독립 검증한다.
- `inferOfficialDomains`와 `rankWebCandidates`의 도메인/공식 자료 신호: 알려진 서비스의 후보 우선순위를 높인다.
- `news-candidates.js`: 목록/홈페이지와 개별 기사, 게시일 및 freshness를 구분한다.
- `evidence-review.js`의 날씨·응시료·금액 검증: 잘못된 날짜·단위·적용 범위를 막는 안전장치다.

이들은 운영 기본 경로에서 제거하지 않았다. 다만 범용 프로토타입은 이 목록을 정답 규칙이나 공식 도메인 registry로 사용하지 않는다.

## 새 구조

`src/general-search-pipeline.js`는 운영 코드에 import되지 않는 opt-in 모듈이다.

1. `understandSearchQuestion`: 대상, 속성, 지역, 날짜, 최신성, 공식 출처 요구, 개수 신호를 경량 규칙으로 구조화한다.
2. `buildGeneralSearchPlan`: 동일 질문에서 제한된 검색 계획을 만든다. Gemini 호출은 이 프로토타입에 필요하지 않다.
3. `rankGeneralCandidates`: 관련성, 본문 접근 가능성, 날짜 신호, 권위 신호를 별도 점수로 기록한다. hostname만으로 공식성을 확정하지 않는다.
4. `extractPageEvidence`: 제목·본문·게시일·구조화 데이터와 문장 블록을 재사용 가능한 자료로 만든다.
5. `extractAtomicFacts`: 문서 전체가 아닌 연속 인용 단위로 사실을 만든다. 각 사실은 URL, 제목, 적용 범위(scope), 속성 값을 가진다.
6. `validateAtomicFact`: 인용이 실제 원문에 존재하는지, 요청 날짜·지역·숫자가 범위 안에 있는지 코드로 확인한다. 원문 인용과 정규화 비교값을 분리한다.
7. `verifyAtomicFacts`: 검증된 사실만 채택하고 나머지는 보류한다. 이 단계의 통과는 `verificationStage: structurally-verified`일 뿐이다.
8. `requestedAnswerRequirements`와 `answerRequirements`: 질문 유형에서 요구 항목을 추출하고, 항목 누락 또는 의미 검토 미실행이면 완전 답변으로 확정하지 않는다. 의미 검토가 실제로 승인한 사실만 `semantically-verified`가 된다.

Gemini를 연결할 경우 의미 판단은 Gemini가 담당하되, Gemini가 반환한 인용·사실은 반드시 `validateAtomicFact`를 통과해야 한다. 답변 생성은 의미 검토까지 끝난 사실만 완전 답변에 사용할 수 있다. Gemini 호출이나 독립 라벨이 없으면 사실은 `semanticRelevance: not-reviewed`로 남는다. 수량은 `normalizedQuantity`와 `unit`을 분리하고, 기간·가격 계산 예시·동적 HTML 템플릿은 실제 날짜·단가로 승격하지 않는다.

## 평가

`test/fixtures/general-search-evaluation.json`은 기존 8개 회귀 질문과 분리된 작은 합성 fixture다. `test/fixtures/general-search-questions.json`에는 검색에 사용하지 않은 신규 질문 24개가 있고, `test/fixtures/general-search-holdout.json`에는 8개 holdout이 있다. 질문은 최신 뉴스·사건, 릴리스, 상식, 공식 문서, 날짜/시간, 비교, 부분 확인, 부정확·부족 자료 유형을 포함한다. `test/fixtures/general-search-labels.json`은 원문 대조 전의 라벨 장부이며 현재 신규 질문은 모두 `미평가`다. `facts`에는 독립 검토 후에만 `근거에 의해 지지됨`, `근거와 모순됨`, `근거 부족`, `질문과 무관함`을 기록한다.

`npm run evaluate:general-search`로 실행한다. 현재 결과는 다음과 같다.

2026-10-24 오프라인 재평가에서는 `tmp/general-search-bodies-final-semantic.json`과 저장된 12개 입력만 사용했다. 실험 기준 시각은 `2026-10-24T00:19:00+09:00`, timezone은 `Asia/Seoul`로 고정했다. 오늘 서울은 2026-10-24, 내일 제주는 2026-10-25로 재현한다. 운영 경로의 clock은 고정하지 않고 호출 시각을 사용한다.

자료 시각은 `publishedAt`(실제 게시일, 확인 불가 시 `null`), `fetchedAt`(본문 수집), `preparedAt`(실험 입력 생성), `referenceTime`(질문 해석), `effectiveDate`(사실 적용일)로 분리한다. 기존 저장 자료에는 신뢰할 실제 게시일이 없으므로 수집 시각을 게시일로 대체하지 않는다.

이번 재평가 요약: 후보 129건, 구조 검증 통과 2건, 의미 검증 0건(추가 Gemini 호출 없음)이다. 12개 케이스의 상태 집계는 `prototypeVerified: 2`, `partial: 1`, `hold: 10`으로 케이스 상태와 일치시킨다. 오프라인 입력에서 후보가 0건이면 semantic reviewer HTTP 호출 없이 `skipped: no-candidates`로 기록한다. 5개 질문은 본문이 확보됐으나 관계·값 추출 실패/과도 제한으로 분류됐고, 검색·본문 미확보로 정답을 추정하지 않는다. 따라서 모델 호출 대상은 12개가 아니라 후보가 있는 7개이며, `expectedCallsWithoutExecution: 7`로 기록한다(이번 재평가에서는 실제 0회 실행).

공식성은 세 가지로 분리한다. `officialHost`는 URL hostname allowlist와 하위 도메인 일치만으로 계산하고, `officialTextSignal`은 제목·본문의 “공식/official/문서” 표현, 검색 점수의 `authority`는 두 신호의 합이다. 예를 들어 `namu.wiki`는 본문에 “공식”이 있어도 공식 호스트가 아니다. 검색 점수는 관련성 힌트이지 출처 소유권 증명이 아니다. 보고서의 `officialHostCandidateCount`와 `officialTextSignalCandidateCount`를 따로 확인한다.

최신 버전은 공식 릴리스/패키지 근거와 확인 시점이 없으면 채택하지 않는다. 최신 가격은 실제 공식 URL/소유 주체를 확인하며, 모델명·입력·출력·통화·토큰 단위 대응을 `priceDetails`에 보존한다. Lambda의 메뉴 안내는 요청 요금으로 채택하지 않지만 월 100만 건 무료 요청은 `normalizedQuantity: 1000000`, `unit: 건`으로 보존한다. 미래 행사 날짜는 미래라는 이유만으로 거부하지 않고 행사명·연도·날짜·출처 권위성을 별도로 평가한다.

| 세트 | 기존 기준 | prototype |
| --- | ---: | ---: |
| 날짜가 있는 날씨 | 거부 | 검증 사실 1개 |
| Node.js LTS | 거부 | fixture 게시일을 포함하면 검증 사실 1개 |
| 최근 AI 뉴스 | 거부 | 검증 사실 1개 |
| 오래된/무관 자료 | 거부 | 거부 |

현재 `npm run evaluate:general-search`의 fixture 결과는 구조 통과와 의미 통과를 별도 집계하며, 독립 정답이 없으므로 정확도·무관 채택률·과도 거부율은 `null`/미평가로 유지한다. AI 뉴스는 원문에 지역이 없는데 지역으로 오인하던 결함이 있었고, 현재는 일반 주제어를 지역으로 분류하지 않도록 수정했다. 따라서 fixture 수치는 회귀 확인용으로만 사용한다.

실제 수집은 `GENERAL_SEARCH_WRITE_CACHE=1 node scripts/evaluate-general-search.js --live --limit=24 --report=tmp/general-search-new-live-report.json`로 실행한다. 검색 결과와 본문은 `tmp/general-search-web-cache.json`에 저장하고, 이후 동일 질문 재실행에서는 같은 자료를 사용한다. `--report` 파일은 fixture로 해석되지 않는다. 보고서에는 검색 성공, 후보 선별, 본문 추출, 광고/메뉴 신호, 공식성 신호, 최대 12개 모델 후보, 처리 시간, HTTP 호출 수가 들어간다. 후보가 없거나 본문을 못 읽은 것은 검색/수집 실패이고, 본문은 있으나 인용 검증을 못 한 것은 사실 검증 실패로 구분한다. `--gemini`를 추가하면 인용 검증 뒤에 질문당 최대 1회, 전체 최대 12회의 의미 검토를 예약하지만, 이번 작업에서는 호출하지 않았다. 예상 입력/출력 토큰 수는 보고서에 남기고 요금 단가는 고정하지 않아 비용은 `null`이다. 운영 봇·Discord 로그인·기억 저장소·SQLite에는 접근하지 않는다.

최종 오프라인 보고서의 24개 결과는 후보 203건·구조 검증 8건이었지만 Gemini/독립 라벨은 0회/0건이었다. 따라서 기존의 완전 답변 3건은 모두 의미 검토 필요 또는 요구 항목 부족으로 재분류된다. `live-17`은 개발자·무료·실제 날짜가 없어 보류되고, `live-24`는 서비스명·무료 GB·월 요금이 없어 보류된다. `live-16`은 무료 요청 문장을 보존하되 `100만 건`을 1,000,000건으로 정규화하고 템플릿·계산 예시는 가격 사실로 채택하지 않는다. `live-18`은 GitHub Pages만으로 공식 일정이 확인되지 않아 보류된다. 제주 예보의 날짜·지역 범위 회귀와 AWS 무료 요청 회귀 fixture는 유지한다.

후보 0건 질문의 원인은 보고서의 본문 확보 진단과 추출 진단을 분리해 기록한다. 본문이 없으면 검색/본문 추출 실패이고, 본문이 있으면 검색 실패가 아니라 현재 관계·값 추출기의 과도한 제한 또는 해당 본문에 요구 사실이 없는 경우다. 이 분류만으로 정답 여부를 추정하지 않으며, 독립 라벨이 생길 때까지 정상 사실 거부율은 미평가다.

기존 8개 회귀 테스트와 신규 세트는 결과 보고를 분리한다. `npm test`는 Agent-Hebi sandbox에서 `test/chat-live-verification.test.js`만 `spawnSync git EPERM`으로 실패했고 나머지 62개는 통과했다. 승인된 동일 환경에서는 해당 파일의 8개 assertion이 모두 통과했다. 원인은 `scripts/verify-chat-live.js:24`가 `git rev-parse HEAD`를 자식 프로세스로 실행하는데 sandbox가 해당 spawn을 차단한 것이며, 테스트 완화나 skip은 하지 않았다.

## 전환 순서와 한계

1. fixture와 실제 저장 trace를 늘리고 사람이 독립적으로 정답 사실과 금지 사실을 라벨링한다.
2. 읽기 전용 shadow mode에서 기존 결과와 prototype의 사실·인용·예산을 함께 기록한다.
3. 날씨·뉴스·버전 등 분야별로 정확도와 오답률이 유지될 때만 답변 조립을 선택적으로 전환한다.
4. 최종적으로도 KMA 전용 검증은 성능 최적화로 남기고, 범용 경로를 fallback으로 유지한다.

현재 프로토타입은 HTML 표 DOM의 의미 있는 행/열 재구성, 다단계 날짜 표현, 검색 provider fallback을 완전히 대체하지 않는다. 다만 줄·목록·시간 경계를 보존하고, 상대 날짜를 평가 기준 시각으로 해석하며, 선택적인 Gemini 의미 검토를 추가했다. Gemini의 판단은 원문 인용·URL·날짜·지역 검증을 통과한 사실에만 적용된다. 표의 열 머리글이 본문에서 소실되는 경우에는 정상 보류가 맞으며, 안전성을 낮추는 전용 정규식으로 보완하지 않는다.

원문 스냅샷은 `src/general-search-snapshot.js`의 `buildGeneralSearchSourceSnapshot` 계약을 사용한다. 저장 본문은 `extractPageEvidence`와 동일한 정규화 문자열이며, 따라서 `sourceSpan.start/end`, 정확한 인용문, 출처 URL을 다시 대조할 수 있다. URL·상태·리다이렉트·hostname·공식 호스트·제목·게시/수정일·질문별 요구 항목·관련 구간을 함께 기록한다. 본문이 없으면 `body-snapshot-missing`, 민감정보 패턴이 감지되면 본문을 저장하지 않고 `sensitive-content-blocked`로 남긴다. 8,000자 수집 한계에 가까운 기존 본문은 전체 길이를 확보했다고 가정하지 않고 `truncationAssessment=unknown-near-8000-limit`로 구분한다. 원문은 실험용 local artifact에만 기록하며 운영 로그와 Discord 답변에는 포함하지 않는다.

기존 저장 자료만으로 원문 확보 현황을 확인하는 명령은 다음과 같다.

`npm run dry-run:general-search-snapshot -- --input=tmp/general-search-bodies-final-semantic.json --output=tmp/general-search-source-snapshot-dry-run.json`

6개 질문의 제한적 통합 실행 준비와 상태 분리는 다음 명령으로 재현한다. 이 명령들은 검색·HTTP·Gemini를 호출하지 않는다.

`GENERAL_SEARCH_BODIES_INPUT=tmp/general-search-bodies-final-semantic.json GENERAL_SEARCH_EXPERIMENT_STAMP=YYYYMMDD-snapshot node scripts/prepare-general-search-gemini-experiment.js`

`npm run experiment:general-search-gemini -- --input=tmp/general-search-gemini-experiment-input-YYYYMMDD-snapshot.json --dry-run`

## 6개 실제 Gemini A/B 격리 실행 준비

실험 입력은 `scripts/prepare-general-search-gemini-experiment.js`가 저장된 `tmp/general-search-bodies-final-semantic.json`에서 다음 6개만 복사해 만든다: MDN Fetch API AbortSignal, Kubernetes liveness probe, Python 최신 안정 버전, PostgreSQL/MySQL JSON 비교, AWS Lambda 요청 요금, React 최신 버전. `sourceQuestion`은 기존 저장 원문 키이고 보고서의 `question`은 고정 실험 질문이다. Holdout 8개는 선택 전에 제외 검증한다.

`scripts/run-general-search-gemini-experiment.js`의 A는 동일 원문에 기존 규칙 추출만 재생하고, B는 규칙 후보 수와 무관하게 질문당 직접 근거 추출을 한 번 호출한다. 전체 HTTP 상한은 6회이며 재시도·fallback은 사용하지 않는다. `--dry-run`은 API를 호출하지 않고 항상 6회 예정으로 보고한다. 실제 실행 시 `sourceUrl`, 정확한 quote, `sourceSpan`, 필드 인용 뒷받침을 코드로 검증하며, 독립 검토 장부가 갱신되기 전 정확성·무관 채택률·과도 거부율은 `null` 또는 `unreviewed`다. 토큰·비용은 API 응답에서 확인 가능한 값이 없으면 `null`로 남긴다.

일반 SSH 실행 명령:

```sh
cd /home/ubuntu/.local/share/agent-hebi/task-worktrees/discord-bot/66b69d705e5b4eb78d5ebc7e97dba738
GENERAL_SEARCH_EXPERIMENT_STAMP=20261024-ab node scripts/prepare-general-search-gemini-experiment.js
node scripts/run-general-search-gemini-experiment.js --input=tmp/general-search-gemini-experiment-input-20261024-ab.json --dry-run
node scripts/run-general-search-gemini-experiment.js --input=tmp/general-search-gemini-experiment-input-20261024-ab.json --output=tmp/general-search-gemini-experiment-run-$(date +%Y%m%d%H%M%S).json
```

키는 `--env-file=/home/ubuntu/discord-bot-new/.env`에서 allowlist된 변수만 읽고 결과에는 redaction한다. 운영 봇·검색 경로·SQLite·`.env`에는 쓰지 않는다.

## 범용 LLM 직접 근거 추출 격리 실험

현재 `general-search-pipeline.js`의 규칙 추출은 날씨 경로에는 유용하지만, MDN의 설명 문장·Kubernetes liveness 정의·뉴스 기사 문장처럼 숫자가 없는 정상 근거를 후보 0건으로 만들 수 있다. 이를 보완하기 위해 운영 코드에 연결하지 않은 `src/general-search-llm-extraction.js`를 추가했다. 이 모듈은 질문과 저장 본문의 문장 구간을 모델에 직접 주고, `subject`, `relation`, `value`, `unit`, `sourceUrl`, 정확한 연속 `quote`, 문서 기준 `appliesAt`을 받는 계약을 정의한다. 코드가 URL 존재, quote의 원문 포함, 날짜 형식을 검증하며 실패하면 `evidence-insufficient` 또는 `rejected`로 보류한다. 모델이 값을 계산하거나 한쪽 자료로 비교를 완성하는 것은 계약상 금지한다.

저장된 본문 기준의 소규모 비교 결론은 다음과 같다.

| 질문 유형 | 기존 규칙 추출 | 직접 근거 추출 기대치 |
| --- | --- | --- |
| MDN AbortSignal 설명 | `abort` 관계 문장 후보 0건 가능 | 설명형 문장을 그대로 인용 가능; MDN URL만 공식 호스트로 채택 |
| Python 최신 버전 | 3.9.13 페이지를 최신 주장으로 만들 위험 | “superseded” 문장을 인용하고 최신 주장은 보류 |
| Kubernetes liveness | readiness 본문을 liveness로 구분하지 못하거나 후보 0건 | liveness와 readiness 인용을 각각 분리; liveness 원문 없으면 보류 |
| PostgreSQL/MySQL 비교 | 비공식 PostgreSQL 한쪽 자료만으로 비교 불가 | 두 주체의 quote가 모두 없으면 비교 전체 보류 |
| AWS Lambda 무료 요청 | 100만 건 부분 근거는 유지 | `100만 건` quote는 유지하고 단가가 없으면 부분 근거로만 남김 |

실행 계약 테스트는 `npm test -- test/general-search-pipeline.test.js`로 수행한다. 실제 API가 필요해지는 실험은 `createGeminiEvidenceExtractor`를 명시적으로 주입해야 하며, 이번 단계에서는 호출하지 않는다. 예상 비용은 질문당 최대 1회, 본문 구간을 보내므로 기존 후보 사실만 보내는 검토보다 입력 토큰이 늘 수 있다. 응답은 약 1,600 output-token 상한으로 제한하고, 호출 p95·입출력 토큰·실패율을 shadow report에 기록한 뒤에만 비용을 산정한다. API 키가 없거나 호출 실패·스키마 실패·원문 불일치이면 기존 답변을 확장하지 않고 보류한다.

상대 날짜는 `referenceTime`과 `publishedAt`을 별도로 유지한다. 예를 들어 2026-10-23 게시물의 “내일”은 문서 기준 2026-10-24로 해석하며, 질문 기준 2026-10-24를 다시 더하지 않는다. 게시일이 없으면 문서의 상대 날짜를 임의의 절대 날짜로 확정하지 않는다. 날씨 표도 행·열 의미가 보존되지 않으면 보류한다.

## 운영 전환 판단

아직 전환하지 않는다. 현재 실제 자료 성공률과 정확도 라벨이 없고, 검색 provider가 실패하면 본문을 0개 확보하는 사례가 확인됐다. 전환 전에는 (1) 캐시된 실제 자료에 대한 독립 라벨 세트, (2) 기존 경로 대비 날짜·지역·주체 오답률, (3) p95 처리 시간과 HTTP/Gemini 예산, (4) Gemini 실패·본문 추출 실패 시 기존 경로 fallback을 검증해야 한다. 이후에도 shadow mode에서 결과만 비교하고, 분야별 allowlist를 둔 선택적 활성화부터 시작한다.

## 검색 결과 선택·원문 구간 개선 shadow 평가

`src/general-search-source-selection.js`는 운영 경로에 연결하지 않은 선택기다. 질문을 `version`, `documentation`, `comparison`, `price`, `news-event` 등으로 분류하고, hostname 공식성(`officialHost`), 제목·본문의 공식성 표현(`officialTextSignal`), 관련성, 최신성, 문서 유형, 본문 확보 여부를 별도 신호로 남긴다. 공식 hostname은 제목의 “공식”보다 우선하지만, 오래된 공식 문서를 최신 자료보다 무조건 높이지 않는다. 비교 질문은 대상별 hostname과 자료가 모두 선택될 때만 커버리지를 높인다.

예산은 검색 후보 최대 12개, 선택 본문 최대 4개, 선택 본문 전체 최대 3,200 tokens, 페이지별 관련 구간 최대 900 tokens다. `selectRelevantSourceSpans`는 API 예제·릴리스/상태·가격 숫자/단위·비교 대상·뉴스 사건/발행일을 포함하는 인접 블록을 선택하고, 원문 위치와 생략량을 기록한다. HTML 전체를 모델에 전달하지 않지만 구간의 문맥을 보존한다.

`scripts/evaluate-general-search-source-quality.js`는 `tmp/general-search-bodies-final-semantic.json`의 저장 목록만 재생해 기존 상위 4개와 개선 선택을 동일 조건으로 비교한다. Holdout 8개는 입력에서 제외한다. 결과는 `tmp/general-search-source-quality-20261024-v2.json`에 저장했으며, 원인 단계 A~F는 필요한 공식 hostname이 목록에 없는 경우 A, 있었으나 선택되지 않은 경우 B, 본문이 없는 경우 C, 구간이 비어 있으면 D 가능성으로 기록하고 독립 의미 라벨이 없는 E/F는 unknown으로 둔다.

다음 제한적 재검색은 6개 질문, 질문당 검색 HTTP 시도 최대 4회와 본문 읽기 HTTP 시도 최대 4개, 전체 검색 HTTP 시도 최대 12회와 전체 본문 읽기 HTTP 시도 최대 24회, 질의별 재시도 최대 1회로 고정한다. 검색 HTTP 시도에는 DuckDuckGo/Naver fallback을 포함하고, 본문 읽기 HTTP 시도에는 redirect를 포함한다. 각 HTTP 시도 직전에 예산을 확인하며 소진 시 재시도 없이 검색 경로를 종료한다. 이번 재검색 실행기는 Gemini를 호출하지 않는다. `--dry-run`은 검색과 본문 읽기를 실행하지 않고 계획을 stdout과 `--output` JSON 파일에 모두 기록하며, 기존 파일은 덮어쓰지 않는다. 실제 실행 승인 후의 SSH 명령은 다음과 같다.

```sh
cd /home/ubuntu/.local/share/agent-hebi/task-worktrees/discord-bot/66b69d705e5b4eb78d5ebc7e97dba738
GENERAL_SEARCH_EXPERIMENT_STAMP=20261024-ab node scripts/prepare-general-search-gemini-experiment.js
node scripts/run-general-search-gemini-experiment.js --input=tmp/general-search-gemini-experiment-input-20261024-ab.json --dry-run
node scripts/run-general-search-gemini-experiment.js --input=tmp/general-search-gemini-experiment-input-20261024-ab.json --output=tmp/general-search-gemini-experiment-run-$(date +%Y%m%d%H%M%S).json
node scripts/run-general-search-source-research-experiment.js --dry-run --output=tmp/general-search-source-research-dry-run-$(date +%Y%m%d%H%M%S).json
node scripts/run-general-search-source-research-experiment.js --output=tmp/general-search-source-research-$(date +%Y%m%d%H%M%S).json
```

이번 작업에서는 위 실제 실행 명령을 호출하지 않았다. 저장 결과·dry-run·오프라인 평가만 사용했다.
