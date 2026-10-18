import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AssistantMessage } from '@/components/dashboard/assistant-message';

const answer = [
  '## Identity',
  '- **Cluster name:** BALEK CENTRAL DAIRY COOPERATIVE SOCIETY LTD',
  '- **Registration date:** 2013-08-19',
  '',
  '## Financials',
  '- **Total project cost:** KES 17,515,014',
  '',
  '---',
  '',
  '| Application | Cluster | Cost |',
  '|---|---|---|',
  '| KJET-2026-704158 | Kirima Slopes Dairy | KES 256,441,200 |',
  '',
  'See [the folder](https://drive.google.com/drive/folders/abc).',
  '',
  '![tracker](https://evil.example/pixel.png)',
  '<script>alert(1)</script>',
].join('\n');

describe('AssistantMessage', () => {
  it('shows section headings and label/value rows instead of raw markdown', () => {
    const { container } = render(<AssistantMessage content={answer} onSelect={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Identity' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Financials' })).toBeTruthy();
    const rows = container.querySelectorAll('li.ai-kv');
    expect(rows.length).toBe(3);
    expect(rows[0]!.querySelector('.ai-k')!.textContent).toBe('Cluster name');
    expect(rows[2]!.querySelector('.ai-v')!.textContent).toBe('KES 17,515,014');
    expect(container.textContent).not.toContain('##');
    expect(container.textContent).not.toContain('**');
  });

  it('renders tables, right-aligns numbers and drops horizontal rules', () => {
    const { container } = render(<AssistantMessage content={answer} onSelect={() => {}} />);
    expect(container.querySelector('.ai-table-wrap table')).toBeTruthy();
    expect(container.querySelectorAll('td.num').length).toBe(1);
    expect(container.querySelector('hr')).toBeNull();
  });

  it('is safe: no images, no raw HTML, links open in a new tab', () => {
    const { container } = render(<AssistantMessage content={answer} onSelect={() => {}} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    const link = container.querySelector('a')!;
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('lists sources and opens the cluster profile when one is clicked', () => {
    const onSelect = vi.fn();
    render(<AssistantMessage content="Done." sources={['KJET-2026-512686', 'KJET-2026-704158']} onSelect={onSelect} />);
    expect(screen.getByText('2 sources')).toBeTruthy();
    fireEvent.click(screen.getByText('KJET-2026-704158'));
    expect(onSelect).toHaveBeenCalledWith('KJET-2026-704158');
  });

  it('shows errors in a distinct card without a copy button', () => {
    const { container } = render(<AssistantMessage content="Not configured." error onSelect={() => {}} />);
    expect(container.querySelector('.ai-card-error')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copy answer' })).toBeNull();
  });
});
