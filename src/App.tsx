import { useState, useEffect, useRef } from 'react';
import Papa from 'papaparse';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export default function App() {
  const [listings, setListings] = useState<any[]>([]);
  const [connections, setConnections] = useState({ etsy: false, square: false });
  const [selectedListing, setSelectedListing] = useState<any | null>(null);
  const [editData, setEditData] = useState({ title: '', description: '', price: '', quantity: '' });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [threshold, setThreshold] = useState(5);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchListings = () => {
    Promise.all([
      fetch('/api/status').then(res => res.ok ? res.json() : { etsy: false, square: false }),
      fetch('/api/etsy/listings').then(res => res.ok ? res.json() : [])
    ])
    .then(([status, listings]) => {
      setConnections(status);
      setListings(Array.isArray(listings) ? listings : []);
    })
    .catch(err => console.error("Error:", err))
    .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchListings();
    const interval = setInterval(fetchListings, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const handleDeleteListing = async () => {
    if (!selectedListing) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/etsy/listings/${selectedListing.listing_id}`, {
        method: 'DELETE'
      });
      if (!response.ok) throw new Error('Failed to delete');
      
      // Refresh listings
      const listResponse = await fetch('/api/etsy/listings');
      const updatedListings = await listResponse.json();
      setListings(Array.isArray(updatedListings) ? updatedListings : []);
      setSelectedListing(null);
    } catch (err) {
      console.error("Error deleting listing:", err);
    } finally {
      setLoading(false);
    }
  };

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

  const handleExportCSV = () => {
    const csv = Papa.unparse(listings);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'listings.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportCSV = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        setListings(prev => [...prev, ...results.data]);
      }
    });
  };

  const handleSelectListing = (listing: any) => {
    setSelectedListing(listing);
    setEditData({
      title: listing.title,
      description: listing.description,
      price: listing.price,
      quantity: listing.quantity
    });
  };

  const handleUpdateListing = async () => {
    if (!selectedListing) return;
    try {
      const response = await fetch(`/api/etsy/listings/${selectedListing.listing_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editData)
      });
      if (!response.ok) throw new Error('Failed to update');
      
      // Refresh listings
      const listResponse = await fetch('/api/etsy/listings');
      const updatedListings = await listResponse.json();
      setListings(Array.isArray(updatedListings) ? updatedListings : []);
      setSelectedListing(null);
    } catch (err) {
      console.error("Error updating listing:", err);
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-900 overflow-hidden">
      <aside className="w-64 bg-slate-900 flex flex-col h-full">
        <div className="p-6 flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-500 rounded flex items-center justify-center">
            <div className="w-4 h-4 bg-white rounded-sm"></div>
          </div>
          <span className="text-white font-bold text-xl tracking-tight">SyncBridge</span>
        </div>
        <nav className="flex-1 px-4 space-y-1">
          <a href="#" className="flex items-center px-4 py-3 bg-slate-800 text-white rounded-lg">📊 Dashboard</a>
          <a href="#" className="flex items-center px-4 py-3 text-slate-400 hover:text-white rounded-lg">📋 My Listings</a>
          <a href="#" className="flex items-center px-4 py-3 text-slate-400 hover:text-white rounded-lg">📦 Inventory</a>
          <a href="#" onClick={handleConnectEtsy} className="flex items-center px-4 py-3 text-slate-400 hover:text-white rounded-lg cursor-pointer">
            <span className={`w-2 h-2 rounded-full mr-3 ${connections.etsy ? 'bg-green-500' : 'bg-red-500'}`}></span>
            🔗 Connect Etsy
          </a>
          <a href="#" onClick={handleConnectSquare} className="flex items-center px-4 py-3 text-slate-400 hover:text-white rounded-lg cursor-pointer">
            <span className={`w-2 h-2 rounded-full mr-3 ${connections.square ? 'bg-green-500' : 'bg-red-500'}`}></span>
            🔗 Connect Square
          </a>
        </nav>
      </aside>

      <main className="flex-1 flex flex-col h-full overflow-hidden">
        <header className="h-16 bg-white border-b border-slate-200 px-8 flex items-center justify-between">
          <h1 className="text-lg font-semibold">Listing Dashboard</h1>
          <div className="flex gap-2">
            <button onClick={() => fileInputRef.current?.click()} className="px-4 py-2 bg-slate-100 rounded-lg text-sm text-slate-700 hover:bg-slate-200">Import CSV</button>
            <input type="file" ref={fileInputRef} onChange={handleImportCSV} accept=".csv" className="hidden" />
            <button onClick={handleExportCSV} className="px-4 py-2 bg-slate-900 rounded-lg text-sm text-white hover:bg-slate-800">Export CSV</button>
          </div>
        </header>

        <div className="p-8 flex-1 overflow-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
             <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
               <div className="text-slate-500 text-xs font-bold uppercase mb-1">Total Listings</div>
               <div className="text-2xl font-bold">{listings.length}</div>
             </div>
             <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm col-span-1 md:col-span-3">
                <div className="text-slate-500 text-xs font-bold uppercase mb-4 flex justify-between items-center">
                  <span>Stock Distribution</span>
                  <input type="number" value={threshold} onChange={e => setThreshold(Number(e.target.value))} className="w-16 border rounded p-1 text-sm" placeholder="Threshold"/>
                </div>
                <div className="h-40">
                  <motion.div animate={{ opacity: loading ? [1, 0.5, 1] : 1 }} transition={{ repeat: loading ? Infinity : 0, duration: 1.5 }} className="h-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={listings}>
                        <XAxis dataKey="title" hide={true}/>
                        <YAxis hide={true}/>
                        <Tooltip />
                        <Bar dataKey="quantity" fill="#6366f1" />
                      </BarChart>
                    </ResponsiveContainer>
                  </motion.div>
                </div>
             </div>
          </div>
          
          {loading ? (
             <div className="text-center py-20 text-slate-500">Loading listings...</div>
          ) : selectedListing ? (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
              <h2 className="text-xl font-bold mb-4">Edit Listing</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Title</label>
                  <input type="text" value={editData.title} onChange={e => setEditData({...editData, title: e.target.value})} className="w-full border rounded-lg p-2" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Description</label>
                  <textarea value={editData.description} onChange={e => setEditData({...editData, description: e.target.value})} className="w-full border rounded-lg p-2" rows={4} />
                </div>
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="block text-sm font-medium mb-1">Price</label>
                    <input type="number" value={editData.price} onChange={e => setEditData({...editData, price: e.target.value})} className="w-full border rounded-lg p-2" />
                  </div>
                  <div className="flex-1">
                    <label className="block text-sm font-medium mb-1">Quantity</label>
                    <input type="number" value={editData.quantity} onChange={e => setEditData({...editData, quantity: e.target.value})} className="w-full border rounded-lg p-2" />
                  </div>
                </div>
                <div className="flex justify-between mt-6">
                  <button onClick={handleDeleteListing} className="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200">Delete Listing</button>
                  <div className="flex gap-2">
                    <button onClick={() => setSelectedListing(null)} className="px-4 py-2 bg-slate-100 rounded-lg">Cancel</button>
                    <button onClick={handleUpdateListing} className="px-4 py-2 bg-indigo-600 text-white rounded-lg">Save Changes</button>
                  </div>
                </div>
              </div>
            </div>
          ) : listings.length > 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
               <input 
                 type="text" 
                 placeholder="Search listings..." 
                 className="w-full p-4 border-b border-slate-200" 
                 value={searchTerm} 
                 onChange={e => setSearchTerm(e.target.value)}
                />
               <ul className="divide-y divide-slate-200">
                  <AnimatePresence>
                    {listings
                      .filter(l => l.title.toLowerCase().includes(searchTerm.toLowerCase()))
                      .map((l: any) => (
                      <motion.li 
                        key={l.listing_id} 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className={`p-4 hover:bg-slate-50 cursor-pointer ${l.quantity < threshold ? 'bg-red-100' : ''}`} 
                        onClick={() => handleSelectListing(l)}
                      >
                        {l.title} - Qty: {l.quantity}
                      </motion.li>
                    ))}
                  </AnimatePresence>
               </ul>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 text-center text-slate-500">
              Connect your Etsy or Square account to begin synchronizing listings.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
