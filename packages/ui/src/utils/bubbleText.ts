import i18n from '@claude-alive/i18n';

/** Map agent state + tool info to anthropomorphic speech bubble text */
export function getAnthropomorphicText(
  state: string,
  tool: string | null,
  animation: string | null,
): string | null {
  const t = i18n.t.bind(i18n);
  switch (state) {
    case 'active':
      switch (animation) {
        case 'reading':
          return tool ? t('bubble.readingTool', { tool }) : t('bubble.reading');
        case 'searching':
          return t('bubble.searching');
        case 'running':
          return tool === 'Bash' ? t('bubble.runningBash') : t('bubble.runningTest');
        case 'thinking':
          return t('bubble.thinking');
        case 'typing':
        default:
          return t('bubble.typing');
      }
    case 'waiting':
      return t('bubble.waiting');
    case 'error':
      return t('bubble.error');
    case 'listening':
      return t('bubble.listening');
    case 'done':
      return t('bubble.done');
    default:
      return null;
  }
}
