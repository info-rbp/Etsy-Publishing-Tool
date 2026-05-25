import { useState, useEffect } from 'react';
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export default function App() {
  const [listings, setListings] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/etsy/listings')
      .then(res => {
         if (!res.ok) throw new Error('Failed to fetch');
         return res.json();
      })
      .then(data => setListings(Array.isArray(data) ? data : []))
      .catch(console.error);
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
          <a href="#" onClick={handleConnectEtsy} className="flex items-center px-4 py-3 text-slate-400 hover:text-white rounded-lg cursor-pointer">🔗 Connect Etsy</a>
          <a href="#" onClick={handleConnectSquare} className="flex items-center px-4 py-3 text-slate-400 hover:text-white rounded-lg cursor-pointer">🔗 Connect Square</a>
        </nav>
      </aside>

      <main className="flex-1 flex flex-col h-full overflow-hidden">
        <header className="h-16 bg-white border-b border-slate-200 px-8 flex items-center justify-between">
          <h1 className="text-lg font-semibold">Listing Dashboard</h1>
        </header>

        <div className="p-8 flex-1 overflow-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
             <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <div className="text-slate-500 text-xs font-bold uppercase mb-1">Total Listings</div>
              <div className="text-2xl font-bold">{listings.length}</div>
             </div>
          </div>
          
          {listings.length > 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
               <ul className="divide-y divide-slate-200">
                  {listings.map((l: any) => (
                    <li key={l.listing_id} className="p-4">{l.title}</li>
                  ))}
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
