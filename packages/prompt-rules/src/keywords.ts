// Shared keyword sets. Korean + English mixed.

export const FORMAT_KEYWORDS: RegExp[] = [
  /\bjson\b/i,
  /\byaml\b/i,
  /\bcsv\b/i,
  /\bxml\b/i,
  /\btable\b/i,
  /\bmarkdown\b/i,
  /\bbullet(s)?\b/i,
  /\blist\b/i,
  /\bdiff\b/i,
  /\bformat\b/i,
  /표\s*(로|형식)/u,
  /리스트\s*로/u,
  /bullet\s*로/u,
  /목록\s*으로/u,
  /단계별/u,
  /요약/u,
  /\d+\s*(단어|문장|문단|줄)/u,
  /(ten|five|three|\d+)\s+(words|sentences|lines|bullets|items)/i,
];

export const CONTEXT_KEYWORDS: RegExp[] = [
  /\bthis\s+(project|codebase|repo|file|function|class|module)\b/i,
  /\busers?\s+are\b/i,
  /\bdomain\b/i,
  /\bcontext\b/i,
  // Korean: match the noun anywhere (often preceded by "이 <lang> 프로젝트" etc.)
  /(프로젝트|코드베이스|레포지토리|레포|파일|함수|클래스|모듈|컴포넌트|엔드포인트|테이블|스키마)/u,
  /사용자[는은가]/u,
  /도메인[은는]/u,
  /맥락/u,
  // Japanese: プロジェクト / コード / ファイル / 関数 / クラス / モジュール / ユーザー
  /(プロジェクト|コード|コードベース|ファイル|関数|クラス|モジュール|ユーザー)/u,
  // Simplified Chinese: 项目 / 代码 / 代码库 / 文件 / 函数 / 类 / 模块 / 用户
  /(项目|代码|代码库|文件|函数|类|模块|用户)/u,
  // Traditional Chinese: 專案 / 代碼 / 代碼庫 / 檔案 / 函數 / 類 / 模組 / 使用者
  /(專案|代碼庫|檔案|函數|模組|使用者)/u,
  // Common tech domain mentions that give enough context signal
  /\b(typescript|javascript|python|react|node|rust|go|postgres|sqlite|redis|kafka|docker|k8s|kubernetes|fastapi|nestjs|nextjs|nuxt|svelte|vue|angular|django|flask|spring|rails|laravel)\b/i,
];

export const IMPERATIVE_KEYWORDS: RegExp[] = [
  /\b(write|create|make|build|refactor|fix|debug|implement|explain|review|analyze|summarize|translate|convert|generate|design|deploy|test|run|list|find|show|add|remove|delete|update|optimize)\b/i,
  /해줘|해주세요|해주길|작성해|만들어|구현해|수정해|리팩터|설명해|분석해|리뷰해|요약해|번역해|변환해|제안해|고쳐|바꿔|추가해|삭제해|제거해|테스트해/u,
];

export const OUTPUT_CONSTRAINT_KEYWORDS: RegExp[] = [
  /\b(within|under|less than|at most|no more than|exactly)\s+\d+/i,
  /\bmax(imum)?\s+\d+/i,
  /\d+\s*(lines|words|sentences|tokens|chars)/i,
  /\d+\s*(줄|단어|문장|문단|토큰|자)\s*(이내|이하|로|까지)/u,
  /한글로|영어로|한국어로|korean\s*로|english\s*로|in\s+(english|korean)/i,
];

export const SUCCESS_CRITERIA_KEYWORDS: RegExp[] = [
  /success\s+criteria/i,
  /done\s+when/i,
  /acceptance\s+criteria/i,
  /성공\s*기준/u,
  /완료\s*기준/u,
  /기준[:은는]/u,
];

export const EXAMPLE_KEYWORDS: RegExp[] = [
  /\bexample(s)?\b[:=]/i,
  /\bex\.?\s*:/i,
  /\be\.g\.\b/i,
  /\bfor\s+example\b/i,
  /예[:)]/u,
  /예시[:)]/u,
];

export const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+(instructions?|prompts?)/i,
  /disregard\s+(all\s+)?previous/i,
  /system\s*:\s*/i,
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
  /you\s+are\s+now\s+a\s+different/i,
  // Allow short intervening words (e.g. "이전 지시 다 무시하고").
  /이전\s+(?:명령|지시|프롬프트).{0,20}(?:무시|잊어)/u,
  /시스템\s*프롬프트/u,
  /새로운\s+(?:인격|역할|정체성)/u,
];

export const QUESTION_MARKERS: RegExp[] = [
  /^\s*(what|why|when|where|who|how|is|are|does|do|can|should)\b.*\?/i,
  /\?\s*$/,
];

export const AMBIGUOUS_PRONOUN_STARTS: RegExp[] = [
  /^\s*(이거|그거|저거|저것|이것|that|this|it)\b/i,
  /^\s*(위\s*내용|above|the\s+above)\b/i,
];

/**
 * Vague adverbs / qualifiers that weaken the prompt's specificity.
 * C-023 in docs/08-quality-criteria.md.
 */
export const AMBIGUOUS_ADVERBS: RegExp[] = [
  // Korean — the most common vague Korean qualifiers.
  // Word boundaries aren't reliable for Hangul, so we anchor on whitespace / punctuation.
  /(^|[\s,.!?])(좀|대충|적당히|그냥|알아서|어떻게든|막|아무거나|뭔가)(\s|$|[\s,.!?])/u,
  // English — explicit word boundaries.
  /\b(kinda|sorta|somewhat|maybe|probably|whatever|anyhow|sort of|kind of)\b/i,
];

