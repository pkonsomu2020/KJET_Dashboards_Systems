import { useQuery } from '@tanstack/react-query';
import {
  fetchPortfolioSummary,
  fetchByChain,
  fetchByCounty,
  fetchMeta,
  fetchClusters,
  fetchClusterDetail,
  type ClusterListParams,
} from '@/data/api';

// ── Portfolio-level queries ───────────────────────────────────

export function usePortfolioSummary() {
  return useQuery({
    queryKey: ['portfolio', 'summary'],
    queryFn: () => fetchPortfolioSummary().then(r => r.data),
    staleTime: 5 * 60 * 1000,   // 5 min — matches backend cache TTL
  });
}

export function useByChain() {
  return useQuery({
    queryKey: ['portfolio', 'by-chain'],
    queryFn: () => fetchByChain().then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });
}

export function useByCounty() {
  return useQuery({
    queryKey: ['portfolio', 'by-county'],
    queryFn: () => fetchByCounty().then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });
}

// ── Cluster list query ────────────────────────────────────────

export function useClusters(params: ClusterListParams) {
  return useQuery({
    queryKey: ['clusters', params],
    queryFn: () => fetchClusters(params),
    staleTime: 2 * 60 * 1000,   // 2 min
    placeholderData: (prev) => prev,  // keep previous data while refetching
  });
}

// ── Dropdown meta (counties + chains) ────────────────────────

export function useMeta() {
  return useQuery({
    queryKey: ['clusters', 'meta'],
    queryFn: fetchMeta,
    staleTime: 60 * 60 * 1000,   // 1 hour — rarely changes
  });
}

// ── Single cluster full profile ───────────────────────────────

export function useClusterDetail(applicationNumber: string | null) {
  return useQuery({
    queryKey: ['cluster', applicationNumber],
    queryFn: () => fetchClusterDetail(applicationNumber!).then(r => r.data),
    enabled: !!applicationNumber,   // only fetch when a cluster is selected
    staleTime: 10 * 60 * 1000,     // 10 min — matches backend cache TTL
  });
}
