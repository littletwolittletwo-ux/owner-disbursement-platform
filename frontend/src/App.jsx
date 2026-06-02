import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Building2, Calculator, ChevronDown, ChevronUp, DollarSign, Download, FileText, Link2, Mail, RefreshCcw, Settings, Upload, WalletCards, X } from 'lucide-react';
import './main.css';

const API = import.meta.env.VITE_API_URL || '';

// ── Helpers ──

function useApi(path, fallback) {
  const [data, setData] = useState(fallback);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API}${path}`);
      if (response.ok) setData(await response.json());
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => { load(); }, [load]);
  return { data, setData, loading, reload: load };
}

async function post(path, body) {
  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error((await response.json()).error || 'Request failed');
  return response.json();
}

async function put(path, body) {
  const response = await fetch(`${API}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error((await response.json()).error || 'Request failed');
  return response.json();
}

function money(value) {
  const num = Number(value || 0);
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(num);
}

function formatCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return money(value);
  if (typeof value === 'string' && /^\d+\.\d{2}$/.test(value)) return money(value);
  return String(value);
}

function emptyDashboard() {
  return { trustSummary: [], reservationLedger: [], ownerSummaries: [], unmatchedPayments: [], pendingPayouts: [], totals: {} };
}

// ── Reusable Components ──

function Metric({ title, value, icon, accent }) {
  return <div className="rounded-lg border bg-white p-4 shadow-sm">
    <div className="flex items-center justify-between text-slate-500 text-xs uppercase tracking-wide">{title}<span className={accent ? 'text-gold' : 'text-navy'}>{React.cloneElement(icon, { className: 'h-5 w-5' })}</span></div>
    <div className="mt-2 text-2xl font-bold text-navy">{value}</div>
  </div>;
}

function Panel({ title, children, actions }) {
  return <div className="rounded-lg border bg-white p-5 shadow-sm">
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-navy">{title}</h2>
      {actions}
    </div>
    {children}
  </div>;
}

function Input({ value, onChange, placeholder, type = 'text', className = '' }) {
  return <input className={`w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold ${className}`} type={type} required placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />;
}

function Uploader({ label, type, onUpload }) {
  return <label className="mb-2 flex cursor-pointer items-center justify-between rounded border border-dashed border-slate-300 px-3 py-2.5 text-sm text-slate-600 hover:border-gold hover:bg-gold/5 transition-colors">
    <span><Upload className="mr-2 inline h-4 w-4 text-gold" />{label}</span>
    <input className="hidden" type="file" accept=".csv,.xlsx,.xls,.pdf" onChange={(e) => e.target.files?.[0] && onUpload(type, e.target.files[0])} />
    <span className="text-xs text-slate-400">CSV/XLSX/PDF</span>
  </label>;
}

function DataTable({ rows, columns, maxRows = 50, onRowClick }) {
  const visibleRows = useMemo(() => rows.slice(0, maxRows), [rows, maxRows]);
  if (!rows.length) return <p className="text-sm text-slate-400 py-2">No records.</p>;
  return <div className="overflow-x-auto">
    <table className="min-w-full text-left text-sm">
      <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
        <tr>{columns.map((col) => <th key={col.key || col} className="whitespace-nowrap px-3 py-2">{(col.label || col).replaceAll('_', ' ')}</th>)}</tr>
      </thead>
      <tbody>
        {visibleRows.map((row, i) => <tr key={row.id || i} className={`border-b last:border-0 hover:bg-slate-50 ${onRowClick ? 'cursor-pointer' : ''}`} onClick={() => onRowClick?.(row)}>
          {columns.map((col) => {
            const key = col.key || col;
            return <td key={key} className="max-w-xs truncate px-3 py-2">{formatCell(row[key])}</td>;
          })}
        </tr>)}
      </tbody>
    </table>
    {rows.length > maxRows && <p className="mt-2 text-xs text-slate-400 text-center">Showing {maxRows} of {rows.length} rows</p>}
  </div>;
}

