import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Building2, Calculator, Calendar, Check, ChevronDown, ChevronUp, DollarSign, Download, Eye, FileText, Link2, Mail, Pencil, Receipt, RefreshCcw, Settings, Trash2, Upload, WalletCards, X } from 'lucide-react';
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

function Uploader({ label, type, onUpload, accept }) {
  return <label className="mb-2 flex cursor-pointer items-center justify-between rounded border border-dashed border-slate-300 px-3 py-2.5 text-sm text-slate-600 hover:border-gold hover:bg-gold/5 transition-colors">
    <span><Upload className="mr-2 inline h-4 w-4 text-gold" />{label}</span>
    <input className="hidden" type="file" accept={accept || ".csv,.xlsx,.xls,.pdf"} onChange={(e) => e.target.files?.[0] && onUpload(type, e.target.files[0])} />
    <span className="text-xs text-slate-400">{accept === '.csv' ? 'CSV' : accept === '.pdf' ? 'PDF' : 'CSV/XLSX/PDF'}</span>
  </label>;
}

function DataTable({ rows, columns, maxRows = 50, onRowClick }) {
  const visibleRows = useMemo(() => rows.slice(0, maxRows), [rows, maxRows]);
  if (!rows.length) return <p className="text-sm text-slate-400 py-2">No records.</p>;
  return <div className="overflow-x-auto">
    <table className="min-w-full text-left text-sm">
      <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
        <tr>{columns.map((col, i) => <th key={(col.key || col) + i} className="whitespace-nowrap px-3 py-2">{(col.label || col).replaceAll('_', ' ')}</th>)}</tr>
      </thead>
      <tbody>
        {visibleRows.map((row, i) => <tr key={row.id || i} className={`border-b last:border-0 hover:bg-slate-50 ${onRowClick ? 'cursor-pointer' : ''}`} onClick={() => onRowClick?.(row)}>
          {columns.map((col, j) => {
            const key = col.key || col;
            return <td key={key + j} className="max-w-xs truncate px-3 py-2">{col.render ? col.render(row) : formatCell(row[key])}</td>;
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
  const emailLog = useApi(`/api/email-log?month=${month}`, []);
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
  const [showEmailPreview, setShowEmailPreview] = useState(null);
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
        platform_fee_rates: { airbnb: 0.165, 'booking.com': 0.165, vrbo: 0.12, direct: 0 }
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

  async function createDrafts() {
    try {
      const result = await post(`/api/emails/${month}/draft`, {});
      flash(`Created ${result.length} email drafts — review before sending`, 'success');
      emailLog.reload();
    } catch (e) { flash(e.message, 'error'); }
  }

  async function sendSingleDraft(emailLogId) {
    try {
      const result = await post(`/api/emails/${emailLogId}/send`, {});
      flash(result.status === 'sent' ? `Email sent to ${result.recipient}` : `Email ${result.status}: ${result.error || ''}`, result.status === 'sent' ? 'success' : 'error');
      emailLog.reload();
    } catch (e) { flash(e.message, 'error'); }
  }

  async function sendAllDrafts() {
    try {
      const result = await post(`/api/emails/${month}/send-all`, {});
      const sent = result.filter(r => r.status === 'sent').length;
      flash(`Sent ${sent} of ${result.length} emails`, sent > 0 ? 'success' : 'error');
      emailLog.reload();
    } catch (e) { flash(e.message, 'error'); }
  }

  async function deleteDraft(emailLogId) {
    try {
      await fetch(`${API}/api/email-log/${emailLogId}`, { method: 'DELETE' });
      flash('Draft deleted', 'success');
      emailLog.reload();
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

  function viewReport(disbursementId) {
    window.open(`${API}/api/disbursements/${disbursementId}/report`, '_blank');
  }

  async function downloadReportPdf(disbursementId) {
    try {
      const response = await fetch(`${API}/api/disbursements/${disbursementId}/report/pdf`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `LiveLuxe-Report-${disbursementId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      flash('Report PDF downloaded', 'success');
    } catch (e) { flash(e.message, 'error'); }
  }

  function previewEmail(disbursementId) {
    setShowEmailPreview(`${API}/api/disbursements/${disbursementId}/email-preview`);
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
    { id: 'reservations', label: 'Reservations', icon: <Calendar className="h-4 w-4" /> },
    { id: 'deals', label: 'Property Deals', icon: <Building2 className="h-4 w-4" /> },
    { id: 'expenses', label: 'Expenses', icon: <Receipt className="h-4 w-4" /> },
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
        uploadFile={uploadFile} syncHostaway={syncHostaway}
        createDrafts={createDrafts} sendAllDrafts={sendAllDrafts} sendSingleDraft={sendSingleDraft} deleteDraft={deleteDraft}
        downloadAba={downloadAba} openManualMatch={openManualMatch} previewPdf={previewPdf}
        viewReport={viewReport} downloadReportPdf={downloadReportPdf} previewEmail={previewEmail}
        loadTrustConfig={loadTrustConfig} flash={flash}
        emailLog={emailLog}
        sidebarSection={sidebarSection} setSidebarSection={setSidebarSection}
      />}

      {tab === 'reservations' && <ReservationsView
        month={month} listings={listings.data || []} flash={flash}
      />}

      {tab === 'deals' && <PropertyDealsView flash={flash} />}

      {tab === 'expenses' && <ExpensesView
        listings={listings.data || []} owners={ownerOptions} flash={flash}
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

      <Modal title="Email Preview" open={!!showEmailPreview} onClose={() => setShowEmailPreview(null)}>
        {showEmailPreview && <iframe src={showEmailPreview} className="w-full h-[70vh] rounded border" />}
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

function DashboardView({ month, dashboard, owners, uploadFile, syncHostaway, createDrafts, sendAllDrafts, sendSingleDraft, deleteDraft, downloadAba, openManualMatch, previewPdf, viewReport, downloadReportPdf, previewEmail, loadTrustConfig, flash, emailLog, sidebarSection, setSidebarSection }) {
  const drafts = (emailLog.data || []).filter(e => e.status === 'draft');
  const sent = (emailLog.data || []).filter(e => e.status === 'sent');

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
            <p className="text-xs text-slate-500 mb-2 font-medium uppercase tracking-wide">Channel Payouts</p>
            <div className="space-y-1 mb-3">
              <Uploader label="Airbnb Earnings" type="trust" onUpload={uploadFile} accept=".pdf,.csv" />
              <Uploader label="Booking.com Payouts" type="trust" onUpload={uploadFile} accept=".csv" />
              <Uploader label="Bank Statement" type="trust" onUpload={uploadFile} />
            </div>
            <p className="text-xs text-slate-500 mb-2 font-medium uppercase tracking-wide">Other Data</p>
            <div className="space-y-1">
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
              <button className="w-full rounded bg-gold px-4 py-2 text-sm font-semibold text-ink hover:bg-gold/90 transition-colors" onClick={createDrafts}>
                <Mail className="mr-2 inline h-4 w-4" />Create Email Drafts
              </button>
              {drafts.length > 0 && (
                <button className="w-full rounded bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 transition-colors" onClick={sendAllDrafts}>
                  <Mail className="mr-2 inline h-4 w-4" />Send All Drafts ({drafts.length})
                </button>
              )}
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
              <div className="flex justify-between"><span>Default Mgmt Fee (incGST)</span><span className="font-medium text-navy">19.8%</span></div>
              <div className="flex justify-between"><span>Tech Fee</span><span className="font-medium text-navy">$64.99/listing/mo</span></div>
              <p className="text-slate-400 text-[10px]">Per-property rates in Property Deals tab</p>
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
                <button className="rounded bg-gold px-3 py-1.5 text-xs font-semibold text-ink hover:bg-gold/90" onClick={createDrafts}>
                  <Mail className="mr-1 inline h-3 w-3" />Create Drafts
                </button>
                <button className="rounded bg-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy/90" onClick={downloadAba}>
                  <Download className="mr-1 inline h-3 w-3" />ABA
                </button>
              </div>
            }>
            <DisbursementTable summaries={dashboard.data.ownerSummaries || []} onPreviewPdf={previewPdf} onViewReport={viewReport} onDownloadPdf={downloadReportPdf} onPreviewEmail={previewEmail} />
          </Panel>

          {/* Email Drafts Panel */}
          {(emailLog.data || []).length > 0 && (
            <Panel title={`Email Drafts & Log (${drafts.length} draft${drafts.length !== 1 ? 's' : ''}, ${sent.length} sent)`}
              actions={drafts.length > 0 ? (
                <button className="rounded bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700" onClick={sendAllDrafts}>
                  Send All Drafts
                </button>
              ) : null}>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Owner</th>
                      <th className="px-3 py-2">Recipient</th>
                      <th className="px-3 py-2">Subject</th>
                      <th className="px-3 py-2">Payout</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Attachments</th>
                      <th className="px-3 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(emailLog.data || []).map(e => (
                      <tr key={e.id} className="border-b last:border-0 hover:bg-slate-50">
                        <td className="px-3 py-2 text-xs font-medium">{e.owner_name || '—'}</td>
                        <td className="px-3 py-2 text-xs text-slate-500">{e.recipient}</td>
                        <td className="px-3 py-2 text-xs max-w-xs truncate">{e.subject || '—'}</td>
                        <td className="px-3 py-2 text-xs font-semibold text-navy">{e.final_owner_payout ? money(e.final_owner_payout) : '—'}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            e.status === 'draft' ? 'bg-amber-100 text-amber-700' :
                            e.status === 'sent' ? 'bg-green-100 text-green-700' :
                            e.status === 'error' ? 'bg-red-100 text-red-700' :
                            'bg-slate-100 text-slate-500'
                          }`}>{e.status}</span>
                        </td>
                        <td className="px-3 py-2 text-[10px] text-slate-400">
                          {(e.attachment_names || []).map((n, i) => <div key={i}>{n}</div>)}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1">
                            {e.status === 'draft' && (
                              <>
                                <button className="rounded bg-green-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-green-700" onClick={() => sendSingleDraft(e.id)}>Send</button>
                                <button className="rounded border border-slate-300 px-2 py-1 text-[10px] text-slate-500 hover:border-red-400 hover:text-red-600" onClick={() => deleteDraft(e.id)}>Delete</button>
                              </>
                            )}
                            {e.disbursement_id && (
                              <button className="rounded border border-slate-300 px-2 py-1 text-[10px] text-slate-500 hover:border-purple-400 hover:text-purple-600" onClick={() => previewEmail(e.disbursement_id)}>Preview</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

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

function DisbursementTable({ summaries, onPreviewPdf, onViewReport, onDownloadPdf, onPreviewEmail }) {
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
            <div className="flex items-center gap-1">
              <button className="rounded border px-2 py-1 text-xs text-slate-500 hover:border-blue-400 hover:text-blue-600" title="View Report" onClick={(e) => { e.stopPropagation(); onViewReport(s.id); }}>
                <Eye className="inline h-3 w-3 mr-1" />Report
              </button>
              <button className="rounded border px-2 py-1 text-xs text-slate-500 hover:border-gold hover:text-gold" title="Download PDF" onClick={(e) => { e.stopPropagation(); onDownloadPdf(s.id); }}>
                <Download className="inline h-3 w-3 mr-1" />PDF
              </button>
              <button className="rounded border px-2 py-1 text-xs text-slate-500 hover:border-purple-400 hover:text-purple-600" title="Preview Email" onClick={(e) => { e.stopPropagation(); onPreviewEmail(s.id); }}>
                <Mail className="inline h-3 w-3 mr-1" />Email
              </button>
            </div>
          </div>
        </div>
        {expanded === s.id && (
          <div className="border-t bg-slate-50 px-4 py-3 text-sm space-y-1">
            <Row label="Gross Bookings" value={s.gross_channel_payout} />
            <Row label="Channel Fees" value={-Number(s.platform_fees)} negative />
            <Row label="Net Payout" value={s.net_channel_revenue} bold />
            <hr className="my-1" />
            <Row label="Management Fee (incGST)" value={-Number(s.management_fee_base)} negative />
            {Number(s.mgmt_fee_discount) > 0 && <Row label="Mgmt Fee Discount" value={Number(s.mgmt_fee_discount)} />}
            <Row label="Effective Management" value={-Number(s.management_commission)} negative bold />
            <hr className="my-1" />
            <Row label="Cleaning Fees" value={-Number(s.cleaning_costs)} negative />
            {Number(s.software_fees) > 0 && <Row label="Tech Fee ($64.99/listing)" value={-Number(s.software_fees)} negative />}
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

// ── Reservations View ──

function ReservationsView({ month, listings, flash }) {
  const [startDate, setStartDate] = useState(() => `${month}-01`);
  const [endDate, setEndDate] = useState(() => {
    const d = new Date(`${month}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + 1);
    d.setUTCDate(0);
    return d.toISOString().slice(0, 10);
  });
  const [propertyFilter, setPropertyFilter] = useState('');
  const [platformFilter, setPlatformFilter] = useState('');
  const [reservations, setReservations] = useState([]);
  const [straddlers, setStraddlers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showStraddlers, setShowStraddlers] = useState(false);

  // Update dates when month changes
  useEffect(() => {
    setStartDate(`${month}-01`);
    const d = new Date(`${month}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + 1);
    d.setUTCDate(0);
    setEndDate(d.toISOString().slice(0, 10));
  }, [month]);

  // Fetch reservations when filters change
  const fetchReservations = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ startDate, endDate, includeStraddlers: 'true' });
      if (propertyFilter) params.set('listingId', propertyFilter);
      if (platformFilter) params.set('platform', platformFilter);
      const response = await fetch(`${API}/api/reservations/query?${params}`);
      if (response.ok) {
        const data = await response.json();
        setReservations(data);
      }
    } catch (e) { flash(e.message, 'error'); }
    setLoading(false);
  }, [startDate, endDate, propertyFilter, platformFilter]);

  // Fetch straddlers for current month
  const fetchStraddlers = useCallback(async () => {
    try {
      const response = await fetch(`${API}/api/reservations/straddlers/${month}`);
      if (response.ok) setStraddlers(await response.json());
    } catch (e) { /* silent */ }
  }, [month]);

  useEffect(() => { fetchReservations(); }, [fetchReservations]);
  useEffect(() => { fetchStraddlers(); }, [fetchStraddlers]);

  async function syncRange() {
    setSyncing(true);
    try {
      const result = await post('/api/hostaway/sync-range', { startDate, endDate });
      if (result.skipped) {
        flash(result.reason, 'error');
      } else {
        flash(`Synced ${result.reservations} reservations (${result.straddlers} straddlers)`, 'success');
        fetchReservations();
        fetchStraddlers();
      }
    } catch (e) { flash(e.message, 'error'); }
    setSyncing(false);
  }

  async function downloadCSV() {
    try {
      const params = new URLSearchParams({ startDate, endDate });
      if (propertyFilter) params.set('listingId', propertyFilter);
      if (platformFilter) params.set('platform', platformFilter);
      const response = await fetch(`${API}/api/reservations/csv?${params}`);
      if (!response.ok) { flash('CSV download failed', 'error'); return; }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `reservations-${startDate}-to-${endDate}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      flash('CSV downloaded', 'success');
    } catch (e) { flash(e.message, 'error'); }
  }

  const metrics = useMemo(() => {
    const total = reservations.length;
    const straddlerCount = reservations.filter(r => r.is_straddler).length;
    const totalGross = reservations.reduce((sum, r) => sum + Number(r.gross_amount || 0), 0);
    const platforms = [...new Set(reservations.map(r => r.platform))].length;
    return { total, straddlerCount, totalGross, platforms };
  }, [reservations]);

  // Unique properties for filter dropdown
  const propertyOptions = useMemo(() => {
    const props = listings.filter(l => l.id).map(l => ({ id: l.id, name: l.name }));
    return props.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [listings]);

  return (
    <section className="mx-auto max-w-7xl px-6 py-5 space-y-5">
      {/* Metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric title="Total Reservations" value={metrics.total} icon={<Calendar />} />
        <Metric title="Straddling Bookings" value={metrics.straddlerCount} icon={<RefreshCcw />} accent />
        <Metric title="Total Gross" value={money(metrics.totalGross)} icon={<DollarSign />} />
        <Metric title="Platforms" value={metrics.platforms} icon={<Building2 />} />
      </div>

      {/* Filters & Actions */}
      <Panel title="Hostaway Reservations" actions={
        <div className="flex items-center gap-2">
          <button onClick={syncRange} disabled={syncing}
            className="rounded bg-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy/90 disabled:opacity-50">
            <RefreshCcw className={`mr-1 inline h-3 w-3 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing...' : 'Sync from Hostaway'}
          </button>
          <button onClick={downloadCSV}
            className="rounded bg-gold px-3 py-1.5 text-xs font-semibold text-ink hover:bg-gold/90">
            <Download className="mr-1 inline h-3 w-3" />CSV
          </button>
        </div>
      }>
        {/* Filter Bar */}
        <div className="flex flex-wrap items-end gap-3 mb-4 pb-4 border-b">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Start Date</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm focus:border-gold focus:outline-none" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">End Date</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm focus:border-gold focus:outline-none" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Property</label>
            <select value={propertyFilter} onChange={e => setPropertyFilter(e.target.value)}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm max-w-[220px]">
              <option value="">All Properties</option>
              {propertyOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Platform</label>
            <select value={platformFilter} onChange={e => setPlatformFilter(e.target.value)}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm">
              <option value="">All</option>
              <option value="airbnb">Airbnb</option>
              <option value="booking">Booking.com</option>
              <option value="vrbo">VRBO</option>
              <option value="direct">Direct</option>
            </select>
          </div>
          <button onClick={fetchReservations} disabled={loading}
            className="rounded bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-50">
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {/* Reservation Table */}
        {loading ? (
          <p className="text-sm text-slate-400 py-4 text-center">Loading reservations...</p>
        ) : (
          <DataTable rows={reservations} maxRows={100} columns={[
            { key: 'guest_name', label: 'Guest' },
            { key: 'platform', label: 'Platform', render: (r) => (
              <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                (r.platform || '').toLowerCase().includes('airbnb') ? 'bg-red-50 text-red-600' :
                (r.platform || '').toLowerCase().includes('booking') ? 'bg-blue-50 text-blue-600' :
                (r.platform || '').toLowerCase().includes('vrbo') ? 'bg-purple-50 text-purple-600' :
                'bg-slate-50 text-slate-600'
              }`}>{r.platform}</span>
            )},
            { key: 'listing_name', label: 'Property' },
            { key: 'owner_name', label: 'Owner' },
            { key: 'check_in', label: 'Check In' },
            { key: 'check_out', label: 'Check Out' },
            { key: 'gross_amount', label: 'Gross' },
            { key: 'net_amount', label: 'Net' },
            { key: 'cleaning_fee', label: 'Cleaning' },
            { key: 'is_straddler', label: 'Straddler', render: (r) => r.is_straddler ? (
              <span className="inline-block rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-600">
                {r.straddle_direction === 'incoming' ? 'From Prior' : r.straddle_direction === 'outgoing' ? 'To Next' : 'Yes'}
              </span>
            ) : <span className="text-slate-300 text-xs">-</span> },
          ]} />
        )}
      </Panel>

      {/* Expense Upload Panel */}
      <Panel title="Upload Owner Expenses" actions={
        <span className="text-xs text-slate-400">CSV with columns: listing id/name, date, description, amount</span>
      }>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs text-slate-500 mb-2">Upload a CSV of expenses to deduct from owner payouts. Each row is matched to a listing and deducted during disbursement calculation.</p>
            <Uploader label="Owner Expenses CSV" type="expenses" onUpload={(type, file) => {
              const form = new FormData();
              form.append('file', file);
              fetch(`${API}/api/uploads/${type}`, { method: 'POST', body: form })
                .then(r => r.json())
                .then(json => { flash(`Expenses uploaded: ${json.rows || 0} rows processed`, 'success'); })
                .catch(e => flash(e.message, 'error'));
            }} accept=".csv,.xlsx" />
          </div>
          <div className="text-xs text-slate-500 space-y-1">
            <p className="font-medium text-slate-600">CSV Format:</p>
            <p><code className="bg-slate-100 px-1 rounded">listing id</code> — Hostaway ID or listing name</p>
            <p><code className="bg-slate-100 px-1 rounded">date</code> — Expense date (YYYY-MM-DD)</p>
            <p><code className="bg-slate-100 px-1 rounded">description</code> — What the expense is for</p>
            <p><code className="bg-slate-100 px-1 rounded">amount</code> — Dollar amount to deduct</p>
            <p className="pt-1 text-slate-400">A $64.99 tech fee per listing is automatically applied during calculation.</p>
          </div>
        </div>
      </Panel>

      {/* Straddling Bookings Panel */}
      {straddlers.length > 0 && (
        <Panel title={`Straddling Bookings for ${month}`} actions={
          <button onClick={() => setShowStraddlers(!showStraddlers)}
            className="text-xs text-slate-500 hover:text-navy">
            {showStraddlers ? <ChevronUp className="inline h-4 w-4" /> : <ChevronDown className="inline h-4 w-4" />}
            {showStraddlers ? 'Hide' : 'Show'} ({straddlers.length})
          </button>
        }>
          {showStraddlers && (
            <>
              <p className="text-xs text-slate-500 mb-3">
                These bookings cross month boundaries and need pro-rating in the disbursement calculation.
                <span className="font-medium text-amber-600"> Incoming</span> = started in prior month,
                <span className="font-medium text-amber-600"> Outgoing</span> = extends into next month.
              </p>
              <DataTable rows={straddlers} maxRows={50} columns={[
                { key: 'guest_name', label: 'Guest' },
                { key: 'listing_name', label: 'Property' },
                { key: 'owner_name', label: 'Owner' },
                { key: 'check_in', label: 'Check In' },
                { key: 'check_out', label: 'Check Out' },
                { key: 'straddle_direction', label: 'Direction', render: (r) => (
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                    r.straddle_direction === 'incoming' ? 'bg-blue-50 text-blue-600' : 'bg-orange-50 text-orange-600'
                  }`}>{r.straddle_direction === 'incoming' ? 'From Prior Month' : 'To Next Month'}</span>
                )},
                { key: 'period_nights', label: 'Period Nights' },
                { key: 'total_nights', label: 'Total Nights' },
                { key: 'gross_amount', label: 'Full Gross' },
              ]} />
            </>
          )}
        </Panel>
      )}
    </section>
  );
}

// ── Property Deals View ──

function PropertyDealsView({ flash }) {
  const deals = useApi('/api/listings/deals', []);
  const [ownerFilter, setOwnerFilter] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  const ownerNames = useMemo(() => {
    const names = [...new Set((deals.data || []).map(d => d.owner_name).filter(Boolean))];
    return names.sort();
  }, [deals.data]);

  const filtered = useMemo(() => {
    if (!ownerFilter) return deals.data || [];
    return (deals.data || []).filter(d => d.owner_name === ownerFilter);
  }, [deals.data, ownerFilter]);

  const metrics = useMemo(() => {
    const all = deals.data || [];
    return {
      total: all.length,
      custom: all.filter(d => d.rate_source === 'custom').length,
      defaultRate: all.filter(d => d.rate_source === 'default').length,
      rule: all.filter(d => d.rate_source === 'rule').length,
    };
  }, [deals.data]);

  function startEdit(row) {
    setEditingId(row.id);
    setEditValue(row.management_fee_pct != null ? (Number(row.management_fee_pct) * 100).toFixed(1) : '');
  }

  async function saveEdit(listingId) {
    setSaving(true);
    try {
      const pct = editValue.trim() === '' ? null : Number(editValue) / 100;
      if (pct !== null && (isNaN(pct) || pct < 0 || pct > 1)) {
        flash('Rate must be 0-100% or empty for default', 'error');
        setSaving(false);
        return;
      }
      await put(`/api/listings/${listingId}`, { management_fee_pct: pct });
      setEditingId(null);
      deals.reload();
      flash('Management fee updated', 'success');
    } catch (e) { flash(e.message, 'error'); }
    setSaving(false);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditValue('');
  }

  return (
    <section className="mx-auto max-w-7xl px-6 py-5 space-y-5">
      {/* Summary Metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric title="Total Properties" value={metrics.total} icon={<Building2 />} />
        <Metric title="Custom Rates" value={metrics.custom} icon={<Pencil />} accent />
        <Metric title="Owner Rules" value={metrics.rule} icon={<DollarSign />} />
        <Metric title="Default (19.8%)" value={metrics.defaultRate} icon={<Settings />} />
      </div>

      {/* Filter + Table */}
      <Panel title="Property Management Fees" actions={
        <select className="rounded border border-slate-300 px-3 py-1.5 text-sm" value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)}>
          <option value="">All Owners</option>
          {ownerNames.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      }>
        {filtered.length === 0
          ? <p className="text-sm text-slate-400 py-2">No listings found.</p>
          : <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Property</th>
                    <th className="px-3 py-2">Owner</th>
                    <th className="px-3 py-2">Hostaway ID</th>
                    <th className="px-3 py-2">Mgmt Fee %</th>
                    <th className="px-3 py-2">Source</th>
                    <th className="px-3 py-2">Cleaning Fee</th>
                    <th className="px-3 py-2">Waiver %</th>
                    <th className="px-3 py-2">Boost</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(row => (
                    <tr key={row.id} className="border-b last:border-0 hover:bg-slate-50">
                      <td className="px-3 py-2 font-medium max-w-xs truncate">{row.name}</td>
                      <td className="px-3 py-2 text-slate-600">{row.owner_name}</td>
                      <td className="px-3 py-2 text-slate-500 text-xs">{row.hostaway_listing_id || '\u2014'}</td>
                      <td className="px-3 py-2">
                        {editingId === row.id
                          ? <div className="flex items-center gap-1">
                              <input
                                className="w-20 rounded border border-gold px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-gold"
                                type="number" step="0.1" min="0" max="100"
                                placeholder="18.0"
                                value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') saveEdit(row.id); if (e.key === 'Escape') cancelEdit(); }}
                                autoFocus
                              />
                              <span className="text-xs text-slate-400">%</span>
                              <button disabled={saving} onClick={() => saveEdit(row.id)} className="text-green-600 hover:text-green-800"><Check className="h-4 w-4" /></button>
                              <button onClick={cancelEdit} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
                            </div>
                          : <span className="font-semibold text-navy">{(Number(row.effective_mgmt_rate) * 100).toFixed(1)}%</span>
                        }
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          row.rate_source === 'custom' ? 'bg-gold/20 text-gold' :
                          row.rate_source === 'rule' ? 'bg-blue-50 text-blue-600' :
                          'bg-slate-100 text-slate-500'
                        }`}>
                          {row.rate_source === 'custom' ? 'Custom' : row.rate_source === 'rule' ? 'Owner Rule' : 'Default'}
                        </span>
                      </td>
                      <td className="px-3 py-2">{money(row.cleaning_fee_baseline)}</td>
                      <td className="px-3 py-2">{Number(row.mgmt_fee_waiver_pct) > 0 ? `${(Number(row.mgmt_fee_waiver_pct) * 100).toFixed(0)}%` : '\u2014'}</td>
                      <td className="px-3 py-2">{Number(row.mgmt_fee_boost) > 0 ? money(row.mgmt_fee_boost) : '\u2014'}</td>
                      <td className="px-3 py-2">
                        {editingId !== row.id && (
                          <button onClick={() => startEdit(row)} className="rounded border px-2 py-1 text-xs text-slate-500 hover:border-gold hover:text-gold">
                            <Pencil className="inline h-3 w-3 mr-1" />Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        }
      </Panel>
    </section>
  );
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
              <option value="au_management">AU Management (incGST)</option>
              <option value="percentage_net">Percentage of Net</option>
              <option value="percentage_gross">Percentage of Gross</option>
              <option value="flat_fee">Flat Fee</option>
            </select>
            <Input placeholder="Rate (e.g. 0.198 = 19.8% incGST)" value={commissionForm.rate} onChange={(rate) => setCommissionForm({ ...commissionForm, rate })} type="number" />
            <button className="w-full rounded bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy/90">Save Rule</button>
          </form>
          <div className="max-h-48 overflow-auto text-xs">
            {commissionRules.map(r => (
              <div key={r.id} className="flex justify-between border-b py-1.5 last:border-0">
                <span>{r.owner_name} - {r.platform}</span>
                <span className="font-medium">{r.type === 'au_management' ? `${(r.rate * 100).toFixed(1)}% incGST` : `${(r.rate * 100).toFixed(0)}%`}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* All Listings Table — with inline owner assignment */}
      <Panel title={`All Listings (${listings.length})`} actions={
        <span className="text-xs text-slate-400">{listings.filter(l => !l.owner_id).length} unassigned</span>
      }>
        {listings.length === 0 ? <p className="text-sm text-slate-400 py-2">No listings.</p> : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Hostaway ID</th>
                  <th className="px-3 py-2">Owner</th>
                </tr>
              </thead>
              <tbody>
                {listings.map(l => (
                  <tr key={l.id} className="border-b last:border-0 hover:bg-slate-50">
                    <td className="px-3 py-2 max-w-xs truncate">{l.name}</td>
                    <td className="px-3 py-2 text-slate-500">{l.hostaway_listing_id || '—'}</td>
                    <td className="px-3 py-1.5">
                      <select
                        className={`w-full rounded border px-2 py-1 text-sm ${l.owner_id ? 'border-slate-300' : 'border-amber-400 bg-amber-50'}`}
                        value={l.owner_id || ''}
                        onChange={async (e) => {
                          try {
                            await put(`/listings/${l.id}`, { owner_id: e.target.value || null });
                            listingsReload();
                          } catch (err) { alert(err.message); }
                        }}
                      >
                        <option value="">— Unassigned —</option>
                        {owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {listings.filter(l => !l.owner_id).length > 0 && (
          <div className="mt-3 flex items-center gap-2">
            <button
              className="rounded bg-gold px-3 py-1.5 text-xs font-semibold text-white hover:bg-gold/90"
              onClick={async () => {
                if (!owners.length) return alert('Add owners first');
                const defaultOwner = owners[0].id;
                const unassigned = listings.filter(l => !l.owner_id);
                for (const l of unassigned) {
                  await put(`/listings/${l.id}`, { owner_id: defaultOwner });
                }
                listingsReload();
              }}
            >
              Assign all unassigned to {owners[0]?.name || 'first owner'}
            </button>
            <span className="text-xs text-slate-400">Then reassign individually as needed</span>
          </div>
        )}
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

// ── Expenses View ──

function ExpensesView({ listings, owners, flash }) {
  const [expenseForm, setExpenseForm] = useState({ listing_id: '', expense_date: '', description: '', category: 'maintenance', amount: '' });
  const [receiptFile, setReceiptFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterMonth, setFilterMonth] = useState(new Date().toISOString().slice(0, 7));
  const [filterOwner, setFilterOwner] = useState('');

  const fetchExpenses = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterMonth) params.set('month', filterMonth);
      if (filterOwner) params.set('owner_id', filterOwner);
      const response = await fetch(`${API}/api/expenses?${params}`);
      if (response.ok) setExpenses(await response.json());
    } catch (e) { flash(e.message, 'error'); }
    setLoading(false);
  }, [filterMonth, filterOwner]);

  useEffect(() => { fetchExpenses(); }, [fetchExpenses]);

  async function submitExpense(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append('listing_id', expenseForm.listing_id);
      form.append('expense_date', expenseForm.expense_date);
      form.append('description', expenseForm.description);
      form.append('category', expenseForm.category);
      form.append('amount', expenseForm.amount);
      if (receiptFile) form.append('receipt', receiptFile);

      const response = await fetch(`${API}/api/expenses`, { method: 'POST', body: form });
      if (!response.ok) throw new Error((await response.json()).error || 'Failed to create expense');
      setExpenseForm({ listing_id: '', expense_date: '', description: '', category: 'maintenance', amount: '' });
      setReceiptFile(null);
      flash('Expense created', 'success');
      fetchExpenses();
    } catch (e) { flash(e.message, 'error'); }
    setSubmitting(false);
  }

  async function handleCsvImport(file) {
    setImporting(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch(`${API}/api/expenses/import-csv`, { method: 'POST', body: form });
      if (!response.ok) throw new Error((await response.json()).error || 'CSV import failed');
      const result = await response.json();
      flash(`CSV import: ${result.success} expenses created${result.errors.length ? `, ${result.errors.length} errors` : ''}`, result.errors.length ? 'error' : 'success');
      fetchExpenses();
    } catch (e) { flash(e.message, 'error'); }
    setImporting(false);
  }

  async function handleDelete(id) {
    if (!confirm('Delete this expense?')) return;
    try {
      const response = await fetch(`${API}/api/expenses/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Delete failed');
      flash('Expense deleted', 'success');
      fetchExpenses();
    } catch (e) { flash(e.message, 'error'); }
  }

  const total = useMemo(() => expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0), [expenses]);

  return (
    <section className="mx-auto max-w-7xl px-6 py-5 space-y-5">
      {/* Metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric title="Total Expenses" value={expenses.length} icon={<Receipt />} />
        <Metric title="Total Amount" value={money(total)} icon={<DollarSign />} accent />
        <Metric title="With Receipts" value={expenses.filter(e => e.receipt_url).length} icon={<FileText />} />
        <Metric title="Categories" value={[...new Set(expenses.map(e => e.category))].length} icon={<Settings />} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[400px_1fr]">
        {/* Left column: Add + Import */}
        <div className="space-y-5">
          {/* Add Single Expense */}
          <Panel title="Add Expense">
            <form onSubmit={submitExpense} className="space-y-3">
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Listing</label>
                <select className="w-full rounded border border-slate-300 px-3 py-2 text-sm" required
                  value={expenseForm.listing_id} onChange={e => setExpenseForm({ ...expenseForm, listing_id: e.target.value })}>
                  <option value="">Select listing...</option>
                  {listings.map(l => <option key={l.id} value={l.id}>{l.name} ({l.owner_name})</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Date</label>
                  <input type="date" required className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-gold focus:outline-none"
                    value={expenseForm.expense_date} onChange={e => setExpenseForm({ ...expenseForm, expense_date: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Amount ($)</label>
                  <input type="number" step="0.01" min="0" required placeholder="0.00"
                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-gold focus:outline-none"
                    value={expenseForm.amount} onChange={e => setExpenseForm({ ...expenseForm, amount: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Description</label>
                <Input placeholder="e.g. Plumber call-out fee" required
                  value={expenseForm.description} onChange={description => setExpenseForm({ ...expenseForm, description })} />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Category</label>
                <select className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  value={expenseForm.category} onChange={e => setExpenseForm({ ...expenseForm, category: e.target.value })}>
                  <option value="maintenance">Maintenance</option>
                  <option value="repairs">Repairs</option>
                  <option value="supplies">Supplies</option>
                  <option value="utilities">Utilities</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Receipt (optional)</label>
                <label className="flex cursor-pointer items-center justify-between rounded border border-dashed border-slate-300 px-3 py-2.5 text-sm text-slate-600 hover:border-gold hover:bg-gold/5 transition-colors">
                  <span><Upload className="mr-2 inline h-4 w-4 text-gold" />{receiptFile ? receiptFile.name : 'Attach PDF/JPG/PNG'}</span>
                  <input className="hidden" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp"
                    onChange={e => setReceiptFile(e.target.files?.[0] || null)} />
                  <span className="text-xs text-slate-400">Max 10MB</span>
                </label>
              </div>
              <button disabled={submitting} className="w-full rounded bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy/90 disabled:opacity-50">
                {submitting ? 'Creating...' : 'Add Expense'}
              </button>
            </form>
          </Panel>

          {/* Batch CSV Import */}
          <Panel title="Batch CSV Import">
            <p className="text-xs text-slate-500 mb-3">
              Upload a CSV with columns: <code className="bg-slate-100 px-1 rounded">listing_id</code>, <code className="bg-slate-100 px-1 rounded">expense_date</code>, <code className="bg-slate-100 px-1 rounded">description</code>, <code className="bg-slate-100 px-1 rounded">category</code>, <code className="bg-slate-100 px-1 rounded">amount</code>
            </p>
            <label className={`flex cursor-pointer items-center justify-between rounded border border-dashed border-slate-300 px-3 py-2.5 text-sm text-slate-600 hover:border-gold hover:bg-gold/5 transition-colors ${importing ? 'opacity-50 pointer-events-none' : ''}`}>
              <span><Upload className="mr-2 inline h-4 w-4 text-gold" />{importing ? 'Importing...' : 'Upload Expenses CSV'}</span>
              <input className="hidden" type="file" accept=".csv"
                onChange={e => { if (e.target.files?.[0]) handleCsvImport(e.target.files[0]); e.target.value = ''; }} />
              <span className="text-xs text-slate-400">CSV</span>
            </label>
          </Panel>
        </div>

        {/* Right column: Expense List */}
        <Panel title={`Expenses (${expenses.length})`} actions={
          <div className="flex items-center gap-2">
            <input type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1 text-xs focus:border-gold focus:outline-none" />
            <select value={filterOwner} onChange={e => setFilterOwner(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1 text-xs max-w-[160px]">
              <option value="">All Owners</option>
              {owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
        }>
          {loading ? <p className="text-sm text-slate-400 py-4 text-center">Loading...</p> : (
            <>
              <DataTable rows={expenses} maxRows={100} columns={[
                { key: 'expense_date', label: 'Date' },
                { key: 'listing_name', label: 'Listing' },
                { key: 'owner_name', label: 'Owner' },
                { key: 'description', label: 'Description' },
                { key: 'category', label: 'Category', render: (r) => (
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                    r.category === 'maintenance' ? 'bg-blue-50 text-blue-600' :
                    r.category === 'repairs' ? 'bg-orange-50 text-orange-600' :
                    r.category === 'supplies' ? 'bg-purple-50 text-purple-600' :
                    r.category === 'utilities' ? 'bg-green-50 text-green-600' :
                    'bg-slate-100 text-slate-500'
                  }`}>{r.category}</span>
                )},
                { key: 'amount', label: 'Amount' },
                { key: 'receipt_url', label: 'Receipt', render: (r) => r.receipt_url
                  ? <a href={r.receipt_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-xs"><Eye className="inline h-3 w-3 mr-1" />View</a>
                  : <span className="text-slate-300 text-xs">&mdash;</span>
                },
                { key: 'actions', label: '', render: (r) => (
                  <button onClick={() => handleDelete(r.id)} className="text-red-400 hover:text-red-600" title="Delete">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )},
              ]} />
              {expenses.length > 0 && (
                <div className="flex justify-end mt-3 pt-3 border-t">
                  <span className="text-sm font-semibold text-navy">Total: {money(total)}</span>
                </div>
              )}
            </>
          )}
        </Panel>
      </div>
    </section>
  );
}

createRoot(document.getElementById('root')).render(<App />);