/**
 * Non-conjunction task separators used to stack multiple asks in one prompt.
 * C-004 expansion — the existing and/그리고 detection misses this kind of
 * "요약해줘 // 번역도 같이 // 마크다운으로" pattern.
 */
export const TASK_SEPARATOR_PATTERNS: RegExp[] = [
  /\s\/\/\s/g, // surrounded by whitespace to avoid comments in code
  /\s\/\s(?!\/)/g, // standalone slash, not part of //
];

/**
 * C-011 — prior-attempt markers. Presence of any of these suggests the user
 * has already tried something, which is valuable context for debugging asks.
 */
export const PRIOR_ATTEMPT_KEYWORDS: RegExp[] = [
  /\b(already\s+tried|i\s+tried|tried\s+to|attempted|did\s+not\s+work|didn't\s+work|doesn't\s+work)\b/i,
  // Korean: any verb stem ending in "-봤-" (past attempt), plus explicit markers.
  /봤(?:는데|지만|다|어|고|습니다|으나)/u,
  /(시도해|돌려봤|실행해봤|테스트해봤|해도\s*안|했는데\s*여전히)/u,
];

/**
 * C-011 — "I am stuck" / "debug this" intent signals. Combined with the
 * absence of PRIOR_ATTEMPT_KEYWORDS, this triggers R015.
 */
export const DEBUG_INTENT_KEYWORDS: RegExp[] = [
  /\b(debug|fix|broken|fail(?:s|ing|ed)?|error|crash(?:es|ed|ing)?|stuck|not\s+working)\b/i,
  /(안돼|안\s*되는|안\s*됩|오류|에러|실패|깨졌|망가진|이상해)/u,
];

/**
 * C-013 — version patterns. Presence indicates the user provided version
 * info; absence combined with tech-stack mentions triggers R016.
 */
export const VERSION_PATTERNS: RegExp[] = [
  /\bv?\d{1,3}(?:\.\d{1,3}){1,3}\b/, // e.g. 20.5.1, v3.4
  /\b(?:node|python|ruby|go|rust|java|php|deno|bun)\s*@?\s*\d+/i,
  /\b(\d{1,2})(?:\s+LTS|lts)\b/i,
  /\d{4}[./-]\d{1,2}[./-]\d{1,2}/, // dates — sometimes used as pseudo-version
];

/**
 * C-013 — technology names that are version-sensitive. If any of these
 * appear AND no VERSION_PATTERN matches, R016 fires.
 */
export const VERSION_SENSITIVE_TECH: RegExp[] = [
  /\b(node(?:\.?js)?|python|ruby|go(?:lang)?|rust|java|kotlin|swift|deno|bun)\b/i,
  /\b(react|vue|svelte|nextjs|next\.js|nuxt|angular|solidjs)\b/i,
  /\b(typescript|javascript|typescripts?)\b/i,
  /\b(django|flask|fastapi|nestjs|express|rails|laravel|spring)\b/i,
  /\b(postgres(?:ql)?|mysql|sqlite|mongodb|redis)\b/i,
];

/**
 * C-015 — error-message patterns. If none match while DEBUG_INTENT_KEYWORDS
 * is present, R017 fires ("you said it errors but didn't include the error").
 */
export const ERROR_MESSAGE_PATTERNS: RegExp[] = [
  /\b(Error|Exception|TypeError|ValueError|SyntaxError|RangeError|ReferenceError|KeyError|IndexError|AttributeError|NullPointer|StackOverflow|Segmentation\s+fault|panic(?:ked)?)(:|\s+at|\s+in|\s*$)/,
  /\btraceback\b/i,
  /\b(E\d{2,5}|TS\d{4,5})\b/, // TS/rust/... error codes
  /\b(ERR_[A-Z_]+|ENOENT|EACCES|EPERM|ECONNREFUSED)\b/, // node.js style
  /(오류\s*(메시지|내용)?|에러\s*(메시지|코드)?\s*:|stack\s*trace)/iu,
];

/**
 * C-040 — file-path-like tokens. Absence combined with "this file / this
 * function / 이 함수" references triggers R018.
 */
export const FILE_PATH_PATTERNS: RegExp[] = [
  /\b[\w.-]+\/[\w.-/]+\.(?:ts|tsx|js|jsx|py|rs|go|java|kt|rb|php|c|cc|cpp|h|hpp|sol|vue|svelte|md|yml|yaml|json|toml)\b/i,
  /\.\/[\w.-/]+/, // relative paths
  /`[\w.-]+\.[\w]+`/, // backticked filename
];

/**
 * C-040 — prompt references a specific piece of code by abstract reference
 * ("이 함수", "this class") without pointing to a file.
 */
export const ABSTRACT_CODE_REFERENCE: RegExp[] = [
  /\b(this|the)\s+(function|class|module|file|component|method|hook|middleware|service)\b/i,
  /(이|그|해당)\s*(함수|클래스|모듈|파일|컴포넌트|메서드|훅|미들웨어|서비스)/u,
  /\b(위|아래)\s*(코드|함수)/u,
];

export function anyMatch(text: string, patterns: RegExp[]): RegExp | null {
  for (const re of patterns) {
    if (re.test(text)) return re;
  }
  return null;
}
