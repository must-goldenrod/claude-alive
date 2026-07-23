import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  loadTodos,
  addTodo,
  toggleTodo,
  removeTodo,
  MAX_TEXT_LENGTH,
  type TodoItem,
} from './todoStore.ts';

export function TodoList() {
  const { t } = useTranslation();
  const [todos, setTodos] = useState<TodoItem[]>(() => loadTodos());
  const [draft, setDraft] = useState('');

  const handleAdd = useCallback(() => {
    if (!draft.trim()) return;
    setTodos(addTodo(draft));
    setDraft('');
  }, [draft]);

  const handleToggle = useCallback((id: string) => {
    setTodos(toggleTodo(id));
  }, []);

  const handleRemove = useCallback(
    (id: string) => {
      // Native confirm: Enter defaults to OK, satisfying "Enter = agree to remove".
      if (window.confirm(t('todo.confirmRemove'))) {
        setTodos(removeTodo(id));
      }
    },
    [t],
  );

  const remaining = todos.filter((item) => !item.done).length;

  return (
    <div
      className="flex flex-col border rounded-xl overflow-hidden"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)', maxHeight: 300 }}
    >
      {/* Header */}
      <div
        className="px-5 py-4 text-[13px] font-semibold border-b shrink-0 flex items-center justify-between"
        style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-color)', background: 'var(--bg-secondary)' }}
      >
        <span>{t('todo.title')}</span>
        {remaining > 0 && (
          <span
            className="px-2.5 py-0.5 rounded-md text-[11px] font-medium"
            style={{ background: 'var(--accent-blue)20', color: 'var(--accent-blue)' }}
          >
            {remaining}
          </span>
        )}
      </div>

      {/* Quick-add input */}
      <div className="px-3 py-2.5 shrink-0 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <input
          type="text"
          value={draft}
          maxLength={MAX_TEXT_LENGTH}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Ignore the Enter that confirms an in-progress IME composition
            // (Korean/Japanese/Chinese). Without this guard that Enter is
            // consumed twice — once to commit the last composed char, once to
            // submit — so the final character gets duplicated.
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder={t('todo.placeholder')}
          className="w-full text-[13px] rounded-lg px-3 py-2 outline-none"
          style={{
            background: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-color)',
          }}
        />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {todos.length === 0 ? (
          <div className="px-5 py-6 text-[12px] text-center" style={{ color: 'var(--text-tertiary)' }}>
            {t('todo.empty')}
          </div>
        ) : (
          <ul className="flex flex-col">
            {todos.map((item) => (
              <li
                key={item.id}
                className="group flex items-start gap-2.5 px-3 py-2 border-b last:border-b-0"
                style={{ borderColor: 'var(--border-color)' }}
              >
                <input
                  type="checkbox"
                  checked={item.done}
                  onChange={() => handleToggle(item.id)}
                  className="mt-0.5 shrink-0 cursor-pointer"
                  style={{ accentColor: 'var(--accent-blue)' }}
                />
                <span
                  onClick={() => handleToggle(item.id)}
                  className="flex-1 text-[13px] leading-snug cursor-pointer break-words whitespace-pre-wrap"
                  style={{
                    color: item.done ? 'var(--text-tertiary)' : 'var(--text-primary)',
                    textDecoration: item.done ? 'line-through' : 'none',
                  }}
                >
                  {item.text}
                </span>
                <button
                  onClick={() => handleRemove(item.id)}
                  aria-label={t('todo.remove')}
                  title={t('todo.remove')}
                  className="shrink-0 text-[15px] leading-none opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