function Modal({ title, open, onClose, children }) {
  if (!open) return null;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
    <div className="mx-4 max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between border-b px-5 py-4">
        <h3 className="text-lg font-semibold text-navy">{title}</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
      </div>
      <div className="p-5">{children}</div>
    </div>
  </div>;
}

// ── Main App ──

function App() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [tab, setTab] = useState('dashboard');
  const owners = useApi('/api/owners', []);
  const listings = useApi('/api/listings', []);
  const dashboard = useApi(`/api/dashboard/${month}`, emptyDashboard());
  const commissionRules = useApi('/api/commission-rules', []);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('info');
  const [calculating, setCalculating] = useState(false);

  // Forms
  const [ownerForm, setOwnerForm] = useState({ name: '', email: '', phone: '' });
  const [listingForm, setListingForm] = useState({ owner_id: '', name: '', address: '', airbnb_listing_id: '', booking_property_id: '', vrbo_id: '', hostaway_listing_id: '' });
  const [commissionForm, setCommissionForm] = useState({ owner_id: '', platform: 'all', type: 'au_management', rate: '0.18' });

  // Modals
  const [showManualMatch, setShowManualMatch] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [matchCandidates, setMatchCandidates] = useState([]);
  const [showPdfPreview, setShowPdfPreview] = useState(null);
  const [showTrustConfig, setShowTrustConfig] = useState(false);
  const [trustConfig, setTrustConfig] = useState({ bsb: '', account_number: '', account_name: 'LiveLuxe Trust Account', bank_name: 'NAB', financial_institution_code: 'NAB', apca_user_id: '000000' });
  const [sidebarSection, setSidebarSection] = useState('registry');

  const ownerOptions = owners.data || [];

  function flash(msg, type = 'info') {
    setMessage(msg);
    setMessageType(type);
    setTimeout(() => setMessage(''), 5000);
  }

  async function createOwner(event) {
    event.preventDefault();
    try {
      await post('/api/owners', { ...ownerForm, banking_details: {} });
      setOwnerForm({ name: '', email: '', phone: '' });
      owners.reload();
      flash('Owner created', 'success');
    } catch (e) { flash(e.message, 'error'); }
  }

  async function createListing(event) {
    event.preventDefault();
    try {
      await post('/api/listings', {
        ...listingForm,
        platform_fee_rates: { airbnb: 0.165, 'booking.com': 0.165, vrbo: 0.12, direct: 0 },
        monthly_software_fee: 65.99
      });
      setListingForm({ owner_id: '', name: '', address: '', airbnb_listing_id: '', booking_property_id: '', vrbo_id: '', hostaway_listing_id: '' });
      listings.reload();
      flash('Listing created', 'success');
    } catch (e) { flash(e.message, 'error'); }
  }

  async function createCommissionRule(event) {
    event.preventDefault();
    try {
      await post('/api/commission-rules', {
        ...commissionForm,
        rate: Number(commissionForm.rate),
        listing_id: commissionForm.listing_id || null
      });
      commissionRules.reload();
      flash('Commission rule saved', 'success');
    } catch (e) { flash(e.message, 'error'); }
  }

  async function calculateAll() {
    const targets = ownerOptions.length ? ownerOptions : [];
    setCalculating(true);
    try {
      let count = 0;
      for (const owner of targets) {
        try {
          await post(`/api/disbursements/${month}/${owner.id}/calculate`, {});
          count++;
        } catch (e) { /* skip owners with no bookings */ }
      }
      dashboard.reload();
      flash(`Calculated disbursements for ${count} owners`, 'success');
    } catch (e) { flash(e.message, 'error'); }
    setCalculating(false);
  }

  async function uploadFile(type, file) {
    const form = new FormData();
    form.append('file', file);
    try {
      const response = await fetch(`${API}/api/uploads/${type}`, { method: 'POST', body: form });
      const json = await response.json();
      flash(`${type} upload: processed ${json.rows || 0} rows`, 'success');
      dashboard.reload();
    } catch (e) { flash(e.message, 'error'); }
  }

  async function syncHostaway() {
    try {
      const result = await post('/api/hostaway/sync', {});
      flash(result.skipped ? result.reason : `Synced ${result.reservations} Hostaway reservations`, result.skipped ? 'error' : 'success');
      dashboard.reload();
    } catch (e) { flash(e.message, 'error'); }
  }

  async function sendEmails() {
    try {
      const result = await post(`/api/emails/${month}/send`, {});
      flash(`Email action logged for ${result.length} disbursements`, 'success');
    } catch (e) { flash(e.message, 'error'); }
  }

  async function downloadAba() {
    try {
      const response = await fetch(`${API}/api/aba/${month}`);
      if (!response.ok) {
        const err = await response.json();
        flash(err.error || 'ABA export failed', 'error');
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `owner-payouts-${month}.aba`;
      a.click();
      URL.revokeObjectURL(url);
      flash('ABA file downloaded', 'success');
    } catch (e) { flash(e.message, 'error'); }
  }

  async function openManualMatch(tx) {
    setSelectedTransaction(tx);
    setShowManualMatch(true);
    try {
      const response = await fetch(`${API}/api/reconcile/unmatched-candidates/${tx.id}`);
      setMatchCandidates(await response.json());
    } catch (e) { setMatchCandidates([]); }
  }

  async function doManualMatch(reservationId) {
    try {
      await post('/api/reconcile/manual-match', { trust_transaction_id: selectedTransaction.id, reservation_id: reservationId });
      flash('Transaction matched', 'success');
      setShowManualMatch(false);
      dashboard.reload();
    } catch (e) { flash(e.message, 'error'); }
  }

  async function previewPdf(disbursementId) {
    try {
      const response = await fetch(`${API}/api/disbursements/${disbursementId}/pdf`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setShowPdfPreview(url);
    } catch (e) { flash(e.message, 'error'); }
  }

  async function loadTrustConfig() {
    try {
      const response = await fetch(`${API}/api/trust-account-config`);
      const data = await response.json();
      if (data) setTrustConfig(data);
      setShowTrustConfig(true);
    } catch (e) { setShowTrustConfig(true); }
  }

  async function saveTrustConfig(e) {
    e.preventDefault();
    try {
      await put('/api/trust-account-config', trustConfig);
      flash('Trust account config saved', 'success');
      setShowTrustConfig(false);
    } catch (e) { flash(e.message, 'error'); }
  }

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: <WalletCards className="h-4 w-4" /> },
    { id: 'setup', label: 'Setup', icon: <Settings className="h-4 w-4" /> },
  ];

  return (
    <main className="min-h-screen">
      {/* Header */}
      <header className="bg-navy text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              <span className="text-gold">LiveLuxe</span> Owner Disbursements
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">Trust reconciliation, owner payouts & ABA export</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex bg-navy/50 rounded overflow-hidden border border-slate-600">
              {tabs.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${tab === t.id ? 'bg-gold text-ink' : 'text-slate-300 hover:text-white'}`}>
                  {t.icon}{t.label}
                </button>
              ))}
            </div>
            <input className="rounded border border-slate-500 bg-slate-800 px-3 py-1.5 text-sm text-white" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            <button className="rounded bg-gold px-4 py-1.5 text-sm font-semibold text-ink hover:bg-gold/90 transition-colors disabled:opacity-50" onClick={calculateAll} disabled={calculating}>
              <Calculator className="mr-1.5 inline h-4 w-4" />{calculating ? 'Calculating...' : 'Calculate'}
            </button>
          </div>
        </div>
      </header>

      {/* Flash Message */}
      {message && (
        <div className={`mx-auto max-w-7xl px-6 pt-3`}>
          <div className={`rounded px-4 py-2 text-sm ${messageType === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : messageType === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-blue-50 text-blue-700 border border-blue-200'}`}>
            {message}
          </div>
        </div>
      )}

      {tab === 'dashboard' && <DashboardView
        month={month} dashboard={dashboard} owners={ownerOptions}
        uploadFile={uploadFile} syncHostaway={syncHostaway} sendEmails={sendEmails}
        downloadAba={downloadAba} openManualMatch={openManualMatch} previewPdf={previewPdf}
        loadTrustConfig={loadTrustConfig} flash={flash}
        sidebarSection={sidebarSection} setSidebarSection={setSidebarSection}
      />}

      {tab === 'setup' && <SetupView
        owners={ownerOptions} listings={listings.data || []}
        ownerForm={ownerForm} setOwnerForm={setOwnerForm} createOwner={createOwner}
        listingForm={listingForm} setListingForm={setListingForm} createListing={createListing}
        commissionForm={commissionForm} setCommissionForm={setCommissionForm} createCommissionRule={createCommissionRule}
        commissionRules={commissionRules.data || []}
        ownersReload={owners.reload} listingsReload={listings.reload}
      />}

      {/* Modals */}
      <Modal title="Manual Match" open={showManualMatch} onClose={() => setShowManualMatch(false)}>
        {selectedTransaction && <div className="mb-4 rounded bg-slate-50 p-3 text-sm">
          <p className="font-medium">{selectedTransaction.description}</p>
          <p className="text-slate-500">{money(selectedTransaction.amount)} on {selectedTransaction.transaction_date}</p>
        </div>}
        <p className="mb-3 text-sm text-slate-600">Select a reservation to match:</p>
        {matchCandidates.length === 0 ? <p className="text-sm text-slate-400">No candidates found.</p> :
          <div className="space-y-2 max-h-80 overflow-auto">
            {matchCandidates.map(c => (
              <div key={c.id} className={`flex items-center justify-between rounded border p-3 text-sm hover:border-gold cursor-pointer ${c.channel_match ? 'border-green-200 bg-green-50' : ''}`}
                onClick={() => doManualMatch(c.id)}>
                <div>
                  <p className="font-medium">{c.guest_name} - {c.listing_name}</p>
                  <p className="text-xs text-slate-500">{c.platform} | {c.check_in} to {c.check_out} | {money(c.net_amount)}</p>
                </div>
                <div className="text-right">
                  <p className={`text-xs ${c.amount_diff <= 2 ? 'text-green-600' : 'text-orange-500'}`}>diff: {money(c.amount_diff)}</p>
                  <button className="mt-1 rounded bg-gold px-3 py-1 text-xs font-medium text-ink"><Link2 className="inline h-3 w-3 mr-1" />Match</button>
                </div>
              </div>
            ))}
          </div>
        }
      </Modal>

      <Modal title="PDF Preview" open={!!showPdfPreview} onClose={() => { showPdfPreview && URL.revokeObjectURL(showPdfPreview); setShowPdfPreview(null); }}>
        {showPdfPreview && <iframe src={showPdfPreview} className="w-full h-[70vh] rounded border" />}
      </Modal>

      <Modal title="Trust Account Config" open={showTrustConfig} onClose={() => setShowTrustConfig(false)}>
        <form onSubmit={saveTrustConfig} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-slate-500 mb-1 block">BSB</label><Input placeholder="000-000" value={trustConfig.bsb} onChange={v => setTrustConfig({...trustConfig, bsb: v})} /></div>
            <div><label className="text-xs text-slate-500 mb-1 block">Account Number</label><Input placeholder="123456789" value={trustConfig.account_number} onChange={v => setTrustConfig({...trustConfig, account_number: v})} /></div>
          </div>
          <div><label className="text-xs text-slate-500 mb-1 block">Account Name</label><Input value={trustConfig.account_name} onChange={v => setTrustConfig({...trustConfig, account_name: v})} /></div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="text-xs text-slate-500 mb-1 block">Bank</label><Input value={trustConfig.bank_name} onChange={v => setTrustConfig({...trustConfig, bank_name: v})} /></div>
            <div><label className="text-xs text-slate-500 mb-1 block">FI Code</label><Input value={trustConfig.financial_institution_code} onChange={v => setTrustConfig({...trustConfig, financial_institution_code: v})} /></div>
            <div><label className="text-xs text-slate-500 mb-1 block">APCA ID</label><Input value={trustConfig.apca_user_id} onChange={v => setTrustConfig({...trustConfig, apca_user_id: v})} /></div>
          </div>
          <button className="w-full rounded bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy/90">Save Trust Account Config</button>
        </form>
      </Modal>
    </main>
  );
}

