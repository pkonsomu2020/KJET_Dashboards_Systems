import { useEffect, useState } from 'react';
import {
  Search, LayoutGrid, List, ArrowUpRight, ChevronLeft,
  ChevronRight, MapPin, RotateCcw, SearchX, Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useClusters, useMeta } from '@/hooks/usePortfolio';
import { money, number, percent } from '@/data/portfolio';
import type { ClusterRow } from '@/data/api';
import { SplitBar } from './profile';

const PAGE_SIZE = 20;

interface Props {
  onSelect: (applicationNumber: string) => void;
  onRowsChange?: (rows: ClusterRow[]) => void;
  query: string;    setQuery:  (q: string) => void;
  county: string;   setCounty: (c: string) => void;
  chain: string;    setChain:  (c: string) => void;
  sort: string;     setSort:   (s: string) => void;
  page: number;     setPage:   (p: number) => void;
  review?: boolean;
}

export function ClusterExplorer({
  onSelect, onRowsChange,
  query, setQuery,
  county, setCounty,
  chain, setChain,
  sort, setSort,
  page, setPage,
  review = false,
}: Props) {
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');

  const { data, isLoading, isFetching } = useClusters({
    ...(query   ? { q:      query   } : {}),
    ...(county  ? { county: county  } : {}),
    ...(chain   ? { chain:  chain   } : {}),
    ...(review  ? { review: true    } : {}),
    sort,
    page,
    limit: PAGE_SIZE,
  });

  const { data: meta } = useMeta();

  const rows       = data?.data ?? [];
  const total      = data?.total ?? 0;
  const pageCount  = data?.pageCount ?? 1;

  // Notify parent of current rows (for CSV export)
  useEffect(() => {
    onRowsChange?.(rows);
  }, [rows]);  // eslint-disable-line react-hooks/exhaustive-deps

  const clear = () => { setQuery(''); setCounty(''); setChain(''); setSort('name'); setPage(1); };

  return (
    <section className="explorer">
      {/* Header */}
      <div className="explorer-header">
        <div>
          <div className="explorer-title">
            <h2>{review ? 'Clusters requiring financial review' : 'Cluster portfolio'}</h2>
            <span>
              {isFetching
                ? <Loader2 size={12} className="animate-spin" />
                : `${total} clusters`}
            </span>
          </div>
          <p>
            {review
              ? 'Matching limits and missing financial submissions'
              : 'Explore beneficiary clusters and their co-investment applications'}
          </p>
        </div>
        <div className="view-toggle">
          <Button title="Table view" aria-label="Table view" variant="ghost" size="icon"
            className={viewMode === 'table' ? 'selected' : ''} onClick={() => setViewMode('table')}>
            <List />
          </Button>
          <Button title="Grid view" aria-label="Grid view" variant="ghost" size="icon"
            className={viewMode === 'grid' ? 'selected' : ''} onClick={() => setViewMode('grid')}>
            <LayoutGrid />
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="filters">
        <label className="filter-search">
          <Search size={15} />
          <input
            aria-label="Search clusters"
            placeholder="Search cluster, application ID or representative..."
            value={query}
            onChange={e => { setQuery(e.target.value); setPage(1); }}
          />
        </label>
        <select className="filter-select" aria-label="Filter by county" value={county}
          onChange={e => { setCounty(e.target.value); setPage(1); }}>
          <option value="">All counties</option>
          {(meta?.counties ?? []).map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <select className="filter-select" aria-label="Filter by value chain" value={chain}
          onChange={e => { setChain(e.target.value); setPage(1); }}>
          <option value="">All value chains</option>
          {(meta?.chains ?? []).map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <select className="filter-select" aria-label="Sort clusters" value={sort}
          onChange={e => { setSort(e.target.value); setPage(1); }}>
          <option value="name">Name: A to Z</option>
          <option value="cost">Project cost: highest</option>
          <option value="grant">Matching grant: highest</option>
          <option value="members">Members: highest</option>
        </select>
        {(query || county || chain) && (
          <Button variant="ghost" size="icon" title="Clear filters" aria-label="Clear filters" onClick={clear}>
            <RotateCcw />
          </Button>
        )}
      </div>

      {/* Loading skeleton */}
      {isLoading ? (
        <div className="empty-state">
          <Loader2 size={30} className="animate-spin" />
          <p>Loading clusters...</p>
        </div>

      ) : rows.length === 0 ? (
        <div className="empty-state">
          <SearchX size={30} />
          <p>No clusters match these filters.</p>
          <Button className="mt-3" variant="outline" size="sm" onClick={clear}>Clear filters</Button>
        </div>

      ) : viewMode === 'table' ? (
        /* ── Table ── */
        <div className="fit-wrap">
          <table className="portfolio-table fit-table">
            <colgroup>
              <col style={{ width: '24%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '14%' }} />
              <col />
              <col style={{ width: 52 }} />
            </colgroup>
            <thead>
              <tr>
                <th>Cluster / application ID</th>
                <th>County &amp; value chain</th>
                <th>Project cost</th>
                <th>Matching grant / cluster cash</th>
                <th>Membership</th>
                <th aria-label="Profile" />
              </tr>
            </thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.application_number}>
                  <td>
                    <div className="cluster-cell">
                      <div className="cluster-monogram">
                        {c.cluster_name.split(' ').slice(0, 2).map(v => v[0]).join('').toUpperCase()}
                      </div>
                      <div className="cluster-name">
                        {c.cluster_name}
                        <span className="cluster-id">{c.application_number}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    {c.county}
                    <div className="mt-1.5">
                      <span className="badge" title={c.value_chain}>
                        {c.value_chain.length > 25 ? c.value_chain.slice(0, 23) + '…' : c.value_chain}
                      </span>
                    </div>
                  </td>
                  <td className="font-medium">
                    {money(Number(c.total_project_cost))}
                    <span className="muted-small">S5: {money(Number(c.section5_budget_total))}</span>
                  </td>
                  <td>
                    <SplitBar cluster={c} />
                    <span className="text-[9px] text-muted-foreground">
                      {Number(c.grant_share_pct).toFixed(1)}% / {Number(c.cluster_share_pct).toFixed(1)}%
                    </span>
                  </td>
                  <td className="font-medium">
                    {number(Number(c.total_members))}
                    <span className="muted-small">
                      {percent(Number(c.women), Number(c.total_members)).toFixed(1)}% women ·{' '}
                      {percent(Number(c.youth), Number(c.total_members)).toFixed(1)}% youth
                    </span>
                  </td>
                  <td>
                    <Button variant="ghost" size="icon"
                      aria-label={`View profile of ${c.cluster_name}`}
                      title="View full profile & financials"
                      onClick={() => onSelect(c.application_number)}>
                      <ArrowUpRight className="text-primary" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      ) : (
        /* ── Grid ── */
        <div className="cluster-grid">
          {rows.map(c => (
            <article className="cluster-card" key={c.application_number}>
              <h3>{c.cluster_name}</h3>
              <span className="cluster-id">{c.application_number}</span>
              <div className="card-location"><MapPin size={12} />{c.county} · {c.ward}</div>
              <span className="badge" title={c.value_chain}>
                {c.value_chain.length > 30 ? c.value_chain.slice(0, 28) + '…' : c.value_chain}
              </span>
              <div className="card-cost">
                {money(Number(c.total_project_cost))}
                <span className="muted-small">S5: {money(Number(c.section5_budget_total))}</span>
              </div>
              <SplitBar cluster={c} />
              <div className="flex justify-between text-[9px] text-muted-foreground">
                <span>{Number(c.grant_share_pct).toFixed(1)}% grant</span>
                <span>{Number(c.cluster_share_pct).toFixed(1)}% cash</span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-4">
                {number(Number(c.total_members))} members ·{' '}
                {percent(Number(c.women), Number(c.total_members)).toFixed(1)}% women ·{' '}
                {percent(Number(c.youth), Number(c.total_members)).toFixed(1)}% youth
              </p>
              <Button variant="outline" size="sm" className="mt-4 w-full"
                onClick={() => onSelect(c.application_number)}>
                View full profile <ArrowUpRight />
              </Button>
            </article>
          ))}
        </div>
      )}

      {/* Pagination */}
      <div className="table-footer">
        <span>
          {total > 0
            ? `Showing ${(page - 1) * PAGE_SIZE + 1} to ${Math.min(page * PAGE_SIZE, total)} of ${total} clusters`
            : '0 clusters'}
          {(county || chain || query) && ' · Filtered results'}
        </span>
        <div className="pagination">
          <Button variant="outline" size="icon" aria-label="Previous page"
            disabled={page <= 1} onClick={() => setPage(page - 1)}>
            <ChevronLeft />
          </Button>
          <span>{page} / {pageCount}</span>
          <Button variant="outline" size="icon" aria-label="Next page"
            disabled={page >= pageCount} onClick={() => setPage(page + 1)}>
            <ChevronRight />
          </Button>
        </div>
      </div>
    </section>
  );
}
