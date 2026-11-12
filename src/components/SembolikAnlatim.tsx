import { useState } from 'react';
import { Project } from '../types';
import { 
  Compass, 
  Sparkles, 
  RefreshCw, 
  RotateCcw, 
  ListOrdered,
  Layers,
  HelpCircle
} from 'lucide-react';

interface SembolikAnlatimProps {
  project: Project;
  onUpdateProject: (p: Project) => void;
}

export function SembolikAnlatimView({ project, onUpdateProject }: SembolikAnlatimProps) {
  const [instruction, setInstruction] = useState(project.symbolicInstruction || '');
  const [history, setHistory] = useState<any[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [err, setErr] = useState('');

  const symbolicRows = project.symbolicAnalysis || [];
  const metaphors = project.symbolicMetaphors || [];
  const scriptLength = project.scriptText?.length || 0;

  const handleGenerateSymbolic = async () => {
    setIsGenerating(true);
    setErr('');
    try {
      const storedKey = localStorage.getItem('ANTHROPIC_API_KEY') || localStorage.getItem('anthropicApiKey') || '';
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (storedKey) {
        headers['x-anthropic-api-key'] = storedKey;
      }

      const response = await fetch('/api/generate-symbolic-analysis', {
        method: 'POST',
        headers,
        body: JSON.stringify({ project, instruction })
      });
      if (!response.ok) {
        throw new Error('Sembolik göstergebilimsel analiz gerçekleştirilemedi.');
      }
      const result = await response.json();

      if (project.symbolicAnalysis) {
        setHistory(prev => [[project.symbolicAnalysis, project.symbolicMetaphors], ...prev.slice(0, 4)]);
      }

      onUpdateProject({
        ...project,
        symbolicAnalysis: result.symbolicAnalysis,
        symbolicMetaphors: result.symbolicMetaphors,
        symbolicInstruction: instruction
      });
    } catch (error: any) {
      setErr(error.message || 'Bir hata oluştu.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRestoreHistory = () => {
    if (history.length === 0) return;
    const [prevAnalysis, prevMetaphors] = history[0];
    const newHistory = history.slice(1);
    setHistory(newHistory);
    onUpdateProject({
      ...project,
      symbolicAnalysis: prevAnalysis,
      symbolicMetaphors: prevMetaphors
    });
  };

  return (
    <div className="my-6 space-y-6">
      {/* Previous step summary */}
      <div className="bg-[#111] border border-[#2a2a2a] p-4 rounded flex items-center justify-between text-xs font-mono text-zinc-500">
        <div>
          <span className="text-zinc-400 font-bold font-sans">ADHD Asistan Özet Paneli:</span> 
          <span className="ml-2">Toplam {scriptLength} karakter oyun metni tespit edildi. Tasarım ölçüleri: {project.width}m x {project.length}m.</span>
        </div>
        <span className="text-red-500 font-serif italic">Eto'nun sahne tasarımı asistanı</span>
      </div>

      <div className="bg-[#111] border border-[#2a2a2a] rounded p-6 shadow-2xl space-y-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-serif italic text-white flex items-center gap-2">
              <Compass className="w-5 h-5 text-red-500" />
              Sembolik Anlatım ve Göstergebilimsel Alt Metin
            </h3>
            <p className="text-xs text-zinc-400 mt-1">Oyunun gizli temalarını, sembol potansiyeli yüksek nesneleri ve sahneleme metaforlarını analiz edin.</p>
          </div>
          <button
            onClick={handleGenerateSymbolic}
            disabled={isGenerating}
            className="px-4 py-2 bg-red-600 text-white rounded text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 hover:bg-red-700 disabled:opacity-50 transition-colors shrink-0"
          >
            {isGenerating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Sembolik Analiz Çalıştır
          </button>
        </div>

        {/* Integration Notification Badge */}
        <div className="bg-[#0f1d15] border border-emerald-900/40 p-4 rounded text-xs text-emerald-400 font-sans leading-relaxed flex items-start gap-3">
          <Layers className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold uppercase tracking-wider block mb-1 text-[10px] font-mono text-emerald-300">Otomatik Bağlantı Aktif:</span>
            Bu sekmedeki sembol ve alt metin bulguları, <strong>Sunum Dosyası</strong> sekmesindeki sanatsal slogan ve açıklama ("Sözsel Dil") kurgulanırken Gemini'a otomatik olarak bağlam (context) olarak aktarılır!
          </div>
        </div>

        {/* Instruction Form */}
        <div className="bg-[#0a0a0a] border border-[#222] p-4 rounded-lg space-y-3">
          <label className="text-xs font-mono text-zinc-400 uppercase tracking-wider block">Dramaturg Sembolik Düzeltme Talimatı</label>
          <div className="flex gap-2">
            <textarea
              value={instruction}
              onChange={(e) => {
                setInstruction(e.target.value);
                onUpdateProject({ ...project, symbolicInstruction: e.target.value });
              }}
              placeholder="Örneğin: 'Modernist metaforları vurgula, nesnelerin soyut anlamlarını ön plana çıkar, her imgeyi tiyatro mekanının sol/sağ dağılımıyla ilişkilendir...'"
              className="flex-1 bg-[#111] border border-[#2a2a2a] rounded p-2.5 text-xs text-zinc-300 outline-none focus:border-red-500 h-12 resize-none"
            />
            <div className="flex flex-col gap-1">
              <button
                onClick={handleGenerateSymbolic}
                disabled={isGenerating || !instruction}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold uppercase tracking-wider rounded disabled:opacity-50"
              >
                Uygula
              </button>
              {history.length > 0 && (
                <button
                  onClick={handleRestoreHistory}
                  className="px-3 py-1 bg-transparent hover:text-red-400 text-zinc-500 text-[10px] font-mono flex items-center justify-center gap-1"
                  title="Önceki versiyona geri dön"
                >
                  <RotateCcw className="w-3 h-3" />
                  Geri Al
                </button>
              )}
            </div>
          </div>
        </div>

        {err && (
          <div className="p-3 bg-red-950/20 border border-red-500/30 rounded text-red-400 text-xs font-mono">
            {err}
          </div>
        )}

        {/* Symbolic Analysis Table */}
        {symbolicRows.length === 0 ? (
          <div className="h-48 border-2 border-dashed border-[#2a2a2a] rounded flex flex-col items-center justify-center text-center p-6 text-zinc-500">
            <Compass className="w-12 h-12 text-zinc-600 mb-2 stroke-1" />
            <p className="text-xs font-serif italic">Sembolik analiz henüz yapılmamış.</p>
            <p className="text-[10px] text-zinc-600 font-mono mt-1">Metni gözden geçirmek ve sembolik imalat önerileri çıkartmak için yukarıdaki butona basın.</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-zinc-300 border border-[#2a2a2a]">
                <thead className="bg-[#0a0a0a] text-[9px] uppercase font-mono tracking-widest text-zinc-500 border-b border-[#2a2a2a]">
                  <tr>
                    <th className="p-3">Obje / İmge</th>
                    <th className="p-3">Geçtiği Sahne / Perde</th>
                    <th className="p-3">Anlam / Çağrışım (Alt Metin)</th>
                    <th className="p-3">Görsel Dile Yansıma Önerisi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2a2a2a]">
                  {symbolicRows.map((row: any, idx: number) => (
                    <tr key={idx} className="hover:bg-[#0a0a0a]/40 transition-colors">
                      <td className="p-3 font-serif italic text-base text-red-400">{row.object}</td>
                      <td className="p-3 text-zinc-400 font-mono text-[11px]">{row.occurrence}</td>
                      <td className="p-3 text-zinc-300">{row.meaning}</td>
                      <td className="p-3 text-zinc-400 italic font-sans leading-relaxed">{row.visualLanguage}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Recurring Metaphors list section */}
            {metaphors.length > 0 && (
              <div className="bg-[#0a0a0a] border border-[#222] p-5 rounded space-y-3">
                <h4 className="text-xs font-mono text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                  <ListOrdered className="w-4 h-4 text-red-500" />
                  Metinde Tekrar Eden Benzetmeler ve Metafor Kalıpları
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                  {metaphors.map((meta: string, mIdx: number) => (
                    <div key={mIdx} className="bg-[#111] p-3 rounded border border-[#222] text-xs font-serif italic text-zinc-300 flex items-start gap-2.5">
                      <span className="text-red-500 font-bold">#{mIdx + 1}</span>
                      <span>{meta}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