// ── Dashboard View ──

function DashboardView({ month, dashboard, owners, uploadFile, syncHostaway, sendEmails, downloadAba, openManualMatch, previewPdf, loadTrustConfig, flash, sidebarSection, setSidebarSection }) {
  return (
    <>
      <section className="mx-auto grid max-w-7xl gap-4 px-6 py-5 sm:grid-cols-2 lg:grid-cols-4">
        <Metric title="Trust Received" value={money(dashboard.data.totals?.trustReceived)} icon={<WalletCards />} accent />
        <Metric title="Reservations" value={dashboard.data.totals?.reservations || 0} icon={<Building2 />} />
        <Metric title="Unmatched" value={dashboard.data.totals?.unmatched || 0} icon={<RefreshCcw />} />
        <Metric title="Pending Payouts" value={dashboard.data.totals?.pending || 0} icon={<DollarSign />} />
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-6 pb-8 lg:grid-cols-[340px_1fr]">
        {/* Sidebar */}
        <aside className="space-y-4">
          <SidebarToggle label="Data Ingestion" section="ingestion" current={sidebarSection} onToggle={setSidebarSection}>
            <div className="space-y-1">
              <Uploader label="Trust Account Statement" type="trust" onUpload={uploadFile} />
              <Uploader label="Reservations Export" type="reservations" onUpload={uploadFile} />
              <Uploader label="Owner Expenses" type="expenses" onUpload={uploadFile} />
              <Uploader label="Cleaning & Utilities" type="cleaning-utilities" onUpload={uploadFile} />
            </div>
            <button className="mt-3 w-full rounded border border-navy px-4 py-2 text-sm font-semibold text-navy hover:bg-navy/5 transition-colors" onClick={syncHostaway}>
              <RefreshCcw className="mr-2 inline h-4 w-4" />Sync Hostaway
            </button>
          </SidebarToggle>

          <SidebarToggle label="Quick Actions" section="actions" current={sidebarSection} onToggle={setSidebarSection}>
            <div className="space-y-2">
              <button className="w-full rounded bg-gold px-4 py-2 text-sm font-semibold text-ink hover:bg-gold/90 transition-colors" onClick={sendEmails}>
                <Mail className="mr-2 inline h-4 w-4" />Send Disbursement Emails
              </button>
              <button className="w-full rounded bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy/90 transition-colors" onClick={downloadAba}>
                <Download className="mr-2 inline h-4 w-4" />Download ABA File
              </button>
              <button className="w-full rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors" onClick={loadTrustConfig}>
                <Settings className="mr-2 inline h-4 w-4" />Trust Account Config
              </button>
            </div>
          </SidebarToggle>

          <Panel title="Calculation Info">
            <div className="space-y-2 text-xs text-slate-500">
              <div className="flex justify-between"><span>Airbnb Fee</span><span className="font-medium text-navy">16.5%</span></div>
              <div className="flex justify-between"><span>Booking.com Fee</span><span className="font-medium text-navy">16.5%</span></div>
              <div className="flex justify-between"><span>VRBO Fee</span><span className="font-medium text-navy">12%</span></div>
              <div className="flex justify-between"><span>Direct Fee</span><span className="font-medium text-navy">0%</span></div>
              <hr />
              <div className="flex justify-between"><span>Management Fee</span><span className="font-medium text-navy">18% + GST</span></div>
              <div className="flex justify-between"><span>Software Fee</span><span className="font-medium text-navy">$65.99/mo</span></div>
            </div>
          </Panel>
        </aside>

        {/* Main Content */}
        <section className="space-y-5">
          <Panel title="Trust Account Summary">
            <DataTable rows={dashboard.data.trustSummary || []} columns={['channel', 'total']} />
          </Panel>

          <Panel title="Reservation Ledger">
            <DataTable rows={dashboard.data.reservationLedger || []} columns={[
              { key: 'guest_name', label: 'Guest' },
              { key: 'platform', label: 'Platform' },
              { key: 'listing_name', label: 'Property' },
              { key: 'check_in', label: 'Check In' },
              { key: 'check_out', label: 'Check Out' },
              { key: 'expected_payout_date', label: 'Expected Payout' },
              { key: 'actual_payout', label: 'Actual Payout' },
            ]} />
          </Panel>

          <Panel title="Per-Owner Disbursement Summary"
            actions={
              <div className="flex gap-2">
                <button className="rounded bg-gold px-3 py-1.5 text-xs font-semibold text-ink hover:bg-gold/90" onClick={sendEmails}>
                  <Mail className="mr-1 inline h-3 w-3" />Email All
                </button>
                <button className="rounded bg-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy/90" onClick={downloadAba}>
                  <Download className="mr-1 inline h-3 w-3" />ABA
                </button>
              </div>
            }>
            <DisbursementTable summaries={dashboard.data.ownerSummaries || []} onPreviewPdf={previewPdf} />
          </Panel>

          <div className="grid gap-5 xl:grid-cols-2">
            <Panel title="Unmatched Payments">
              {(dashboard.data.unmatchedPayments || []).length === 0 ? <p className="text-sm text-slate-400 py-2">All payments matched.</p> :
                <div className="space-y-2">
                  {(dashboard.data.unmatchedPayments || []).slice(0, 20).map(tx => (
                    <div key={tx.id} className="flex items-center justify-between rounded border p-2.5 text-sm hover:border-gold cursor-pointer" onClick={() => openManualMatch(tx)}>
                      <div>
                        <p className="font-medium text-xs">{tx.description}</p>
                        <p className="text-xs text-slate-500">{tx.transaction_date} | {tx.channel || 'Unknown'}</p>
                      </div>
                      <span className="font-semibold text-navy">{money(tx.amount)}</span>
                    </div>
                  ))}
                </div>
              }
            </Panel>
            <Panel title="Pending Payouts">
              <DataTable rows={dashboard.data.pendingPayouts || []} columns={[
                { key: 'guest_name', label: 'Guest' },
                { key: 'platform', label: 'Platform' },
                { key: 'listing_name', label: 'Property' },
                { key: 'expected_payout_date', label: 'Expected' },
                { key: 'net_amount', label: 'Amount' },
              ]} maxRows={20} />
            </Panel>
          </div>
        </section>
      </section>
    </>
  );
}

