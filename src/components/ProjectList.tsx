import { useState, FormEvent } from 'react';
import { Project } from '../types';
import { 
  Folder, 
  Plus, 
  Trash2, 
  Edit3, 
  Maximize2, 
  Calendar, 
  Info,
  CheckCircle,
  Clock,
  Settings,
  Building,
  MapPin
} from 'lucide-react';

interface ProjectListProps {
  projects: Project[];
  onSelectProject: (p: Project) => void;
  onCreateProject: (name: string, w: number, l: number, h: number, sahne: string, kurum: string) => void;
  onDeleteProject: (id: string) => void;
  onRenameProject: (id: string, newName: string) => void;
}

export default function ProjectList({
  projects,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
  onRenameProject
}: ProjectListProps) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [name, setName] = useState('');
  const [width, setWidth] = useState<number>(12);
  const [length, setLength] = useState<number>(8);
  const [height, setHeight] = useState<number>(6);
  const [sahne, setSahne] = useState('');
  const [kurum, setKurum] = useState('');

  // For renaming
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !sahne.trim() || !kurum.trim()) return;
    onCreateProject(name.trim(), width, length, height, sahne.trim(), kurum.trim());
    setName('');
    setSahne('');
    setKurum('');
    setWidth(12);
    setLength(8);
    setHeight(6);
    setShowCreateModal(false);
  };

  const getStatusBadge = (p: Project) => {
    if (!p.scriptText) {
      return (
        <span className="flex items-center gap-1.5 text-[10px] uppercase font-mono tracking-wider font-bold bg-[#0a0a0a] border border-[#2a2a2a] text-zinc-500 px-2.5 py-1 rounded">
          <Clock className="w-3 h-3" /> Metin Bekliyor
        </span>
      );
    }
    if (p.sceneBoundaries && p.sceneBoundaries.length > 0 && !p.sceneBoundaries.some(b => b.approved)) {
      return (
        <span className="flex items-center gap-1.5 text-[10px] uppercase font-mono tracking-wider font-bold bg-[#1c1c1c] border border-gold-border text-gold px-2.5 py-1 rounded">
          <Clock className="w-3 h-3" /> Ayrıştırma Bekliyor
        </span>
      );
    }
    if (p.analysis && p.analysis.aksesuarlar.length > 0) {
      return (
        <span className="flex items-center gap-1.5 text-[10px] uppercase font-mono tracking-wider font-bold bg-[#111] border border-green-900/40 text-green-400 px-2.5 py-1 rounded">
          <CheckCircle className="w-3 h-3" /> Analiz Edildi
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1.5 text-[10px] uppercase font-mono tracking-wider font-bold bg-[#111] border border-blue-900/40 text-blue-400 px-2.5 py-1 rounded">
        <Clock className="w-3 h-3" /> Analiz Bekliyor
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-serif italic text-gold tracking-wide">Projelerim</h2>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-gold hover:bg-gold-hover text-black rounded text-xs uppercase tracking-widest font-bold transition-all shadow-[0_0_15px_rgba(197,160,89,0.2)]"
          id="btn-new-project-trigger"
        >
          <Plus className="w-4 h-4 text-black stroke-[3px]" /> Yeni Proje Ekle
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="bg-[#111] border border-[#2a2a2a] rounded-lg p-16 text-center max-w-lg mx-auto shadow-2xl">
          <Folder className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
          <h3 className="text-base font-serif italic text-gold">Proje Havuzu Boş</h3>
          <p className="text-xs text-zinc-500 mt-2 leading-relaxed">
            Henüz oluşturulmuş bir sahne tasarımı projesi yok. Hemen yeni bir proje ekleyip senaryo metnini yükleyin.
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="mt-6 px-4 py-2 bg-[#2a2a2a] hover:bg-[#333] border border-[#3d3d3d] text-zinc-300 rounded text-xs font-bold uppercase tracking-widest"
            id="btn-new-project-empty"
          >
            İlk Projemi Oluştur
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((p) => (
            <div
              key={p.id}
              className="bg-[#111] border border-[#2a2a2a] hover:border-gold/40 rounded-lg p-5 flex flex-col justify-between transition-all duration-300 shadow-xl group"
            >
              <div className="space-y-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1 mr-2">
                    {editingId === p.id ? (
                      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && editName.trim()) {
                              onRenameProject(p.id, editName.trim());
                              setEditingId(null);
                            } else if (e.key === 'Escape') {
                              setEditingId(null);
                            }
                          }}
                          className="bg-[#0a0a0a] border border-[#2a2a2a] rounded px-2 py-1 text-sm font-semibold text-[#e0e0e0] outline-none w-full focus:border-gold"
                          autoFocus
                          id={`input-rename-${p.id}`}
                        />
                        <button
                          onClick={() => {
                            if (editName.trim()) {
                              onRenameProject(p.id, editName.trim());
                              setEditingId(null);
                            }
                          }}
                          className="text-xs text-gold font-bold px-1"
                          id={`btn-save-rename-${p.id}`}
                        >
                          Tamam
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 group-hover:text-gold transition-colors cursor-pointer" onClick={() => onSelectProject(p)}>
                        <Folder className="w-4 h-4 text-gold shrink-0" />
                        <h3 className="font-serif italic text-[#e0e0e0] group-hover:text-gold text-base leading-snug line-clamp-1 truncate">{p.name}</h3>
                      </div>
                    )}
                    
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <span className="inline-flex items-center gap-1 text-[10px] bg-red-950/20 border border-red-900/30 text-red-400 px-2 py-0.5 rounded font-mono">
                        <MapPin className="w-2.5 h-2.5 shrink-0 text-red-400" />
                        Sahne: {p.sahne || 'Belirtilmedi'}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[10px] bg-blue-950/20 border border-blue-900/30 text-blue-400 px-2 py-0.5 rounded font-mono">
                        <Building className="w-2.5 h-2.5 shrink-0 text-blue-400" />
                        Yapım: {p.kurum || 'Belirtilmedi'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingId(p.id);
                        setEditName(p.name);
                      }}
                      className="p-1 text-zinc-500 hover:text-[#c5a059] rounded hover:bg-[#222] transition-colors"
                      title="Yeniden adlandır"
                      id={`btn-trigger-rename-${p.id}`}
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`"${p.name}" projesini kalıcı olarak silmek istediğinize emin misiniz?`)) {
                          onDeleteProject(p.id);
                        }
                      }}
                      className="p-1 text-zinc-500 hover:text-red-400 rounded hover:bg-[#222] transition-colors"
                      title="Sil"
                      id={`btn-delete-${p.id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Stage Dimensions */}
                <div className="grid grid-cols-3 gap-2 py-2.5 px-3 bg-[#0a0a0a] rounded border border-[#2a2a2a] text-center text-xs">
                  <div>
                    <span className="text-[9px] text-zinc-500 block uppercase tracking-wider font-mono">En (Genişlik)</span>
                    <span className="font-bold text-gold font-mono mt-0.5 block">{p.width}m</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-zinc-500 block uppercase tracking-wider font-mono">Boy (Derinlik)</span>
                    <span className="font-bold text-gold font-mono mt-0.5 block">{p.length}m</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-zinc-500 block uppercase tracking-wider font-mono">Yükseklik</span>
                    <span className="font-bold text-gold font-mono mt-0.5 block">{p.height}m</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-[#2a2a2a] mt-4 pt-3.5 text-[11px]">
                <div className="flex items-center gap-1.5 text-zinc-500">
                  <Calendar className="w-3 h-3" />
                  <span>{new Date(p.createdAt).toLocaleDateString('tr-TR')}</span>
                </div>
                {getStatusBadge(p)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-[#111] border border-[#2a2a2a] rounded-lg w-full max-w-md max-h-[90dvh] flex flex-col overflow-hidden shadow-2xl">
            <div className="px-6 py-4 border-b border-[#2a2a2a] bg-[#0a0a0a] flex items-center justify-between shrink-0">
              <h3 className="font-serif italic text-base text-gold tracking-wide">Yeni Sahne Tasarım Projesi</h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-zinc-500 hover:text-gold text-xl font-bold transition-colors"
                id="btn-close-modal"
              >
                ×
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-[10px] font-semibold text-zinc-400 mb-1.5 uppercase font-mono tracking-widest">Proje Adı</label>
                <input
                  type="text"
                  required
                  placeholder="Örn: Hamlet - Modern Sahneleme"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-[#e0e0e0] outline-none focus:border-gold placeholder:opacity-30"
                  id="input-project-name"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-zinc-400 mb-1.5 uppercase font-mono tracking-widest">Sahne</label>
                <input
                  type="text"
                  required
                  placeholder="Örn: Büyük Sahne, Stüdyo Sahne veya AKM"
                  value={sahne}
                  onChange={(e) => setSahne(e.target.value)}
                  className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-[#e0e0e0] outline-none focus:border-gold placeholder:opacity-30"
                  id="input-project-sahne"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-zinc-400 mb-1.5 uppercase font-mono tracking-widest">Kurum / Yapım</label>
                <input
                  type="text"
                  required
                  placeholder="Örn: Devlet Tiyatroları, Şehir Tiyatroları"
                  value={kurum}
                  onChange={(e) => setKurum(e.target.value)}
                  className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-[#e0e0e0] outline-none focus:border-gold placeholder:opacity-30"
                  id="input-project-kurum"
                />
              </div>

              <div className="bg-[#0a0a0a] p-4 rounded border border-[#2a2a2a]">
                <div className="flex items-center gap-1.5 text-[#c5a059] mb-3 text-xs font-serif italic">
                  <Maximize2 className="w-3.5 h-3.5 text-gold" />
                  <span className="font-bold tracking-wide">Sahne Fiziksel Ölçüleri (Metrik)</span>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[9px] font-semibold text-zinc-500 mb-1 font-mono uppercase tracking-wider">En (Genişlik)</label>
                    <div className="relative">
                      <input
                        type="number"
                        required
                        min="1"
                        max="100"
                        step="0.1"
                        value={width}
                        onChange={(e) => setWidth(parseFloat(e.target.value) || 0)}
                        className="w-full bg-[#161616] border border-[#2a2a2a] rounded px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-gold font-mono pr-6"
                        id="input-stage-w"
                      />
                      <span className="absolute right-2 top-2 text-[9px] text-zinc-600 font-mono">m</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[9px] font-semibold text-zinc-500 mb-1 font-mono uppercase tracking-wider">Boy (Derinlik)</label>
                    <div className="relative">
                      <input
                        type="number"
                        required
                        min="1"
                        max="100"
                        step="0.1"
                        value={length}
                        onChange={(e) => setLength(parseFloat(e.target.value) || 0)}
                        className="w-full bg-[#161616] border border-[#2a2a2a] rounded px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-gold font-mono pr-6"
                        id="input-stage-l"
                      />
                      <span className="absolute right-2 top-2 text-[9px] text-zinc-600 font-mono">m</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[9px] font-semibold text-zinc-500 mb-1 font-mono uppercase tracking-wider">Yükseklik</label>
                    <div className="relative">
                      <input
                        type="number"
                        required
                        min="1"
                        max="50"
                        step="0.1"
                        value={height}
                        onChange={(e) => setHeight(parseFloat(e.target.value) || 0)}
                        className="w-full bg-[#161616] border border-[#2a2a2a] rounded px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-gold font-mono pr-6"
                        id="input-stage-h"
                      />
                      <span className="absolute right-2 top-2 text-[9px] text-zinc-600 font-mono">m</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 text-[10px] text-zinc-500 leading-normal font-mono">
                <Info className="w-3.5 h-3.5 text-gold shrink-0" />
                <span>Sahne ölçüleri, "Teknik Çizim" modülünde orantılı planlama yapmak için kullanılacaktır.</span>
              </div>

              <div className="flex justify-end gap-2 border-t border-[#2a2a2a] pt-4 mt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 bg-[#2a2a2a] hover:bg-[#333] border border-[#3d3d3d] text-zinc-300 rounded text-xs font-bold uppercase tracking-widest transition-colors"
                  id="btn-cancel-modal"
                >
                  Vazgeç
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#c5a059] hover:bg-[#d9b87a] text-black rounded text-xs font-bold uppercase tracking-widest transition-colors"
                  id="btn-submit-modal"
                >
                  Proje Oluştur
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
