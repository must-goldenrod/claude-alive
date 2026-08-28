import { space, text } from './tokens.ts';

/** Uniform "nothing here" line. Callers pass an already-translated message. */
export function EmptyState({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: space[4],
        textAlign: 'center',
        fontSize: text.sm,
        color: 'var(--text-secondary)',
        opacity: 0.6,
      }}
    >
      {message}
    </div>
  );
}