// ── Disbursement Table with AU Breakdown ──

function DisbursementTable({ summaries, onPreviewPdf }) {
  const [expanded, setExpanded] = useState(null);
  if (!summaries.length) return <p className="text-sm text-slate-400 py-2">No disbursements calculated yet.</p>;

  return <div className="space-y-2">
    {summaries.map(s => (
      <div key={s.id} className="rounded border">
        <div className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-slate-50" onClick={() => setExpanded(expanded === s.id ? null : s.id)}>
          <div className="flex items-center gap-3">
            {expanded === s.id ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
            <span className="font-semibold text-navy text-sm">{s.owner_name}</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-lg font-bold text-navy">{money(s.final_owner_payout)}</span>
            <button className="rounded border px-2 py-1 text-xs text-slate-500 hover:border-gold hover:text-gold" onClick={(e) => { e.stopPropagation(); onPreviewPdf(s.id); }}>
              <FileText className="inline h-3 w-3 mr-1" />PDF
            </button>
          </div>
        </div>
        {expanded === s.id && (
          <div className="border-t bg-slate-50 px-4 py-3 text-sm space-y-1">
            <Row label="Gross Bookings" value={s.gross_channel_payout} />
            <Row label="Channel Fees" value={-Number(s.platform_fees)} negative />
            <Row label="Channel Payout" value={s.net_channel_revenue} bold />
            <Row label="Cleaning Fees" value={-Number(s.cleaning_costs)} negative />
            <Row label="Net Income" value={s.net_income} bold />
            <hr className="my-1" />
            <Row label="Management Fee (18%)" value={-Number(s.management_fee_base)} negative />
            <Row label="GST on Mgmt Fee (10%)" value={-Number(s.management_fee_gst)} negative />
            <Row label="Total Management" value={-Number(s.management_commission)} negative bold />
            <hr className="my-1" />
            <Row label="Software Fees" value={-Number(s.software_fees)} negative />
            <Row label="Owner Expenses" value={-Number(s.owner_expenses)} negative />
            <Row label="Utilities" value={-Number(s.utilities)} negative />
            <hr className="my-1" />
            <div className="flex justify-between font-bold text-navy text-base pt-1">
              <span>Final Owner Payout</span>
              <span>{money(s.final_owner_payout)}</span>
            </div>
          </div>
        )}
      </div>
    ))}
  </div>;
}

function Row({ label, value, negative, bold }) {
  const num = Number(value || 0);
  return <div className={`flex justify-between ${bold ? 'font-semibold' : ''}`}>
    <span className="text-slate-600">{label}</span>
    <span className={num < 0 ? 'text-red-600' : 'text-navy'}>{money(num)}</span>
  </div>;
}

// ── Sidebar Toggle ──

function SidebarToggle({ label, section, current, onToggle, children }) {
  const open = current === section;
  return <div className="rounded-lg border bg-white shadow-sm">
    <button className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold uppercase tracking-wide text-navy" onClick={() => onToggle(open ? null : section)}>
      {label}
      {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
    </button>
    {open && <div className="border-t px-4 pb-4 pt-3">{children}</div>}
  </div>;
}

// ── Setup View ──

function SetupView({ owners, listings, ownerForm, setOwnerForm, createOwner, listingForm, setListingForm, createListing, commissionForm, setCommissionForm, createCommissionRule, commissionRules, ownersReload, listingsReload }) {
  return (
    <section className="mx-auto max-w-7xl px-6 py-6 space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Owner Registry */}
        <Panel title="Owner Registry">
          <form onSubmit={createOwner} className="space-y-3 mb-4">
            <Input placeholder="Owner name" value={ownerForm.name} onChange={(name) => setOwnerForm({ ...ownerForm, name })} />
            <Input placeholder="Email" value={ownerForm.email} onChange={(email) => setOwnerForm({ ...ownerForm, email })} />
            <Input placeholder="Phone" value={ownerForm.phone} onChange={(phone) => setOwnerForm({ ...ownerForm, phone })} />
            <button className="w-full rounded bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy/90">Add Owner</button>
          </form>
          <div className="max-h-60 overflow-auto">
            {owners.map(o => (
              <div key={o.id} className="flex items-center justify-between border-b py-2 text-xs last:border-0">
                <div><span className="font-medium">{o.name}</span><br/><span className="text-slate-400">{o.email}</span></div>
              </div>
            ))}
          </div>
        </Panel>

        {/* Listing Setup */}
        <Panel title="Listing Setup">
          <form onSubmit={createListing} className="space-y-3 mb-4">
            <select className="w-full rounded border border-slate-300 px-3 py-2 text-sm" value={listingForm.owner_id} onChange={(e) => setListingForm({ ...listingForm, owner_id: e.target.value })} required>
              <option value="">Select Owner</option>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <Input placeholder="Listing name" value={listingForm.name} onChange={(name) => setListingForm({ ...listingForm, name })} />
            <Input placeholder="Address" value={listingForm.address} onChange={(address) => setListingForm({ ...listingForm, address })} />
            <Input placeholder="Hostaway Listing ID" value={listingForm.hostaway_listing_id} onChange={(hostaway_listing_id) => setListingForm({ ...listingForm, hostaway_listing_id })} />
            <Input placeholder="Airbnb ID" value={listingForm.airbnb_listing_id} onChange={(airbnb_listing_id) => setListingForm({ ...listingForm, airbnb_listing_id })} />
            <Input placeholder="Booking.com ID" value={listingForm.booking_property_id} onChange={(booking_property_id) => setListingForm({ ...listingForm, booking_property_id })} />
            <button className="w-full rounded bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy/90">Add Listing</button>
          </form>
          <p className="text-xs text-slate-400">{listings.length} listings configured</p>
        </Panel>

        {/* Commission Rules */}
        <Panel title="Commission Rules">
          <form onSubmit={createCommissionRule} className="space-y-3 mb-4">
            <select className="w-full rounded border border-slate-300 px-3 py-2 text-sm" value={commissionForm.owner_id} onChange={(e) => setCommissionForm({ ...commissionForm, owner_id: e.target.value })} required>
              <option value="">Select Owner</option>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <select className="w-full rounded border border-slate-300 px-3 py-2 text-sm" value={commissionForm.platform} onChange={(e) => setCommissionForm({ ...commissionForm, platform: e.target.value })}>
              <option value="all">All Platforms</option>
              <option value="airbnb">Airbnb</option>
              <option value="booking.com">Booking.com</option>
              <option value="vrbo">VRBO</option>
              <option value="direct">Direct</option>
            </select>
            <select className="w-full rounded border border-slate-300 px-3 py-2 text-sm" value={commissionForm.type} onChange={(e) => setCommissionForm({ ...commissionForm, type: e.target.value })}>
              <option value="au_management">AU Management (% + GST)</option>
              <option value="percentage_net">Percentage of Net</option>
              <option value="percentage_gross">Percentage of Gross</option>
              <option value="flat_fee">Flat Fee</option>
            </select>
            <Input placeholder="Rate (e.g. 0.18 = 18%)" value={commissionForm.rate} onChange={(rate) => setCommissionForm({ ...commissionForm, rate })} type="number" />
            <button className="w-full rounded bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy/90">Save Rule</button>
          </form>
          <div className="max-h-48 overflow-auto text-xs">
            {commissionRules.map(r => (
              <div key={r.id} className="flex justify-between border-b py-1.5 last:border-0">
                <span>{r.owner_name} - {r.platform}</span>
                <span className="font-medium">{r.type === 'au_management' ? `${(r.rate * 100).toFixed(0)}% + GST` : `${(r.rate * 100).toFixed(0)}%`}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* All Listings Table */}
      <Panel title={`All Listings (${listings.length})`}>
        <DataTable rows={listings} columns={[
          { key: 'name', label: 'Name' },
          { key: 'address', label: 'Address' },
          { key: 'owner_name', label: 'Owner' },
          { key: 'hostaway_listing_id', label: 'Hostaway ID' },
          { key: 'monthly_software_fee', label: 'Software Fee' },
        ]} maxRows={100} />
      </Panel>

      {/* All Owners Table */}
      <Panel title={`All Owners (${owners.length})`}>
        <DataTable rows={owners} columns={[
          { key: 'name', label: 'Name' },
          { key: 'email', label: 'Email' },
          { key: 'phone', label: 'Phone' },
        ]} maxRows={100} />
      </Panel>
    </section>
  );
}

createRoot(document.getElementById('root')).render(<App />);
