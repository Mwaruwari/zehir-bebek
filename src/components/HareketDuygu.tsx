import { useState, useEffect } from 'react';
import { Project } from '../types';
import { sanitizeProjectForApi } from '../utils/apiPayload';
import { 
  TrendingUp, 
  Sparkles, 
  Download, 
  RotateCcw, 
  RefreshCw, 
  FileText, 
  Image as ImageIcon,
  Flame,
  ArrowUp,
  ArrowDown
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { jsPDF } from 'jspdf';

interface HareketDuyguProps {
  project: Project;
  onUpdateProject: (p: Project) => void;
  addLog?: (level: 'info' | 'error', message: string) => void;
}

// Bulletproof Turkish character helper for jsPDF
function normalizeTurkishForPdf(text: string): string {
  if (!text) return '';
  return text
    .replace(/ç/g, 'c').replace(/Ç/g, 'C')
    .replace(/ğ/g, 'g').replace(/Ğ/g, 'G')
    .replace(/ı/g, 'i').replace(/İ/g, 'I')
    .replace(/ö/g, 'o').replace(/Ö/g, 'O')
    .replace(/ş/g, 's').replace(/Ş/g, 'S')
    .replace(/ü/g, 'u').replace(/Ü/g, 'U');
}

// Auto line-wrapping for jsPDF reports
function renderWrappedText(doc: jsPDF, text: unknown, x: number, y: number, maxWidth: number, lineHeight: number = 6): number {
  // Model-generated fields are not guaranteed to be present or to be strings.
  // Calling .split() on undefined threw a TypeError that aborted the whole
  // export, so the download button appeared to do nothing at all.
  const safeText = typeof text === 'string' ? text : (text == null ? '' : String(text));
  const words = safeText.split(' ');
  let line = '';
  let currentY = y;
  
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const testWidth = doc.getTextWidth(normalizeTurkishForPdf(testLine));
    if (testWidth > maxWidth && n > 0) {
      doc.text(normalizeTurkishForPdf(line), x, currentY);
      line = words[n] + ' ';
      currentY += lineHeight;
      if (currentY > 280) {
        doc.addPage();
        currentY = 20;
      }
    } else {
      line = testLine;
    }
  }
  doc.text(normalizeTurkishForPdf(line), x, currentY);
  return currentY + lineHeight;
}

