import { useState, useEffect } from 'react';
import { ServerLog } from '../types';
import { Terminal, RefreshCw, Trash2, AlertCircle } from 'lucide-react';

export default function LogViewer() {
  const [logs, setLogs] = useState<ServerLog[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/logs');
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (err) {
      console.error('Failed to fetch logs', err);
    } finally {
      setLoading(false);
    }
  };

  const clearLogs = async () => {
    if (!confirm('Tüm logları temizlemek istediğinize emin misiniz?')) return;
    try {
      const res = await fetch('/api/logs/clear', { method: 'POST' });
      if (res.ok) {
        setLogs([]);
      }
    } catch (err) {
      console.error('Failed to clear logs', err);
    }
  };

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-[#0a0a0a] border border-[#2a2a2a] rounded overflow-hidden font-mono text-[11px] shadow-2xl">
      <div className="bg-[#111] px-4 py-2 flex items-center justify-between border-b border-[#2a2a2a]">
        <div className="flex items-center gap-2 text-zinc-300 font-semibold">
          <Terminal className="w-4 h-4 text-gold" />
          <span className="text-zinc-300 font-mono text-[10px] uppercase tracking-wider">Sistem ve Hata Günlükleri (Log Ekranı)</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchLogs}
            disabled={loading}
            className="p-1 text-zinc-400 hover:text-gold transition-colors rounded hover:bg-[#222] disabled:opacity-50"
            title="Yenile"
            id="btn-refresh-logs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={clearLogs}
            className="p-1 text-zinc-400 hover:text-red-400 transition-colors rounded hover:bg-[#222]"
            title="Temizle"
            id="btn-clear-logs"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="p-4 max-h-60 overflow-y-auto space-y-1.5 h-60 scrollbar-thin scrollbar-thumb-[#2a2a2a] scrollbar-track-transparent">
        {logs.length === 0 ? (
          <div className="text-zinc-500 text-center py-10 font-serif italic">Henüz bir günlük kaydı yok.</div>
        ) : (
          logs.map((log, index) => (
            <div key={index} className="flex items-start gap-2 leading-relaxed text-xs">
              <span className="text-zinc-600 select-none font-mono">
                {new Date(log.timestamp).toLocaleTimeString()}
              </span>
              <span
                className={`font-mono font-semibold shrink-0 ${
                  log.level === 'error' ? 'text-red-500' : 'text-emerald-400'
                }`}
              >
                [{log.level.toUpperCase()}]
              </span>
              <span className={log.level === 'error' ? 'text-red-400/90 font-medium font-mono' : 'text-zinc-300 font-mono'}>
                {log.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
