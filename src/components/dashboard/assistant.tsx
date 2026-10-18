import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Sparkles, Send, Eraser } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { askAssistant, type AssistantMessage as ChatMessage } from '@/data/api';
import { AssistantMessage } from './assistant-message';

interface Turn extends ChatMessage {
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
  const scroller = useRef<HTMLDivElement>(null);

  // keep the newest message in view
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [turns, busy]);

  async function send(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    const history = turns.filter((t) => !t.error).map(({ role, content }) => ({ role, content }));
    setTurns((t) => [...t, { role: 'user', content: q }]);
    setInput('');
    setBusy(true);
    try {
      const r = await askAssistant(q, history);
      setTurns((t) => [...t, { role: 'assistant', content: r.answer, sources: r.sources }]);
    } catch (err) {
      setTurns((t) => [
        ...t,
        {
          role: 'assistant',
          error: true,
          content: err instanceof Error ? err.message : 'The assistant could not answer.',
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  return (
    <section className="chart-panel mb-6" aria-label="AI assistant">
      <div className="panel-header">
        <div>
          <h2 className="flex items-center gap-2">
            <Sparkles size={15} className="text-primary" />
            Ask the assistant
          </h2>
          <p>Answers come only from the KJET database. Open the linked clusters to verify.</p>
        </div>
        {turns.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setTurns([])}>
            <Eraser />
            Clear
          </Button>
        )}
      </div>

      <div className="panel-body">
        {turns.length === 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {EXAMPLES.map((x) => (
              <Button key={x} variant="outline" size="sm" onClick={() => void send(x)}>
                {x}
              </Button>
            ))}
          </div>
        )}

        {(turns.length > 0 || busy) && (
          <div ref={scroller} className="ai-thread" aria-live="polite">
            {turns.map((t, i) =>
              t.role === 'user' ? (
                <div key={i} className="ai-user">
                  <p>{t.content}</p>
                </div>
              ) : (
                <AssistantMessage key={i} content={t.content} sources={t.sources} error={t.error} onSelect={onSelect} />
              ),
            )}
            {busy && (
              <div className="ai-thinking" role="status">
                <span className="ai-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                Searching the database...
              </div>
            )}
          </div>
        )}

        <form onSubmit={submit} className="filters" style={{ marginBottom: 0 }}>
          <label className="filter-search">
            <Sparkles size={15} />
            <input
              aria-label="Ask a question about the portfolio"
              placeholder="Ask about a cluster, a county, a value chain or the whole portfolio..."
              value={input}
              maxLength={1000}
              onChange={(e) => setInput(e.target.value)}
              disabled={busy}
            />
          </label>
          <Button type="submit" size="sm" disabled={busy || input.trim().length < 2}>
            <Send />
            Ask
          </Button>
        </form>
      </div>
    </section>
  );
}
