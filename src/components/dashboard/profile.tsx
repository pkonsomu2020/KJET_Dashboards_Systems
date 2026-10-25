import { useState, type ElementType } from 'react';
import { ExternalLink, MapPin, ShieldCheck, AlertTriangle, Building2, Users, Briefcase, Wallet, Factory, Loader2, FolderOpen, FileText, Table, Image, File, RefreshCw, Award } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, PieChart, Pie, Cell } from 'recharts';
import { money, number, percent } from '@/data/portfolio';
import { useClusterDetail, useEvaluationList } from '@/hooks/usePortfolio';
import { useDriveFolder, useDriveFileContent } from '@/hooks/useDrive';
import type { ClusterRow } from '@/data/api';
import type { DriveFile } from '@/hooks/useDrive';
import { EvaluationTab } from './evaluation-tab';

const palette = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)'];

// SplitBar now works with both ClusterRow (explorer) and ClusterDetail (profile)
export function SplitBar({ cluster, large = false }: {
  cluster: Pick<ClusterRow, 'grant_requested' | 'cluster_contribution' | 'grant_share_pct' | 'cluster_share_pct'>;
  large?: boolean;
}) {
  const grant = Number(cluster.grant_requested);
  const cash  = Number(cluster.cluster_contribution);
  const total = grant + cash;
  const grantPct = total > 0 ? (grant / total) * 100 : 50;
  const cashPct  = 100 - grantPct;
  return (
    <div
      className={`split-track ${large ? 'financial-split' : ''}`}
      aria-label={`Grant ${Number(cluster.grant_share_pct).toFixed(1)}%, cluster cash ${Number(cluster.cluster_share_pct).toFixed(1)}%`}
    >
      <span className="grant" style={{ width: `${grantPct}%` }} />
      <span className="cash"  style={{ width: `${cashPct}%` }} />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div>
      <div className="detail-label">{label}</div>
      <div className="detail-value">{value || 'Not supplied'}</div>
    </div>
  );
}

function ProfileMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{money(value)}</div>
      <div className="metric-foot">{money(value, false)}</div>
    </div>
  );
}

interface Props {
  applicationNumber: string | null;
  onClose: () => void;
}

