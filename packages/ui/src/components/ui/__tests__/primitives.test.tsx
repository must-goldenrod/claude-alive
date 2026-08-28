import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Badge, Button, EmptyState, Panel, StatusDot } from '../index.ts';

describe('primitives', () => {
  it('Panel renders children inside a bordered surface', () => {
    render(<Panel><span>inner</span></Panel>);
    const inner = screen.getByText('inner');
    expect(inner.parentElement).toHaveStyle({ borderRadius: 'var(--radius-lg)' });
  });

  it('Badge maps a tone to the matching accent variable', () => {
    render(<Badge tone="green">7</Badge>);
    expect(screen.getByText('7')).toHaveStyle({ color: 'var(--accent-green)' });
  });

  it('Button fires onClick and blocks it when disabled', () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>go</Button>);
    screen.getByRole('button', { name: 'go' }).click();
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(<Button onClick={onClick} disabled>go</Button>);
    screen.getByRole('button', { name: 'go' }).click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('StatusDot exposes its tone and pulse state', () => {
    render(<StatusDot tone="blue" pulse />);
    const dot = screen.getByTestId('status-dot');
    expect(dot).toHaveAttribute('data-tone', 'blue');
    expect(dot).toHaveAttribute('data-pulse', 'true');
  });

  it('EmptyState shows the given message verbatim', () => {
    render(<EmptyState message="아직 없음" />);
    expect(screen.getByText('아직 없음')).toBeInTheDocument();
  });
});
