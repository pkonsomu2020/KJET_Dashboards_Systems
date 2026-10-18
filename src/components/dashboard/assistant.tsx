import { useState, type FormEvent } from 'react';
import { Sparkles, Send, Loader2, ArrowUpRight, Eraser } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { askAssistant, type AssistantMessage } from '@/data/api';

interface Turn extends AssistantMessage {
  sources?: string[];
  error?: boolean;
}

const EXAMPLES = [
  'Give me all details of Balek Central Dairy',
  'Which 5 clusters have the highest project cost?',
  'How many clusters need financial review?',
];

export function AssistantPanel({ onSelect }: { onSelect: (applicationNumber: string) => void }) {
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);

  async function send(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    const history = turns.filter(t => !t.error).map(({ role, content }) => ({ role, content }));
    setTurns(t => [...t, { role: 'user', content: q }]);
    setInput('');
    setBusy(true);
    try {
      const r = await askAssistant(q, history);
      setTurns(t => [...t, { role: 'assistant', content: r.answer, sources: r.sources }]);
    } catch (err) {
      setTurns(t => [...t, {
        role: 'assistant', error: true,
        content: err instanceof Error ? err.message : 'The assistant could not answer.',
      }]);
    } finally {
      setBusy(false);
    }
  }

  const submit = (e: FormEvent) => { e.preventDefault(); void send(input); };

  return (
    <section className="chart-panel mb-6" aria-label="AI assistant">
      <div className="panel-header">
        <div>
          <h2 className="flex items-center gap-2"><Sparkles size={15} className="text-primary" />Ask the assistant</h2>
          <p>Answers come only from the portfolio database. Check the linked clusters to verify.</p>
        </div>
        {turns.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setTurns([])}><Eraser />Clear</Button>
        )}
      </div>

      <div className="panel-body">
        {turns.length === 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {EXAMPLES.map(x => (
              <Button key={x} variant="outline" size="sm" onClick={() => void send(x)}>{x}</Button>
            ))}
          </div>
        )}

        <div className="space-y-4 max-h-[460px] overflow-auto mb-4">
          {turns.map((t, i) => (
            <div key={i} className={t.role === 'user' ? 'text-right' : ''}>
              <div className={`inline-block max-w-full rounded-md border border-border px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap text-left ${
                t.role === 'user' ? 'bg-muted' : t.error ? 'text-warning' : 'bg-background'}`}>
                {t.content}
              </div>
              {t.sources && t.sources.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {t.sources.slice(0, 20).map(s => (
                    <button key={s} type="button" className="badge" onClick={() => onSelect(s)} title="Open cluster profile">
                      {s}<ArrowUpRight size={10} />
                    </button>
                  ))}
                  {t.sources.length > 20 && <span className="text-[10px] text-muted-foreground">+{t.sources.length - 20} more</span>}
                </div>
              )}
            </div>
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 size={14} className="animate-spin" />Looking through the database...
            </div>
          )}
        </div>

        <form onSubmit={submit} className="filters" style={{ marginBottom: 0 }}>
          <label className="filter-search">
            <Sparkles size={15} />
            <input
              aria-label="Ask a question about the portfolio"
              placeholder="Ask about a cluster, a county, a value chain or the whole portfolio..."
              value={input}
              maxLength={1000}
              onChange={e => setInput(e.target.value)}
              disabled={busy}
            />
          </label>
          <Button type="submit" size="sm" disabled={busy || input.trim().length < 2}>
            <Send />Ask
          </Button>
        </form>
      </div>
    </section>
  );
}