export function ClusterProfile({ applicationNumber, onClose }: Props) {
  const { data: cluster, isLoading } = useClusterDetail(applicationNumber);

  const isOpen = !!applicationNumber;

  if (!isOpen) return null;

  return (
    <Sheet open={isOpen} onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent className="profile-sheet">
        {isLoading || !cluster ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={32} className="animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ProfileContent cluster={cluster} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function ProfileContent({ cluster: c }: { cluster: NonNullable<ReturnType<typeof useClusterDetail>['data']> }) {
  // Drive folder — fetched live when drawer opens
  const { data: driveData, isLoading: driveLoading, refresh: refreshDrive } = useDriveFolder(c.application_number);
  const grantReq    = Number(c.grant_requested);
  const clusterCon  = Number(c.cluster_contribution);
  const projectCost = Number(c.total_project_cost);
  const section5    = Number(c.section5_budget_total);
  const grantPct    = Number(c.grant_share_pct);
  const cashPct     = Number(c.cluster_share_pct);
  const status      = c.compliance_status;

  const authorizedRep = c.contacts?.find(x => x.contact_type === 'authorized');
  const manager       = c.contacts?.find(x => x.contact_type === 'manager');

  const employment = [
    { name: 'Baseline', jobs: Number(c.jobs_today) },
    { name: 'Year 1',   jobs: Number(c.jobs_year1) },
    { name: 'Year 3',   jobs: Number(c.jobs_year3) },
  ];

  const costBreakdown = [
    { name: 'Machinery',         value: c.machinery?.reduce((s, m) => s + Number(m.total_cost_kes ?? 0), 0) ?? 0 },
    { name: 'Bundled services',  value: c.services?.reduce((s, s2) => s + Number(s2.total_cost_kes ?? 0), 0) ?? 0 },
    { name: 'Additional budget', value: Math.max(0, section5 - projectCost) },
  ];

  const tooltipStyle = { background: 'var(--card)', borderColor: 'var(--border)', borderRadius: 6 };
  const ev = useEvaluationList().data?.data.find((r) => r.application_number === c.application_number);

  return (
    <>
      <SheetHeader>
        <div className="badge w-fit">COHORT 1 CLUSTER PROFILE</div>
        <SheetTitle>{c.cluster_name}</SheetTitle>
        <SheetDescription>{c.application_number}</SheetDescription>
      </SheetHeader>

      <div className="profile-meta">
        <span className="badge"><MapPin size={11} />{c.county} · {c.constituency}</span>
        <span className="badge">{c.value_chain.length > 30 ? c.value_chain.slice(0, 28) + '...' : c.value_chain}</span>
        <span className={`badge ${status === 'Within limits' ? 'success' : 'warning'}`}>
          {status === 'Within limits' ? <ShieldCheck size={11} /> : <AlertTriangle size={11} />} {status}
        </span>
        {ev?.grant_ready && <span className="badge success"><Award size={11} />Grant-ready #{ev.grant_ready_rank}</span>}
        {ev && !ev.grant_ready && ev.score != null && <span className="badge">Evaluation score {Math.round(ev.score)}</span>}
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="profile-tabs">
          <TabsTrigger value="overview"><Building2 size={13} className="mr-1.5" />Overview</TabsTrigger>
          <TabsTrigger value="evaluation"><Award size={13} className="mr-1.5" />Evaluation</TabsTrigger>
          <TabsTrigger value="financials"><Wallet size={13} className="mr-1.5" />Financials</TabsTrigger>
          <TabsTrigger value="machinery"><Factory size={13} className="mr-1.5" />Machinery</TabsTrigger>
          <TabsTrigger value="inclusion"><Users size={13} className="mr-1.5" />Inclusion</TabsTrigger>
          <TabsTrigger value="governance"><ShieldCheck size={13} className="mr-1.5" />Governance</TabsTrigger>
          <TabsTrigger value="documents"><FolderOpen size={13} className="mr-1.5" />Documents</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview">
          <section className="profile-section">
            <h3>Enterprise identity</h3>
            <div className="detail-grid">
              <Detail label="Legal form"          value={c.legal_form} />
              <Detail label="Registration date"   value={c.registration_date} />
              <Detail label="County"              value={c.county} />
              <Detail label="Constituency"        value={c.constituency} />
              <Detail label="Ward"                value={c.ward} />
              <Detail label="Physical address"    value={c.physical_address} />
              <Detail label="Value chain"         value={c.value_chain} />
              <Detail label="Application status"  value={c.status} />
            </div>
          </section>

          {(c.vision || c.mission) && (
            <section className="profile-section">
              <h3>Vision &amp; mission</h3>
              {c.vision  && <><div className="detail-label">Vision</div><p>{c.vision}</p></>}
              {c.mission && <><div className="detail-label mt-3">Mission</div><p>{c.mission}</p></>}
            </section>
          )}

          <section className="profile-section">
            <h3>Business model &amp; operations</h3>
            <p>{c.business?.business_description ?? c.business_description ?? 'Not supplied'}</p>
          </section>

          <section className="profile-section">
            <h3>Employment outlook</h3>
            <div className="profile-job-grid">
              {employment.map(v => (
                <div key={v.name}><strong>{number(v.jobs)}</strong><span>{v.name} jobs</span></div>
              ))}
            </div>
            <div className="chart-box">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={employment}>
                  <XAxis dataKey="name" axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={v => number(v)} axisLine={false} tickLine={false} />
                  <Tooltip formatter={v => number(Number(v))} contentStyle={tooltipStyle} />
                  <Bar dataKey="jobs" fill="var(--primary)" radius={[4, 4, 0, 0]} barSize={55} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p>Employment figures are applicant-reported projections, not verified jobs created.</p>
          </section>
        </TabsContent>

        {/* Evaluation (scores and decisions from the evaluation workbook) */}
        <TabsContent value="evaluation"><EvaluationTab applicationNumber={c.application_number} /></TabsContent>

        {/* Financials */}
        <TabsContent value="financials">
          <div className="profile-metrics">
            <ProfileMetric label="Eligible project cost"   value={projectCost} />
            <ProfileMetric label="Section 5 total budget"  value={section5} />
            <ProfileMetric label="KJET grant requested"    value={grantReq} />
            <ProfileMetric label="Cluster cash contribution" value={clusterCon} />
          </div>

          <section className="profile-section">
            <h3>Co-investment matching structure</h3>
            <SplitBar cluster={c} large />
            <div className="flex justify-between text-xs">
              <span className="text-primary">Grant: {grantPct.toFixed(1)}%</span>
              <span className="text-muted-foreground">Cluster cash: {cashPct.toFixed(1)}%</span>
            </div>
            <div className={`notice ${status === 'Within limits' ? 'bg-success-soft text-success' : ''}`}>
              <AlertTriangle size={16} />
              <div>
                <strong>{status}</strong><br />
                Grant must not exceed 50% of eligible costs or KES 32M. Cluster cash must be at least 50%.
              </div>
            </div>
            {Math.abs(grantReq + clusterCon - projectCost) > 0.01 && (
              <div className="notice">
                <AlertTriangle size={16} />
                <span>Grant plus cluster contribution differs from eligible project cost by {money(grantReq + clusterCon - projectCost, false)}. Source values retained as submitted.</span>
              </div>
            )}
          </section>

          {c.pl && c.pl.length > 0 && (
            <section className="profile-section">
              <h3>Revenue projections (with grant)</h3>
              <div className="detail-grid">
                {c.pl.map(row => (
                  <div key={row.year}>
                    <div className="detail-label">Year {row.year} revenue</div>
                    <div className="detail-value">{money(Number(row.revenue_with))}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {(c.impact?.sales_uplift_y1_revenue) && (
            <section className="profile-section">
              <h3>Sales uplift &amp; viability</h3>
              <div className="detail-grid">
                <Detail label="NPV"            value={money(Number(c.npv_kes ?? 0))} />
                <Detail label="IRR"            value={c.irr_pct ? `${c.irr_pct}%` : null} />
                <Detail label="Payback period" value={c.payback_period_years ? `${c.payback_period_years} years` : null} />
              </div>
            </section>
          )}

          <section className="profile-section">
            <h3>Budget composition</h3>
            <div className="chart-box">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={costBreakdown} layout="vertical" margin={{ left: 25, right: 30 }}>
                  <XAxis type="number" tickFormatter={v => `${(v / 1e6).toFixed(0)}M`} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={115} axisLine={false} tickLine={false} />
                  <Tooltip formatter={v => money(Number(v), false)} contentStyle={tooltipStyle} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={26}>
                    {costBreakdown.map((v, i) => <Cell key={v.name} fill={palette[i]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </TabsContent>

        {/* Machinery */}
        <TabsContent value="machinery">
          <section className="profile-section">
            <h3>Proposed machinery &amp; equipment</h3>
            {c.machinery && c.machinery.length > 0 ? (
              <ul className="equipment-list">
                {c.machinery.map((item, i) => (
                  <li key={i}>
                    {item.description}
                    {item.quantity && ` x ${item.quantity}`}
                    {Number(item.unit_cost_kes) > 0 && ` · ${money(Number(item.unit_cost_kes), false)}`}
                  </li>
                ))}
              </ul>
            ) : <p>Not supplied</p>}
          </section>

          <section className="profile-section">
            <h3>Operational bottlenecks</h3>
            <p>{c.business?.investment_needs ?? c.investment_needs ?? 'Not supplied'}</p>
          </section>

          {c.services && c.services.length > 0 && c.services[0]?.description && (
            <section className="profile-section">
              <h3>Bundled technical services</h3>
              <ul className="equipment-list">
                {c.services.filter(s => s.description).map((s, i) => <li key={i}>{s.description}</li>)}
              </ul>
            </section>
          )}

          <section className="profile-section">
            <h3>Machinery source</h3>
            <p>{c.machinery_source ?? 'Not supplied'}</p>
          </section>

          <section className="profile-section">
            <h3>Delivery &amp; commissioning timeline</h3>
            <p>{c.lead_time ?? 'Not supplied'}</p>
          </section>

          {c.impact && (
            <section className="profile-section">
              <h3>Expected operational impact</h3>
              <div className="detail-grid">
                <Detail label="Daily output today"  value={c.impact.daily_output_today ? `${number(Number(c.impact.daily_output_today))} units` : null} />
                <Detail label="Daily output after"  value={c.impact.daily_output_after ? `${number(Number(c.impact.daily_output_after))} units (+${Number(c.impact.daily_output_pct).toFixed(1)}%)` : null} />
                <Detail label="Reject rate today"   value={c.impact.reject_rate_today ? `${c.impact.reject_rate_today}%` : null} />
                <Detail label="Reject rate after"   value={c.impact.reject_rate_after  ? `${c.impact.reject_rate_after}%` : null} />
              </div>
            </section>
          )}
        </TabsContent>

        {/* Inclusion */}
        <TabsContent value="inclusion">
          <section className="profile-section">
            <h3>Membership &amp; representation</h3>
            <div className="detail-grid">
              <Detail label="Total registered members" value={number(Number(c.total_members))} />
              <Detail label="Men"    value={`${number(Number(c.men))} (${percent(Number(c.men), Number(c.total_members)).toFixed(1)}%)`} />
              <Detail label="Women"  value={`${number(Number(c.women))} (${percent(Number(c.women), Number(c.total_members)).toFixed(1)}%)`} />
              <Detail label="Youth"  value={`${number(Number(c.youth))} (${percent(Number(c.youth), Number(c.total_members)).toFixed(1)}%)`} />
              <Detail label="Persons with disabilities" value={`${number(Number(c.pwd))} (${percent(Number(c.pwd), Number(c.total_members)).toFixed(2)}%)`} />
            </div>

            <div className="chart-box">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={[{ name: 'Men', value: Number(c.men) }, { name: 'Women', value: Number(c.women) }]}
                    innerRadius={65} outerRadius={90} dataKey="value" paddingAngle={3} stroke="none"
                  >
                    <Cell fill={palette[1]} /><Cell fill={palette[0]} />
                  </Pie>
                  <Tooltip formatter={v => number(Number(v))} contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="chart-legend justify-center">
              <span><i className="legend-dot" />Women</span>
              <span><i className="legend-dot secondary" />Men</span>
            </div>

            {c.impact && (
              <>
                <h3 className="mt-5">Employment by gender &amp; age (projections)</h3>
                <div className="detail-grid mt-3">
                  <Detail label="Women jobs today / Y1 / Y3" value={`${c.impact.jobs_women_today} / ${c.impact.jobs_women_year1} / ${c.impact.jobs_women_year3}`} />
                  <Detail label="Youth jobs today / Y1 / Y3" value={`${c.impact.jobs_youth_today} / ${c.impact.jobs_youth_year1} / ${c.impact.jobs_youth_year3}`} />
                  <Detail label="PWD jobs today / Y1 / Y3"   value={`${c.impact.jobs_pwd_today} / ${c.impact.jobs_pwd_year1} / ${c.impact.jobs_pwd_year3}`} />
                  <Detail label="Avg income today / Y1 / Y3 (KES)" value={`${money(Number(c.impact.income_today), false)} / ${money(Number(c.impact.income_year1), false)} / ${money(Number(c.impact.income_year3), false)}`} />
                </div>
              </>
            )}

            <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
              Youth and PWD membership overlaps with gender categories and is not added to the gender total. No inclusion target was supplied, so inclusion compliance is not assessed.
            </p>
          </section>
        </TabsContent>

        {/* Governance */}
        <TabsContent value="governance">
          <section className="profile-section">
            <h3>Authorized representative</h3>
            <div className="detail-grid">
              <Detail label="Full name"         value={authorizedRep?.full_name ?? c.governance_rep_name} />
              <Detail label="Official position" value={authorizedRep?.position ?? c.governance_rep_position} />
              <div>
                <div className="detail-label">Phone</div>
                <a className="detail-value text-primary" href={`tel:${authorizedRep?.phone}`}>
                  {authorizedRep?.phone || 'Not supplied'}
                </a>
              </div>
              <div>
                <div className="detail-label">Email</div>
                <a className="detail-value text-primary" href={`mailto:${authorizedRep?.email}`}>
                  {authorizedRep?.email || 'Not supplied'}
                </a>
              </div>
            </div>
          </section>

          {manager && (
            <section className="profile-section">
              <h3>Project manager</h3>
              <div className="detail-grid">
                <Detail label="Full name" value={manager.full_name} />
                <Detail label="Position"  value={manager.position} />
                <div>
                  <div className="detail-label">Phone</div>
                  <a className="detail-value text-primary" href={`tel:${manager.phone}`}>{manager.phone || 'Not supplied'}</a>
                </div>
                <div>
                  <div className="detail-label">Email</div>
                  <a className="detail-value text-primary" href={`mailto:${manager.email}`}>{manager.email || 'Not supplied'}</a>
                </div>
              </div>
            </section>
          )}

          <section className="profile-section">
            <h3>Project banking details</h3>
            <div className="detail-grid">
              <Detail label="Bank / branch"  value={c.banking?.bank_name} />
              <Detail label="Account number" value={c.banking?.bank_account} />
            </div>
          </section>

          {c.prior_funding && (
            <section className="profile-section">
              <h3>Prior funding disclosure</h3>
              <p>{c.prior_funding}</p>
            </section>
          )}

          <section className="profile-section">
            <h3>Application attachment bundle</h3>
            <p className="mb-4">
              Source-linked application documents, certificates, quotations, technical specifications and declarations.
              Document availability and verification are not independently confirmed.
            </p>
            {c.google_drive_folder?.startsWith('https://drive.google.com/') ? (
              <Button asChild>
                <a href={c.google_drive_folder} target="_blank" rel="noopener noreferrer">
                  <ExternalLink />Open Google Drive bundle
                </a>
              </Button>
            ) : (
              <p>No valid Google Drive link supplied.</p>
            )}
          </section>
        </TabsContent>

        {/* Documents — live from Google Drive */}
        <TabsContent value="documents">
          <section className="profile-section">
            <div className="flex items-center justify-between mb-4">
              <h3 style={{ marginBottom: 0 }}>Verification bundle</h3>
              <div className="flex items-center gap-2">
                {driveData?.driveEnabled && (
                  <Button variant="ghost" size="sm" onClick={refreshDrive} title="Refresh files from Drive">
                    <RefreshCw size={13} className={driveLoading ? 'animate-spin' : ''} />Refresh
                  </Button>
                )}
                {c.google_drive_folder?.startsWith('https://drive.google.com/') && (
                  <Button asChild size="sm" variant="outline">
                    <a href={c.google_drive_folder} target="_blank" rel="noopener noreferrer">
                      <ExternalLink size={13} />Open in Drive
                    </a>
                  </Button>
                )}
              </div>
            </div>

            {!driveData?.driveEnabled && (
              <div className="notice">
                <FolderOpen size={15} />
                <div>
                  <strong>Google Drive API not yet configured.</strong><br />
                  Files update automatically once the service account is connected. For now, open the folder directly.
                  {c.google_drive_folder?.startsWith('https://drive.google.com/') && (
                    <div className="mt-3">
                      <Button asChild>
                        <a href={c.google_drive_folder} target="_blank" rel="noopener noreferrer">
                          <ExternalLink />Open verified Google Drive bundle
                        </a>
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {driveData?.driveEnabled && driveLoading && (
              <div className="flex items-center gap-3 py-8 text-muted-foreground text-xs">
                <Loader2 size={18} className="animate-spin" />Fetching files from Google Drive...
              </div>
            )}

            {driveData?.driveEnabled && !driveLoading && driveData.sections.length === 0 && (
              <div className="notice">
                <FolderOpen size={15} />
                <span>No files found in this Drive folder yet.</span>
              </div>
            )}

            {driveData?.driveEnabled && !driveLoading && driveData.sections.map(section => (
              <div key={section.folderId} className="mb-5">
                <div className="detail-label mb-2 flex items-center gap-2">
                  <FolderOpen size={11} />{section.sectionName}
                  <span className="text-muted-foreground">({section.files.length} files)</span>
                </div>
                <div className="space-y-2">
                  {section.files.map(f => <DriveFileRow key={f.id} file={f} />)}
                </div>
              </div>
            ))}

            {driveData?.fetchedAt && (
              <p className="text-[10px] text-muted-foreground mt-4">
                Fetched: {new Date(driveData.fetchedAt).toLocaleTimeString('en-KE', { timeZone: 'Africa/Nairobi' })} EAT
                {driveData.driveEnabled && ' · Refreshes within 30 seconds of Drive changes'}
              </p>
            )}
          </section>
        </TabsContent>
      </Tabs>

      <div className="border-t border-border pt-4 text-[10px] text-muted-foreground flex items-center gap-2">
        <Briefcase size={12} />MSEA · KJET Component 2 · Source application data
      </div>
    </>
  );
}

// ── Drive file row component with inline document content reader ─
const FILE_ICONS: Record<string, ElementType> = {
  'file-text': FileText,
  'table':     Table,
  'image':     Image,
  'folder':    FolderOpen,
  'file':      File,
};

function DriveFileRow({ file }: { file: DriveFile }) {
  const [openContent, setOpenContent] = useState(false);
  const { data: content, isLoading: reading, error: readError } = useDriveFileContent(openContent ? file.id : null);

  const Icon = FILE_ICONS[file.icon] ?? File;
  const modified = file.modifiedTime
    ? new Date(file.modifiedTime).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })
    : null;
  const isReadable = file.readable ?? ['PDF', 'Excel', 'CSV', 'Word', 'Google Doc', 'Google Sheet', 'Text', 'JSON'].includes(file.type);

  return (
    <div className="border-b border-border last:border-0 py-2 text-xs">
      <div className="flex items-center gap-3">
        <Icon size={14} className="text-primary flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate" title={file.name}>{file.name}</div>
          <div className="text-muted-foreground flex gap-2 mt-0.5">
            <span>{file.type}</span>
            {file.size && <span>· {file.size}</span>}
            {modified && <span>· {modified}</span>}
          </div>
        </div>
        {isReadable && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setOpenContent(v => !v)}
          >
            {openContent ? 'Hide content' : 'Read content'}
          </Button>
        )}
        <a
          href={file.viewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0 text-primary hover:underline flex items-center gap-1"
          title="Open in Google Drive"
        >
          <ExternalLink size={12} />View
        </a>
      </div>

      {openContent && (
        <div className="mt-2 rounded-md border border-border bg-background p-3">
          {reading && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 size={14} className="animate-spin" />Reading document contents from Google Drive...
            </div>
          )}
          {readError && (
            <div className="text-warning">
              Could not read document contents. Open directly in Google Drive.
            </div>
          )}
          {!reading && content && (
            <div className="space-y-3 max-h-[300px] overflow-auto">
              {content.sheets && content.sheets.length > 0 ? (
                content.sheets.map(sheet => (
                  <div key={sheet.name}>
                    <div className="font-semibold text-[11px] mb-1 text-primary">{sheet.name}</div>
                    <div className="overflow-x-auto">
                      <table className="portfolio-table text-[11px]">
                        <tbody>
                          {sheet.rows.slice(0, 50).map((row, rIdx) => (
                            <tr key={rIdx}>
                              {row.map((cell, cIdx) => (
                                <td key={cIdx} style={{ padding: '5px 8px' }}>{cell}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))
              ) : content.text ? (
                <pre className="whitespace-pre-wrap font-sans text-[11px] leading-relaxed text-foreground">
                  {content.text}
                </pre>
              ) : (
                <div className="text-muted-foreground">No extractable text found in this file.</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

