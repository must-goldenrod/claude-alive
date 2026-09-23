# 브라우저 자동화 (로컬 Chrome + Claude)

Stagehand v4가 로컬 Chrome을 CDP로 띄우고, 판단이 필요한 점검만 Claude가 답한다.
Browserbase 계정은 필요 없다.

## 2계층 구조

| 계층 | 수단 | LLM 호출 | 소요 |
|---|---|---|---|
| 결정적 점검 | `evaluate` / `snapshot` / `screenshot` | 없음 | 페이지당 수 ms |
| 판단 점검 | `extract` (Claude) | 질문당 2회 | 초 단위 |

결정적 점검은 재현 가능하고 비용이 0이다. 판단이 필요한 것만 위로 올린다.

## 사용

```ts
import { inspectUrl } from './browser/index.js';

const report = await inspectUrl(
  {
    url: 'https://example.com/',
    selectors: ['h1', 'nav a'],   // 존재해야 하는 요소
    checkLinks: true,             // 링크 HTTP 상태 확인
    screenshot: true,             // 증거 PNG
    questions: ['에러 메시지가 사용자에게 이해되나?'], // Claude 판단
  },
  { headless: true },
);

report.summary; // { total, pass, fail, error, skip, ok }
report.checks;  // 체크별 pass/fail/error/skip + detail
report.facts;   // title, links, images(alt), headings, formCount, lang ...
report.answers; // 질문별 { question, answer, ok }
```

세션을 직접 다룰 때는 `withBrowserSession`을 쓴다. 브라우저는 항상 닫힌다.

```ts
await withBrowserSession({ headless: true }, async ({ page, extract }) => {
  await page.goto('https://example.com/');
  const tree = await page.snapshot();     // 접근성 트리 (LLM 입력으로 쓰이는 것과 동일)
  const answer = await extract?.('로그인 버튼이 보이나?');
});
```

## 자격증명 — 두 경로

`backend: 'auto'`(기본)는 API 키를 우선하고, 없으면 Claude Code 로그인(구독)을 쓰는
`claude` CLI로 자동 폴백한다. 둘 다 없으면 `questions`만 `skip`으로 기록되고
결정적 점검은 전부 정상 동작한다 — 실패가 아니다.

| backend | 경로 | 자격증명 | 호출당 입력 | 실측 |
|---|---|---|---|---|
| `api` | Anthropic Messages API | `ANTHROPIC_API_KEY` | 페이지 a11y 트리만 (~400자) | 질문당 2 호출 |
| `cli` | `claude -p --output-format json` | Claude Code 로그인 | CLI 시스템 프롬프트 포함 ~30k 토큰 | 질문당 약 14초 |
| `none` | 추론 없음 | 불필요 | — | 결정적 점검만 |

`auto`가 API를 우선하는 이유는 CLI가 매 호출 자신의 시스템 프롬프트와 툴 정의를
다시 실어 보내기 때문이다. 명시적으로 `backend: 'api'`를 요청했는데 키가 없으면
조용히 CLI로 내려가지 않고 `none`이 된다.

Claude Code OAuth 토큰으로 `POST /v1/messages`를 직접 부르는 것은 **불가능하다.**
인증은 통과하지만(`GET /v1/models` → 200) 추론 요청은 HTTP 429로 거부된다.
그래서 구독 자격증명을 쓰는 길은 CLI 경유뿐이다.

모델 기본값은 API 경로 `claude-opus-5-5`, CLI 경로 `claude-haiku-4-5`.
`BrowserSessionOptions.model`로 바꾼다.

```ts
await inspectUrl({ url, questions: ['로그인 버튼이 보이나?'] },
  { backend: 'cli', model: 'claude-haiku-4-5' });
```

## 보안상 알아둘 것

- Chrome 프로필은 매 실행 임시 디렉터리다. 사용자의 기본 Chrome 프로필·쿠키를 쓰지 않는다.
- CDP 포트는 `127.0.0.1` 전용이다.
- `--remote-allow-origins=*`는 Stagehand 연결에 필수라 끌 수 없다. 세션이 열려 있는 동안
  같은 머신의 로컬 프로세스가 브라우저를 조종할 수 있으므로, 세션을 길게 열어두지 말고
  신뢰할 수 없는 페이지를 이 브라우저로 열지 않는다.
- `--enable-unsafe-extension-debugging`은 기본으로 제거된다
  (`allowRelaxedChromeFlags: true`로 되돌릴 수 있다).
- `inspectUrl`은 `http(s)` 외의 URL을 거부한다. `file://`로 로컬 파일을 읽을 수 없다.
