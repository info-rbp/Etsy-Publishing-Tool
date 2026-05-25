import { useState, useEffect, useRef } from 'react';
import Papa from 'papaparse';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';

type AppView = 'dashboard' | 'listings' | 'inventory';
type Listing = Record<string, any>;

export default function App() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [connections, setConnections] = useState({ etsy: false, square: false, canConnectEtsy: false, canConnectSquare: false });
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
  const [editData, setEditData] = useState({ title: '', description: '', price: '', quantity: '' });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [threshold, setThreshold] = useState(5);
  const [currentView, setCurrentView] = useState<AppView>('dashboard');
  const [statusMessage, setStatusMessage] = useState('');
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const quantityOf = (l: Listing) => Number(l.quantity ?? 0) || 0;
  const filteredListings = listings.filter((l) => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return true;
    return String(l.title ?? '').toLowerCase().includes(q) || String(l.listing_id ?? '').toLowerCase().includes(q);
  });

  const fetchListings = () => {
    Promise.all([
      fetch('/api/status').then((r) => (r.ok ? r.json() : { etsy: false, square: false, canConnectEtsy: false, canConnectSquare: false })),
      fetch('/api/etsy/listings').then((r) => (r.ok ? r.json() : []))
    ]).then(([status, currentListings]) => {
      setConnections(status);
      setListings(Array.isArray(currentListings) ? currentListings : []);
    }).catch((err) => {
      console.error(err);
      setStatusMessage('Unable to refresh data.');
    }).finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchListings();
    const interval = setInterval(fetchListings, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const handleConnectEtsy = async () => {
    const response = await fetch('/api/auth/etsy/url');
    const { url } = await response.json();
    window.open(url, 'etsy_auth', 'width=600,height=700');
  };

  const handleConnectSquare = async () => {
    const response = await fetch('/api/auth/square/url');
    const { url } = await response.json();
    window.open(url, 'square_auth', 'width=600,height=700');
  };

  const handleImportCSV = (event: any) => {
    const file = event.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const good: Listing[] = [];
        const bad: string[] = [];
        (results.data as Listing[]).forEach((row, idx) => {
          const rowNo = idx + 2;
          const title = String(row.title ?? '').trim();
          const quantity = Number(row.quantity);
          const price = Number(row.price);
          if (!title) bad.push(`Row ${rowNo}: missing title`);
          else if (!Number.isFinite(quantity) || quantity < 0) bad.push(`Row ${rowNo}: invalid quantity`);
          else if (!Number.isFinite(price) || price < 0) bad.push(`Row ${rowNo}: invalid price`);
          else good.push({ ...row, title, quantity, price });
        });
        setImportErrors(bad);
        if (!good.length) return;

        const resp = await fetch('/api/listings/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: good }) });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Import failed');
        setStatusMessage(data.message || 'Import successful');
        fetchListings();
      }
    });
  };

  const handleExportCSV = () => {
    const csv = Papa.unparse(filteredListings);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'listings.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleUpdateListing = async () => { if (!selectedListing) return; await fetch(`/api/etsy/listings/${selectedListing.listing_id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editData) }); setSelectedListing(null); fetchListings(); };
  const handleDeleteListing = async () => { if (!selectedListing) return; await fetch(`/api/etsy/listings/${selectedListing.listing_id}`, { method: 'DELETE' }); setSelectedListing(null); fetchListings(); };
  const handleSyncInventory = async () => { setSyncing(true); try { const r = await fetch('/api/etsy/sync-inventory', { method: 'POST' }); const d = await r.json(); alert(d.message || d.error || 'Done'); fetchListings(); } finally { setSyncing(false); } };

  return <div className="flex h-screen bg-slate-50 font-sans text-slate-900 overflow-hidden">
    <aside className="w-64 bg-slate-900 flex flex-col h-full"><div className="p-6 text-white font-bold text-xl">SyncBridge</div>
      <nav className="flex-1 px-4 space-y-1">
        {(['dashboard', 'listings', 'inventory'] as AppView[]).map((v) => <button key={v} type="button" onClick={() => setCurrentView(v)} className={`flex items-center w-full px-4 py-3 rounded-lg text-left ${currentView === v ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'}`}>{v === 'dashboard' ? '📊 Dashboard' : v === 'listings' ? '📋 My Listings' : '📦 Inventory'}</button>)}
        <button type="button" onClick={handleConnectEtsy} className="flex items-center w-full px-4 py-3 text-slate-400 hover:text-white rounded-lg"><span className={`w-2 h-2 rounded-full mr-3 ${connections.etsy ? 'bg-green-500' : 'bg-red-500'}`}></span>🔗 Connect Etsy</button>
        <button type="button" onClick={handleConnectSquare} className="flex items-center w-full px-4 py-3 text-slate-400 hover:text-white rounded-lg"><span className={`w-2 h-2 rounded-full mr-3 ${connections.square ? 'bg-green-500' : 'bg-red-500'}`}></span>🔗 Connect Square</button>
      </nav>
    </aside>
    <main className="flex-1 p-6 overflow-auto">
      <div className="mb-4 flex gap-2"><input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search by title or ID" className="px-3 py-2 border rounded" />
      <button onClick={handleSyncInventory} disabled={syncing || !connections.etsy || !connections.square} className="px-3 py-2 bg-indigo-600 text-white rounded disabled:bg-slate-400">{syncing ? 'Syncing...' : 'Sync Now'}</button>
      <button onClick={() => fileInputRef.current?.click()} className="px-3 py-2 bg-slate-200 rounded">Import CSV</button><input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleImportCSV} />
      <button onClick={handleExportCSV} className="px-3 py-2 bg-slate-900 text-white rounded">Export CSV</button></div>
      {statusMessage && <div className="mb-3 text-sm text-indigo-700">{statusMessage}</div>}
      {importErrors.length > 0 && <div className="mb-3 text-sm text-amber-700">{importErrors.join(', ')}</div>}
      {currentView === 'dashboard' && <div className="bg-white p-4 rounded border"><div className="mb-2">Total Listings: {filteredListings.length}</div><div className="h-48"><ResponsiveContainer width="100%" height="100%"><BarChart data={filteredListings}><XAxis dataKey="title" hide /><YAxis hide /><Tooltip /><Bar dataKey="quantity" fill="#6366f1" /></BarChart></ResponsiveContainer></div></div>}
      {(currentView === 'listings' || currentView === 'inventory') && <div className="bg-white rounded border overflow-hidden">{loading ? <div className="p-4">Loading...</div> : selectedListing && currentView === 'listings' ? <div className="p-4 space-y-2"><input value={editData.title} onChange={(e) => setEditData({ ...editData, title: e.target.value })} className="w-full border p-2 rounded" /><textarea value={editData.description} onChange={(e) => setEditData({ ...editData, description: e.target.value })} className="w-full border p-2 rounded" /><div className="flex gap-2"><input type="number" value={editData.price} onChange={(e) => setEditData({ ...editData, price: e.target.value })} className="border p-2 rounded" /><input type="number" value={editData.quantity} onChange={(e) => setEditData({ ...editData, quantity: e.target.value })} className="border p-2 rounded" /></div><div className="flex gap-2"><button onClick={handleDeleteListing} className="px-3 py-2 bg-red-100 rounded">Delete</button><button onClick={() => setSelectedListing(null)} className="px-3 py-2 bg-slate-100 rounded">Cancel</button><button onClick={handleUpdateListing} className="px-3 py-2 bg-indigo-600 text-white rounded">Save</button></div></div> : <ul className="divide-y"><AnimatePresence>{filteredListings.map((l) => <motion.li key={String(l.listing_id ?? l.title)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => currentView === 'listings' && (setSelectedListing(l), setEditData({ title: String(l.title ?? ''), description: String(l.description ?? ''), price: String(l.price ?? ''), quantity: String(l.quantity ?? '') }))} className={`p-3 ${quantityOf(l) < threshold ? 'bg-red-100' : ''}`}>{l.title} - Qty: {quantityOf(l)}</motion.li>)}</AnimatePresence></ul>}</div>}
    </main>
  </div>;
}
