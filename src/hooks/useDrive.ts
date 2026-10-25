import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

const BASE = (import.meta.env['VITE_API_URL'] as string | undefined) ?? 'http://localhost:4000';

// ── Types ─────────────────────────────────────────────────────

export interface DriveFile {
  id:           string;
  name:         string;
  mimeType:     string;
  type:         string;
  icon:         string;
  readable?:    boolean;
  size:         string | null;
  modifiedTime: string;
  viewUrl:      string;
  downloadUrl:  string | null;
  thumbnail:    string | null;
  isFolder:     boolean;
}

export interface DriveSection {
  sectionName: string;
  folderId:    string;
  files:       DriveFile[];
}

export interface DriveFolderResponse {
  ok:           boolean;
  clusterName:  string;
  folderUrl:    string;
  folderId:     string | null;
  sections:     DriveSection[];
  driveEnabled: boolean;
  fetchedAt:    string;
  message?:     string;
}

export interface DriveFileSheet {
  name: string;
  rows: string[][];
}

export interface DriveFileContent {
  id:           string;
  name:         string;
  mimeType:     string;
  type:         string;
  size:         string | null;
  modifiedTime: string;
  viewUrl:      string;
  text:         string;
  sheets:       DriveFileSheet[];
  keyValues:    Record<string, string>;
  fetchedAt:    string;
}

// ── Fetch helpers ─────────────────────────────────────────────

async function fetchDriveFolder(applicationNumber: string, refresh = false): Promise<DriveFolderResponse> {
  const url = `${BASE}/api/drive/folder/${applicationNumber}${refresh ? '?refresh=true' : ''}`;
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`Drive fetch error ${res.status}`);
  return res.json();
}

async function fetchDriveFileContent(fileId: string, refresh = false): Promise<DriveFileContent> {
  const url = `${BASE}/api/drive/file/${fileId}/content${refresh ? '?refresh=true' : ''}`;
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`Drive file read error ${res.status}`);
  const body = (await res.json()) as { ok: boolean; data: DriveFileContent };
  return body.data;
}

// ── useDriveFolder — fetches recursive file listing for a cluster ─
export function useDriveFolder(applicationNumber: string | null) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey:  ['drive', 'folder', applicationNumber],
    queryFn:   () => fetchDriveFolder(applicationNumber!),
    enabled:   !!applicationNumber,
    staleTime: 25_000,   // matches backend cache TTL (25s)
    refetchOnWindowFocus: false,
  });

  // Force-refresh folder, re-parse all documents, and refresh cluster/portfolio data
  const refresh = async () => {
    if (!applicationNumber) return;
    const fresh = await fetchDriveFolder(applicationNumber, true);
    queryClient.setQueryData(['drive', 'folder', applicationNumber], fresh);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['cluster', applicationNumber] }),
      queryClient.invalidateQueries({ queryKey: ['clusters'] }),
      queryClient.invalidateQueries({ queryKey: ['portfolio'] }),
    ]);
  };

  return { ...query, refresh };
}

// ── useDriveFileContent — reads & parses full content of a single Drive file ─
export function useDriveFileContent(fileId: string | null) {
  return useQuery({
    queryKey:  ['drive', 'file-content', fileId],
    queryFn:   () => fetchDriveFileContent(fileId!),
    enabled:   !!fileId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

// ── useDriveEvents — SSE listener for real-time Drive changes ─
// Connects once per app session. When Drive detects a file change,
// the backend re-parses the affected cluster's documents, updates PostgreSQL,
// and pushes the affected folder IDs & application numbers via SSE.
export function useDriveEvents() {
  const queryClient = useQueryClient();
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (esRef.current) return;   // already connected

    const es = new EventSource(`${BASE}/api/drive/events`, { withCredentials: true });
    esRef.current = es;

    es.onopen = () => console.log('[Drive SSE] Connected');

    es.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data) as {
          type: string;
          folderIds?: string[];
          applicationNumbers?: string[];
        };

        if (msg.type === 'evaluation:change') {
          // the online evaluation sheet was updated: reload every evaluation screen and the cluster list
          queryClient.invalidateQueries({ queryKey: ['evaluation'] });
          queryClient.invalidateQueries({ queryKey: ['clusters'] });
          return;
        }
        if (msg.type !== 'drive:change') return;

        console.log('[Drive SSE] Change detected:', msg);

        const changedFolderIds = new Set(msg.folderIds ?? []);
        const changedApps = new Set(msg.applicationNumbers ?? []);

        const cache = queryClient.getQueryCache();
        cache.getAll().forEach(query => {
          const [prefix, , appNum] = query.queryKey as string[];
          if (prefix !== 'drive' || !appNum) return;
          const data = query.state.data as DriveFolderResponse | undefined;
          const matchesApp = changedApps.has(appNum);
          const matchesRoot = data?.folderId ? changedFolderIds.has(data.folderId) : false;
          const matchesSubfolder = data?.sections?.some(s => changedFolderIds.has(s.folderId)) ?? false;
          if (matchesApp || matchesRoot || matchesSubfolder) {
            queryClient.invalidateQueries({ queryKey: ['drive', 'folder', appNum] });
          }
        });

        // Also invalidate portfolio KPIs, cluster list, and open cluster details
        queryClient.invalidateQueries({ queryKey: ['portfolio'] });
        queryClient.invalidateQueries({ queryKey: ['clusters'] });
        for (const appNum of changedApps) {
          queryClient.invalidateQueries({ queryKey: ['cluster', appNum] });
        }
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      console.warn('[Drive SSE] Connection lost — will retry automatically');
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [queryClient]);
}
