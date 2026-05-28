import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Building2, Calculator, Mail, RefreshCcw, Upload, WalletCards } from 'lucide-react';
import './main.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function useApi(path, fallback) {
  const [data, setData] = useState(fallback);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API}${path}`);
      setData(await response.json());
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [path]);
  return { data, setData, loading, reload: load };
}

function App() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const owners = useApi('/api/owners', []);
  const listings = useApi('/api/listings', []);
  const dashboard = useApi(`/api/dashboard/${month}`, emptyDashboard());
  const [message, setMessage] = useState('');
  const [ownerForm, setOwnerForm] = useState({ name: '', email: '', phone: '' });
  const [listingForm, setListingForm] = useState({ owner_id: '', name: '', address: '', airbnb_listing_id: '', booking_property_id: '', vrbo_id: '', hostaway_listing_id: '' });

  const ownerOptions = owners.data || [];
  const firstOwner = ownerOptions[0]?.id;

  async function post(path, body) {
    const response = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error((await response.json()).error || 'Request failed');
    return response.json();
  }

  async function createOwner(event) {
    event.preventDefault();
    await post('/api/owners', { ...ownerForm, banking_details: {} });
    setOwnerForm({ name: '', email: '', phone: '' });
    owners.reload();
  }

  async function createListing(event) {
    event.preventDefault();
    await post('/api/listings', {
      ...listingForm,
      platform_fee_rates: { airbnb: 0.03, 'booking.com': 0.15, vrbo: 0.05 }
    });
    setListingForm({ owner_id: '', name: '', address: '', airbnb_listing_id: '', booking_property_id: '', vrbo_id: '', hostaway_listing_id: '' });
    listings.reload();
  }

  async function calculateAll() {
    const targets = ownerOptions.length ? ownerOptions : [];
    for (const owner of targets) await post(`/api/disbursements/${month}/${owner.id}/calculate`, {});
    dashboard.reload();
  }

  async function uploadFile(type, file) {
    const form = new FormData();
    form.append('file', file);
    const response = await fetch(`${API}/api/uploads/${type}`, { method: 'POST', body: form });
    const json = await response.json();
    setMessage(`${type} upload processed ${json.rows || 0} rows`);
    dashboard.reload();
  }

  async function syncHostaway() {
    const result = await post('/api/hostaway/sync', {});
    setMessage(result.skipped ? result.reason : `Synced ${result.reservations} Hostaway reservations`);
    dashboard.reload();
  }

  async function sendEmails() {
    const result = await post(`/api/emails/${month}/send`, {});
    setMessage(`Email action logged for ${result.length} disbursements`);
  }

  return (
    <main className="min-h-screen">
      <header className="bg-navy text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">Owner Disbursement Management</h1>
            <p className="text-sm text-slate-300">Trust reconciliation, owner payouts, reports, and delivery</p>
          </div>
          <div className="flex items-center gap-3">
            <input className="rounded border border-slate-500 bg-slate-900 px-3 py-2 text-sm" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            <button className="rounded bg-gold px-4 py-2 text-sm font-semibold text-ink" onClick={calculateAll}><Calculator className="mr-2 inline h-4 w-4" />Calculate</button>
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-4 px-6 py-6 md:grid-cols-4">
        <Metric title="Trust received" value={money(dashboard.data.totals?.trustReceived)} icon={<WalletCards />} />
        <Metric title="Reservations" value={dashboard.data.totals?.reservations || 0} icon={<Building2 />} />
        <Metric title="Unmatched" value={dashboard.data.totals?.unmatched || 0} icon={<RefreshCcw />} />
        <Metric title="Pending payouts" value={dashboard.data.totals?.pending || 0} icon={<Calculator />} />
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-6 pb-8 lg:grid-cols-[360px_1fr]">
        <aside className="space-y-6">
          <Panel title="Owner Registry">
            <form onSubmit={createOwner} className="space-y-3">
              <Input placeholder="Owner name" value={ownerForm.name} onChange={(name) => setOwnerForm({ ...ownerForm, name })} />
              <Input placeholder="Email" value={ownerForm.email} onChange={(email) => setOwnerForm({ ...ownerForm, email })} />
              <Input placeholder="Phone" value={ownerForm.phone} onChange={(phone) => setOwnerForm({ ...ownerForm, phone })} />
              <button className="w-full rounded bg-navy px-4 py-2 text-sm font-semibold text-white">Add Owner</button>
            </form>
          </Panel>

          <Panel title="Listing Setup">
            <form onSubmit={createListing} className="space-y-3">
              <select className="w-full rounded border px-3 py-2 text-sm" value={listingForm.owner_id} onChange={(e) => setListingForm({ ...listingForm, owner_id: e.target.value })} required>
                <option value="">Owner</option>
                {ownerOptions.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
              </select>
              <Input placeholder="Listing name" value={listingForm.name} onChange={(name) => setListingForm({ ...listingForm, name })} />
              <Input placeholder="Address" value={listingForm.address} onChange={(address) => setListingForm({ ...listingForm, address })} />
              <Input placeholder="Airbnb ID" value={listingForm.airbnb_listing_id} onChange={(airbnb_listing_id) => setListingForm({ ...listingForm, airbnb_listing_id })} />
              <Input placeholder="Booking.com ID" value={listingForm.booking_property_id} onChange={(booking_property_id) => setListingForm({ ...listingForm, booking_property_id })} />
              <Input placeholder="VRBO ID" value={listingForm.vrbo_id} onChange={(vrbo_id) => setListingForm({ ...listingForm, vrbo_id })} />
              <Input placeholder="Hostaway Listing ID" value={listingForm.hostaway_listing_id} onChange={(hostaway_listing_id) => setListingForm({ ...listingForm, hostaway_listing_id })} />
              <button className="w-full rounded bg-navy px-4 py-2 text-sm font-semibold text-white">Add Listing</button>
            </form>
          </Panel>

          <Panel title="Ingestion">
            <Uploader label="Trust Account" type="trust" onUpload={uploadFile} />
            <Uploader label="Reservations" type="reservations" onUpload={uploadFile} />
            <Uploader label="Owner Expenses" type="expenses" onUpload={uploadFile} />
            <Uploader label="Cleaning & Utilities" type="cleaning-utilities" onUpload={uploadFile} />
            <button className="mt-3 w-full rounded border border-navy px-4 py-2 text-sm font-semibold text-navy" onClick={syncHostaway}><RefreshCcw className="mr-2 inline h-4 w-4" />Sync Hostaway</button>
            {message && <p className="mt-3 text-sm text-slate-600">{message}</p>}
          </Panel>
        </aside>

        <section className="space-y-6">
          <Panel title="Trust Account Summary">
            <DataTable rows={dashboard.data.trustSummary || []} columns={['channel', 'total']} />
          </Panel>

          <Panel title="Reservation Ledger">
            <DataTable rows={dashboard.data.reservationLedger || []} columns={['guest_name', 'platform', 'listing_name', 'check_in', 'check_out', 'expected_payout_date', 'actual_payout', 'disbursement_month']} />
          </Panel>

          <Panel title="Per-Owner Disbursement Summary">
            <div className="mb-3 flex justify-end">
              <button className="rounded bg-gold px-4 py-2 text-sm font-semibold text-ink" onClick={sendEmails}><Mail className="mr-2 inline h-4 w-4" />Send Disbursements</button>
            </div>
            <DataTable rows={dashboard.data.ownerSummaries || []} columns={['owner_name', 'gross_channel_payout', 'platform_fees', 'management_commission', 'owner_expenses', 'cleaning_costs', 'utilities', 'final_owner_payout']} />
          </Panel>

          <div className="grid gap-6 xl:grid-cols-2">
            <Panel title="Unmatched Payments Queue">
              <DataTable rows={dashboard.data.unmatchedPayments || []} columns={['transaction_date', 'description', 'amount', 'channel', 'status']} />
            </Panel>
            <Panel title="Pending Payouts">
              <DataTable rows={dashboard.data.pendingPayouts || []} columns={['guest_name', 'platform', 'listing_name', 'expected_payout_date', 'net_amount']} />
            </Panel>
          </div>
        </section>
      </section>
    </main>
  );
}

function Metric({ title, value, icon }) {
  return <div className="rounded-lg border bg-white p-4 shadow-sm">
    <div className="flex items-center justify-between text-slate-500">{title}<span className="text-gold">{React.cloneElement(icon, { className: 'h-5 w-5' })}</span></div>
    <div className="mt-3 text-2xl font-semibold text-navy">{value}</div>
  </div>;
}

function Panel({ title, children }) {
  return <div className="rounded-lg border bg-white p-4 shadow-sm">
    <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-navy">{title}</h2>
    {children}
  </div>;
}

function Input({ value, onChange, placeholder }) {
  return <input className="w-full rounded border px-3 py-2 text-sm" required placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />;
}

function Uploader({ label, type, onUpload }) {
  return <label className="mb-2 flex cursor-pointer items-center justify-between rounded border px-3 py-2 text-sm text-slate-700">
    <span><Upload className="mr-2 inline h-4 w-4 text-gold" />{label}</span>
    <input className="hidden" type="file" accept=".csv,.xlsx,.xls,.pdf" onChange={(e) => e.target.files?.[0] && onUpload(type, e.target.files[0])} />
  </label>;
}

function DataTable({ rows, columns }) {
  const visibleRows = useMemo(() => rows.slice(0, 50), [rows]);
  if (!rows.length) return <p className="text-sm text-slate-500">No records yet.</p>;
  return <div className="overflow-x-auto">
    <table className="min-w-full text-left text-sm">
      <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
        <tr>{columns.map((column) => <th key={column} className="px-3 py-2">{column.replaceAll('_', ' ')}</th>)}</tr>
      </thead>
      <tbody>
        {visibleRows.map((row, index) => <tr key={row.id || index} className="border-b last:border-0">
          {columns.map((column) => <td key={column} className="max-w-xs truncate px-3 py-2">{formatCell(row[column])}</td>)}
        </tr>)}
      </tbody>
    </table>
  </div>;
}

function formatCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return money(value);
  return String(value);
}

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function emptyDashboard() {
  return { trustSummary: [], reservationLedger: [], ownerSummaries: [], unmatchedPayments: [], pendingPayouts: [], totals: {} };
}

createRoot(document.getElementById('root')).render(<App />);
