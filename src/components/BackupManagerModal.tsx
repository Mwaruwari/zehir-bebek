import React, { useState, useEffect } from 'react';
import { History, RotateCcw, X, AlertTriangle, CheckCircle, Database, FileText } from 'lucide-react';
import { Project } from '../types';

interface BackupItem {
  filename: string;
  timestamp: string;
  formattedDate: string;
  projectsCount: number;
  projectNames: string[];
  sizeKb: string;
}

interface BackupManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRestoreSuccess: (projects: Project[]) => void;
  addLog?: (level: 'info' | 'error', message: string) => void;
}

export function BackupManagerModal({ isOpen, onClose, onRestoreSuccess, addLog }: BackupManagerModalProps) {
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoringFilename, setRestoringFilename] = useState<string | null>(null);
  const [confirmingBackup, setConfirmingBackup] = useState<BackupItem | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchBackups = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/projects/backups');
      if (res.ok) {
        const data = await res.json();
        setBackups(data);
      } else {
        setStatusMessage({ type: 'error', text: 'Yedek listesi alınamadı.' });
      }
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: `Hata: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchBackups();
      setStatusMessage(null);
      setConfirmingBackup(null);
    }
  }, [isOpen]);

  const executeRestore = async (backup: BackupItem) => {
    setConfirmingBackup(null);
    setRestoringFilename(backup.filename);
    setStatusMessage(null);

    try {
      const res = await fetch('/api/projects/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: backup.filename })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setStatusMessage({ type: 'success', text: `Yedek başarıyla geri yüklendi! (${data.projects.length} proje kurtarıldı)` });
        if (addLog) addLog('info', `Yedek geri yüklendi: ${backup.filename}`);
        onRestoreSuccess(data.projects);
        setTimeout(() => {
          onClose();
        }, 1500);
      } else {
        setStatusMessage({ type: 'error', text: data.error || 'Yedek geri yüklenirken hata oluştu.' });
      }
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: `Bağlantı hatası: ${err.message}` });
    } finally {
      setRestoringFilename(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-700/80 rounded-xl w-full max-w-2xl overflow-hidden shadow-2xl">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-950/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-red-950/50 border border-red-500/30 flex items-center justify-center">
              <History className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <h3 className="text-base font-bold text-zinc-100 flex items-center gap-2">
                Versiyon Geçmişi & Otomatik Yedekler
              </h3>
              <p className="text-xs text-zinc-400">
                Her kayıt işleminde alınan otomatik yedeklerden önceki bir versiyona geri dönebilirsiniz.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-200 p-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 max-h-[60vh] overflow-y-auto space-y-4">
          {statusMessage && (
            <div
              className={`p-3.5 rounded-lg border text-xs flex items-center gap-2.5 ${
                statusMessage.type === 'success'
                  ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                  : 'bg-red-950/40 border-red-500/40 text-red-300'
              }`}
            >
              {statusMessage.type === 'success' ? (
                <CheckCircle className="w-4 h-4 shrink-0 text-emerald-400" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
              )}
              <span>{statusMessage.text}</span>
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center text-zinc-400 text-xs font-mono space-y-2">
              <Database className="w-6 h-6 animate-spin mx-auto text-red-500" />
              <p>Yedek versiyon geçmişi yükleniyor...</p>
            </div>
          ) : backups.length === 0 ? (
            <div className="py-12 text-center text-zinc-500 text-xs space-y-2 border border-dashed border-zinc-800 rounded-lg">
              <History className="w-8 h-8 mx-auto text-zinc-600" />
              <p>Henüz kayıtlı otomatik yedek bulunmuyor.</p>
              <p className="text-[11px] text-zinc-600">Her otomatik kayıtta buraya yeni bir yedek eklenecektir.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {backups.map((b, idx) => (
                <div
                  key={b.filename}
                  className="p-4 bg-zinc-950/70 border border-zinc-800 hover:border-zinc-700 rounded-lg flex items-center justify-between gap-4 transition-all"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-semibold text-zinc-200">
                        {b.formattedDate}
                      </span>
                      {idx === 0 && (
                        <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 bg-red-950 text-red-400 border border-red-500/30 rounded">
                          En Son Yedek
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-zinc-400">
                      <span className="flex items-center gap-1 text-zinc-300">
                        <FileText className="w-3.5 h-3.5 text-zinc-500" />
                        {b.projectsCount} Proje ({b.projectNames.join(', ') || 'İsimsiz'})
                      </span>
                      <span>•</span>
                      <span className="font-mono text-zinc-500">{b.sizeKb} KB</span>
                    </div>
                  </div>

                  {confirmingBackup?.filename === b.filename ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => executeRestore(b)}
                        disabled={restoringFilename === b.filename}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold transition-colors"
                      >
                        Evet, Yükle
                      </button>
                      <button
                        onClick={() => setConfirmingBackup(null)}
                        className="px-2 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-xs transition-colors"
                      >
                        İptal
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmingBackup(b)}
                      disabled={restoringFilename === b.filename}
                      className="px-3 py-2 bg-red-950/60 hover:bg-red-900 border border-red-500/40 text-red-200 hover:text-white rounded-lg text-xs font-semibold flex items-center gap-2 transition-all shrink-0 disabled:opacity-50"
                    >
                      <RotateCcw className={`w-3.5 h-3.5 ${restoringFilename === b.filename ? 'animate-spin' : ''}`} />
                      {restoringFilename === b.filename ? 'Yükleniyor...' : 'Geri Yükle'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between text-[11px] text-zinc-500">
          <span>Sistem otomatik olarak son 20 yedek versiyonunu saklar.</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-xs font-medium transition-colors"
          >
            Kapat
          </button>
        </div>

      </div>
    </div>
  );
}
