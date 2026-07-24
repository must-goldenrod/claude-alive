interface EmptyStateProps {
  message: string;
}

export function EmptyState({ message }: EmptyStateProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: 'var(--text-secondary)',
        fontSize: 13,
        padding: 40,
        textAlign: 'center',
      }}
    >
      {message}
    </div>
  );
}