export function HareketDuyguView({ project, onUpdateProject, addLog }: HareketDuyguProps) {
  const [instruction, setInstruction] = useState(project.movementEmotionInstruction || '');
  const [history, setHistory] = useState<any[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [err, setErr] = useState('');
  const [progressInfo, setProgressInfo] = useState<{ current: number; total: number; eta: string } | null>(null);

  const chartData = project.movementEmotionData || [];
  const scenesCount = project.scenes?.length || 0;
  const eventsCount = project.analysis?.olaylar?.length || 0;

  // 1. Client-side debug logging of raw scores in the console as requested
  useEffect(() => {
    if (chartData && chartData.length > 0) {
      console.log("=== HAREKET-DUYGU HAM PUANLARI (DEBUG) ===");
      chartData.forEach((item: any) => {
        const mVal = item.isMissing ? 'VERİ EKSİK' : item.movement;
        const eVal = item.isMissing ? 'VERİ EKSİK' : item.emotion;
        console.log(`Sahne ${item.sceneName}: Hareket=${mVal}, Duygu=${eVal}`);
      });
      console.log("==========================================");
    }
  }, [chartData]);

  // Transform data for plotting solid and dashed lines
  const processedChartData = chartData.map((item: any) => {
    const isMissing = item.isMissing || item.emotion === null || item.emotion === undefined || item.movement === null || item.movement === undefined;
    return {
      ...item,
      emotion: isMissing ? null : item.emotion,
      movement: isMissing ? null : item.movement,
      missingEmotion: isMissing ? 5 : item.emotion,
      missingMovement: isMissing ? 5 : item.movement,
      isMissing
    };
  });

  // AI Rhythm generation
  const handleGenerateGraph = async () => {
    setIsGenerating(true);
    setErr('');
    setProgressInfo(null);
    if (addLog) {
      addLog('info', `Hareket ve Duygu analizi başlatılıyor... Toplam sahne sayısı: ${scenesCount}`);
    }
    
    let progressInterval: any = null;
    
    try {
      // Start polling progress
      progressInterval = setInterval(async () => {
        try {
          const progressRes = await fetch(`/api/generate-movement-emotion/progress/${project.id}`);
          if (progressRes.ok) {
            const progressData = await progressRes.json();
            if (progressData && progressData.total > 0) {
              setProgressInfo(progressData);
            }
          }
        } catch (pollErr) {
          console.error("Polling progress failed:", pollErr);
        }
      }, 1500);

      const storedKey = localStorage.getItem('ANTHROPIC_API_KEY') || localStorage.getItem('anthropicApiKey') || '';
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (storedKey) {
        headers['x-anthropic-api-key'] = storedKey;
      }

      const response = await fetch('/api/generate-movement-emotion', {
        method: 'POST',
        headers,
        body: JSON.stringify({ project: sanitizeProjectForApi(project), instruction })
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Grafik ritim katsayıları üretilemedi (HTTP ${response.status}).`);
      }
      const result = await response.json();
      
      // Keep history
      if (project.movementEmotionData) {
        setHistory(prev => [project.movementEmotionData, ...prev.slice(0, 4)]);
      }

      const processedCount = result.data?.length || 0;
      if (addLog) {
        addLog('info', `Hareket-Duygu analizi tamamlandı: ${processedCount} sahne işlendi.`);
      }

      onUpdateProject({
        ...project,
        movementEmotionData: result.data,
        movementEmotionInstruction: instruction
      });
    } catch (error: any) {
      setErr(error.message || 'Bir hata oluştu.');
      if (addLog) {
        addLog('error', `Hareket-Duygu analizi başarısız oldu: ${error.message}`);
      }
    } finally {
      setIsGenerating(false);
      setProgressInfo(null);
      if (progressInterval) {
        clearInterval(progressInterval);
      }
    }
  };

  // Restore previous version
  const handleRestoreHistory = () => {
    if (history.length === 0) return;
    const previous = history[0];
    const newHistory = history.slice(1);
    setHistory(newHistory);
    onUpdateProject({
      ...project,
      movementEmotionData: previous
    });
  };

  // Calculate high / low highlights (skipping missing values)
  let highestEmotion: any = null;
  let lowestEmotion: any = null;
  let highestMovement: any = null;
  let lowestMovement: any = null;
  let highestTempoScene: any = null;
  let lowestTempoScene: any = null;

  const validChartData = processedChartData.filter((item: any) => !item.isMissing);

  if (validChartData.length > 0) {
    highestEmotion = [...validChartData].sort((a, b) => (b.emotion || 0) - (a.emotion || 0))[0];
    lowestEmotion = [...validChartData].sort((a, b) => (a.emotion || 0) - (b.emotion || 0))[0];
    highestMovement = [...validChartData].sort((a, b) => (b.movement || 0) - (a.movement || 0))[0];
    lowestMovement = [...validChartData].sort((a, b) => (a.movement || 0) - (b.movement || 0))[0];
    
    // Average tempo = (emotion + movement) / 2
    const withTempo = validChartData.map(item => ({
      ...item,
      tempo: ((item.emotion || 0) + (item.movement || 0)) / 2
    }));
    highestTempoScene = [...withTempo].sort((a, b) => b.tempo - a.tempo)[0];
    lowestTempoScene = [...withTempo].sort((a, b) => a.tempo - b.tempo)[0];
  }

  // PDF Report Download
  const handleDownloadPdf = () => {
    try {
        if (chartData.length === 0) return;
        const doc = new jsPDF();
    
        // Header
        doc.setFillColor(17, 17, 17);
        doc.rect(0, 0, 210, 40, 'F');
        doc.setTextColor(197, 160, 89);
        doc.setFont('times', 'italic');
        doc.setFontSize(22);
        doc.text(normalizeTurkishForPdf('ZEHIR BEBEK - REJI HAREKET VE DUYGU ANALIZI'), 15, 20);
    
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(120, 120, 120);
        doc.text(normalizeTurkishForPdf("Eto'nun Sahne Tasarimi Asistani Tarafindan Otomatik Uretilmistir"), 15, 30);
        doc.text(new Date().toLocaleDateString('tr-TR'), 175, 30);

        let y = 50;

        // Project Info Block
        doc.setFillColor(245, 245, 245);
        doc.rect(15, y, 180, 25, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(40, 40, 40);
        doc.text(normalizeTurkishForPdf(`PROJE ADI: ${project.name}`), 20, y + 8);
        doc.setFont('helvetica', 'normal');
        doc.text(normalizeTurkishForPdf(`Olculer: ${project.width}m x ${project.length}m x ${project.height}m  |  Sahne Sayisi: ${scenesCount}`), 20, y + 16);
        y += 35;

        // Highlights Block
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(197, 160, 89);
        doc.text(normalizeTurkishForPdf('GRAFIK TEPE VE DIP NOKTALARI ANALIZI'), 15, y);
        y += 8;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(60, 60, 60);

        if (highestTempoScene) {
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(180, 50, 50);
          doc.text(normalizeTurkishForPdf(`* EN YUKSEK TEMPO (ZIRVE): ${highestTempoScene.sceneName} (Ortalama: ${highestTempoScene.tempo}/10)`), 15, y);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(60, 60, 60);
          y = renderWrappedText(doc, `Gerekce: ${highestTempoScene.justification}`, 20, y + 5, 170) + 3;
        }
        if (lowestTempoScene) {
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(50, 100, 150);
          doc.text(normalizeTurkishForPdf(`* EN DUSUK TEMPO (DIP): ${lowestTempoScene.sceneName} (Ortalama: ${lowestTempoScene.tempo}/10)`), 15, y);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(60, 60, 60);
          y = renderWrappedText(doc, `Gerekce: ${lowestTempoScene.justification}`, 20, y + 5, 170) + 6;
        }

        if (highestEmotion) {
          doc.setFont('helvetica', 'bold');
          doc.text(normalizeTurkishForPdf(`* DUYGUSAL EN UST SAHNE: ${highestEmotion.sceneName} (Puan: ${highestEmotion.emotion}/10)`), 15, y);
          doc.setFont('helvetica', 'normal');
          y = renderWrappedText(doc, `Gerekce: ${highestEmotion.justification}`, 20, y + 5, 170) + 3;
        }
        if (highestMovement) {
          doc.setFont('helvetica', 'bold');
          doc.text(normalizeTurkishForPdf(`* FIZIKSEL HAREKET EN UST SAHNE: ${highestMovement.sceneName} (Puan: ${highestMovement.movement}/10)`), 15, y);
          doc.setFont('helvetica', 'normal');
          y = renderWrappedText(doc, `Gerekce: ${highestMovement.justification}`, 20, y + 5, 170) + 10;
        }

        // Chronological Table
        doc.addPage();
        y = 20;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(197, 160, 89);
        doc.text(normalizeTurkishForPdf('KRONOLOJIK SAHNE RITIM TABLOSU'), 15, y);
        y += 10;

        chartData.forEach((row: any) => {
          if (y > 260) {
            doc.addPage();
            y = 20;
          }
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(10);
          doc.setTextColor(20, 20, 20);
          doc.text(normalizeTurkishForPdf(`${row.sceneName}`), 15, y);
      
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9);
          doc.setTextColor(100, 100, 100);
          const scoresText = row.isMissing 
            ? '[VERI EKSIK - Analiz Edilemedi]' 
            : `[Duygu: ${row.emotion}/10 | Hareket: ${row.movement}/10]`;
          doc.text(normalizeTurkishForPdf(scoresText), 120, y);
      
          y = renderWrappedText(doc, row.justification, 15, y + 5, 180, 5) + 6;
        });

        doc.save(`${project.name.replace(/\s+/g, '_')}_reji_ritim_analizi.pdf`);
    } catch (pdfErr: any) {
      console.error('Ritim raporu PDF hatası:', pdfErr);
      setErr(`PDF oluşturulamadı: ${pdfErr?.message || 'bilinmeyen hata'}`);
    }
  };

  // SVG Visual Export helper
  const handleExportSvg = () => {
    const svgElement = document.querySelector('.recharts-wrapper svg');
    if (!svgElement) {
      setErr('Grafik görseli bulunamadı. Lütfen önce analiz üretin.');
      return;
    }
    try {
      const svgString = new XMLSerializer().serializeToString(svgElement);
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const svgUrl = URL.createObjectURL(svgBlob);
      const downloadLink = document.createElement('a');
      downloadLink.href = svgUrl;
      downloadLink.download = `${project.name.replace(/\s+/g, '_')}_reji_ritim_grafigi.svg`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
    } catch (e: any) {
      console.error(e);
      setErr('Görsel dışa aktarılırken hata oluştu.');
    }
  };

  // Custom HTML Tooltip for Recharts
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-[#111215] border border-red-900/40 p-4.5 rounded-lg shadow-2xl max-w-sm space-y-3 font-sans">
          <p className="text-xs font-bold text-red-500 font-mono tracking-wider uppercase border-b border-[#222] pb-1">{data.sceneName || label}</p>
          {data.isMissing ? (
            <div className="bg-zinc-950 border border-zinc-800 p-3 rounded text-center">
              <span className="text-xs font-bold text-zinc-500 font-mono block">⚠️ ANALİZ VERİSİ EKSİK</span>
              <span className="text-[10px] text-zinc-600 block mt-1">Yapay zeka bu sahneyi henüz analiz edemedi.</span>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-red-950/20 border border-red-900/30 p-2 rounded">
                <span className="text-[9px] text-zinc-500 font-mono block">DUYGU YOĞUNLUĞU</span>
                <span className="text-sm font-black text-red-500 font-mono">{data.emotion} / 10</span>
              </div>
              <div className="bg-amber-950/20 border border-amber-900/30 p-2 rounded">
                <span className="text-[9px] text-zinc-500 font-mono block">FİZİKSEL HAREKET</span>
                <span className="text-sm font-black text-amber-500 font-mono">{data.movement} / 10</span>
              </div>
            </div>
          )}
          <p className="text-[11px] text-zinc-400 leading-relaxed font-serif italic border-t border-[#222] pt-2">
            "{data.justification}"
          </p>
        </div>
      );
    }
    return null;
  };

  const renderCustomDot = (color: string) => (props: any) => {
    const { cx, cy, payload } = props;
    if (payload.isMissing) {
      return (
        <circle 
          cx={cx} 
          cy={cy} 
          r={5} 
          fill="#111215" 
          stroke="#4b5563" 
          strokeWidth={1.5} 
          strokeDasharray="2 2"
        />
      );
    }
    return <circle cx={cx} cy={cy} r={4} fill={color} />;
  };

  return (
    <div className="my-6 space-y-6">
      {/* Small summary panel */}
      <div className="bg-[#111] border border-[#2a2a2a] p-4 rounded flex items-center justify-between text-xs font-mono text-zinc-500">
        <div>
          <span className="text-zinc-400 font-bold font-sans">ADHD Asistan Özet Paneli:</span> 
          <span className="ml-2">Toplam {scenesCount} senaryo sahnesi ve {eventsCount} analiz olay kaydı tespit edildi.</span>
        </div>
        <span className="text-red-500 font-serif italic">Eto'nun sahne tasarımı asistanı</span>
      </div>

      <div className="bg-[#111] border border-[#2a2a2a] rounded p-6 shadow-2xl space-y-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-serif italic text-white flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-red-500" />
              Sahne Ritmi, Hareket ve Duygu Grafiği
            </h3>
            <p className="text-xs text-zinc-400 mt-1">Sahnelerin fiziksel aksiyon ve psikolojik gerilim zirvelerini iki eksenli reji eğrisiyle takip edin.</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleGenerateGraph}
              disabled={isGenerating || scenesCount === 0}
              className="px-4 py-2 bg-red-600 text-white rounded text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              {isGenerating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {chartData.length > 0 ? 'Ritim Eğrisini Güncelle' : 'Ritim Grafiği Üret'}
            </button>
            {chartData.length > 0 && (
              <>
                <button
                  onClick={handleExportSvg}
                  className="px-3 py-2 bg-zinc-800 border border-zinc-700 hover:border-red-500 text-zinc-300 rounded text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors"
                  title="Grafiği vektörel görsel (SVG) olarak bilgisayarınıza kaydeder"
                >
                  <ImageIcon className="w-4 h-4 text-red-500" />
                  Görsel İndir
                </button>
                <button
                  onClick={handleDownloadPdf}
                  className="px-3 py-2 bg-zinc-800 border border-zinc-700 hover:border-red-500 text-zinc-300 rounded text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors"
                >
                  <Download className="w-4 h-4 text-red-500" />
                  Raporu PDF İndir
                </button>
              </>
            )}
          </div>
        </div>

        {/* Correction instruction box */}
        <div className="bg-[#0a0a0a] border border-[#222] p-4 rounded-lg space-y-3">
          <label className="text-xs font-mono text-zinc-400 uppercase tracking-wider block">Yönetmen Ritim Düzeltme Talimatı</label>
          <div className="flex gap-2">
            <textarea
              value={instruction}
              onChange={(e) => {
                setInstruction(e.target.value);
                onUpdateProject({ ...project, movementEmotionInstruction: e.target.value });
              }}
              placeholder="Örnegin: 'Ikinci perdenin başındaki sahnede fiziksel aksiyonu daha yüksek tut, duygu geçisini yumusat...'"
              className="flex-1 bg-[#111] border border-[#2a2a2a] rounded p-2.5 text-xs text-zinc-300 outline-none focus:border-red-500 h-12 resize-none"
            />
            <div className="flex flex-col gap-1 shrink-0">
              <button
                onClick={handleGenerateGraph}
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

        {isGenerating && (
          <div className="p-4 bg-zinc-950 border border-red-500/30 rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-red-500 animate-spin" />
                <span className="text-xs font-mono text-zinc-300 font-semibold uppercase tracking-wider">
                  Yapay Zeka Ritim Analizi Devam Ediyor...
                </span>
              </div>
              {progressInfo && progressInfo.total > 0 && (
                <span className="text-xs font-mono text-zinc-400">
                  {progressInfo.current} / {progressInfo.total} Sahne Grubu
                </span>
              )}
            </div>
            
            {progressInfo && progressInfo.total > 0 ? (
              <div className="space-y-2">
                <div className="w-full bg-[#111] rounded-full h-2 overflow-hidden border border-[#222]">
                  <div 
                    className="bg-red-500 h-full rounded-full transition-all duration-500" 
                    style={{ width: `${(progressInfo.current / progressInfo.total) * 100}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
                  <span>
                    {progressInfo.current}/{progressInfo.total} sahne grubu işlendi
                  </span>
                  <span>
                    Tahmini kalan süre: <strong className="text-red-400">{progressInfo.eta}</strong>
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-[11px] font-mono text-zinc-500 animate-pulse">
                Sahneler hazırlanıyor ve analiz başlatılıyor...
              </div>
            )}
          </div>
        )}

        {err && (
          <div className="p-3 bg-red-950/20 border border-red-500/30 rounded text-red-400 text-xs font-mono">
            {err}
          </div>
        )}

        {chartData.length > 0 && chartData.length !== scenesCount && (
          <div className="p-4 bg-amber-950/20 border border-amber-500/30 rounded-lg text-amber-300 text-xs flex items-start gap-2.5 shadow-md">
            <span className="text-sm">⚠️</span>
            <div>
              <p className="font-bold mb-0.5">Sahneler ve Grafik Uyuşmazlığı Var</p>
              <p className="text-zinc-400">
                Metin Analizi'nde tespit edilen toplam <span className="text-amber-400 font-bold">{scenesCount}</span> sahne bulunmasına rağmen, bu grafiğe sadece <span className="text-amber-400 font-bold">{chartData.length}</span> sahne işlenebildi. 
                Tüm sahnelerin işlenmesi için "Ritim Grafiği Üret" butonuna basarak yapay zekayı yeniden çalıştırabilirsiniz.
              </p>
            </div>
          </div>
        )}

        {/* Recharts Graphical visualization */}
        {chartData.length === 0 ? (
          <div className="h-64 border-2 border-dashed border-[#2a2a2a] rounded flex flex-col items-center justify-center text-center p-6 text-zinc-500">
            <TrendingUp className="w-12 h-12 text-zinc-600 mb-2 stroke-1" />
            <p className="text-xs font-serif italic">Henüz ritim ve duygu analiz verisi bulunmuyor.</p>
            <p className="text-[10px] text-zinc-600 font-mono mt-1">Yapay zeka analizini çalıştırarak iki eksenli reji grafiğini çıkartın.</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="h-80 w-full bg-[#0a0a0a] p-4 rounded border border-[#2a2a2a] shadow-inner recharts-container">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={processedChartData} margin={{ top: 10, right: 10, left: -20, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
                  <XAxis 
                    dataKey="sceneName" 
                    stroke="#555" 
                    fontSize={9} 
                    tickLine={false} 
                    interval={0}
                    angle={-45}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis stroke="#555" fontSize={10} tickLine={false} domain={[0, 10]} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: '11px', color: '#888' }} />
                  
                  {/* Real data lines - breaks when isMissing is true */}
                  <Line 
                    type="monotone" 
                    name="Duygusal Yoğunluk" 
                    dataKey="emotion" 
                    stroke="#dc2626" 
                    strokeWidth={2.5} 
                    connectNulls={false}
                    activeDot={{ r: 7 }} 
                    dot={renderCustomDot('#dc2626')}
                  />
                  <Line 
                    type="monotone" 
                    name="Fiziksel Hareket" 
                    dataKey="movement" 
                    stroke="#f59e0b" 
                    strokeWidth={2} 
                    connectNulls={false}
                    dot={renderCustomDot('#f59e0b')}
                  />

                  {/* Dashed missing segment lines - connects across missing parts */}
                  <Line 
                    type="monotone" 
                    name="Duygu (Eksik Veri Tahmini)" 
                    dataKey="missingEmotion" 
                    stroke="#4b5563" 
                    strokeWidth={1.5} 
                    strokeDasharray="4 4"
                    connectNulls={true}
                    dot={false}
                    legendType="none"
                  />
                  <Line 
                    type="monotone" 
                    name="Hareket (Eksik Veri Tahmini)" 
                    dataKey="missingMovement" 
                    stroke="#71717a" 
                    strokeWidth={1.5} 
                    strokeDasharray="4 4"
                    connectNulls={true}
                    dot={false}
                    legendType="none"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Dynamic Analysis summary highlights */}
            <div className="space-y-3">
              <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 font-bold">RİTİM VE TEMPO SEVİYELERİ ÖZETİ</span>
              
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {highestTempoScene && (
                  <div className="bg-[#0a0a0a] border border-red-900/30 p-4 rounded space-y-1">
                    <div className="text-red-500 text-[9px] uppercase font-mono tracking-widest flex items-center gap-1 font-bold">
                      <Flame className="w-3.5 h-3.5" />
                      YÜKSEK TEMPO (ZİRVE)
                    </div>
                    <h4 className="text-sm font-serif italic text-zinc-200 truncate">{highestTempoScene.sceneName}</h4>
                    <div className="text-base font-serif italic text-red-500">{(highestTempoScene.tempo).toFixed(1)}/10 Ort.</div>
                    <p className="text-[11px] text-zinc-500 font-sans leading-snug line-clamp-3" title={highestTempoScene.justification}>
                      {highestTempoScene.justification}
                    </p>
                  </div>
                )}
                {lowestTempoScene && (
                  <div className="bg-[#0a0a0a] border border-zinc-800 p-4 rounded space-y-1">
                    <div className="text-zinc-400 text-[9px] uppercase font-mono tracking-widest flex items-center gap-1 font-bold">
                      <ArrowDown className="w-3.5 h-3.5 text-zinc-500" />
                      DÜŞÜK TEMPO (DİP)
                    </div>
                    <h4 className="text-sm font-serif italic text-zinc-200 truncate">{lowestTempoScene.sceneName}</h4>
                    <div className="text-base font-serif italic text-zinc-400">{(lowestTempoScene.tempo).toFixed(1)}/10 Ort.</div>
                    <p className="text-[11px] text-zinc-500 font-sans leading-snug line-clamp-3" title={lowestTempoScene.justification}>
                      {lowestTempoScene.justification}
                    </p>
                  </div>
                )}
                {highestEmotion && (
                  <div className="bg-[#0a0a0a] border border-red-900/30 p-4 rounded space-y-1">
                    <div className="text-red-500 text-[9px] uppercase font-mono tracking-widest flex items-center gap-1 font-bold">
                      <ArrowUp className="w-3.5 h-3.5 text-red-500" />
                      DUYGUSAL EN ÜST
                    </div>
                    <h4 className="text-sm font-serif italic text-zinc-200 truncate">{highestEmotion.sceneName}</h4>
                    <div className="text-base font-serif italic text-red-500">{highestEmotion.emotion}/10 Puan</div>
                    <p className="text-[11px] text-zinc-500 font-sans leading-snug line-clamp-3" title={highestEmotion.justification}>
                      {highestEmotion.justification}
                    </p>
                  </div>
                )}
                {highestMovement && (
                  <div className="bg-[#0a0a0a] border border-amber-900/30 p-4 rounded space-y-1">
                    <div className="text-amber-500 text-[9px] uppercase font-mono tracking-widest flex items-center gap-1 font-bold">
                      <ArrowUp className="w-3.5 h-3.5 text-amber-500" />
                      AKSİYON EN ÜST
                    </div>
                    <h4 className="text-sm font-serif italic text-zinc-200 truncate">{highestMovement.sceneName}</h4>
                    <div className="text-base font-serif italic text-amber-500">{highestMovement.movement}/10 Puan</div>
                    <p className="text-[11px] text-zinc-500 font-sans leading-snug line-clamp-3" title={highestMovement.justification}>
                      {highestMovement.justification}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
