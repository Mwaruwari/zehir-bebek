import { useState } from 'react';
import { Project, Aksesuar } from '../types';
import { sanitizeProjectForApi } from '../utils/apiPayload';
import { 
  ClipboardList, 
  ShoppingBag, 
  Hammer, 
  Clock, 
  Download, 
  RefreshCw, 
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  Workflow,
  ListOrdered
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';

interface UretimPlaniProps {
  project: Project;
  onUpdateProject: (p: Project) => void;
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

export function UretimPlanıView({ project, onUpdateProject }: UretimPlaniProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [err, setErr] = useState('');
  const [exportDropdownOpen, setExportDropdownOpen] = useState(false);

  const propsList = project.analysis?.aksesuarlar || [];
  const approvedDrawings = project.technicalDrawings?.filter(d => d.approved) || [];
  const hasApprovedDrawings = approvedDrawings.length > 0;

  const total = propsList.length;
  const toBuy = propsList.filter(p => p.status === 'Satın Alınacak').length;
  const toProduce = propsList.filter(p => p.status === 'Üretilecek').length;
  const pending = total - toBuy - toProduce;

  // AI-powered production plan generation
  const handleGenerateProductionPlan = async () => {
    setIsGenerating(true);
    setErr('');
    try {
      const response = await fetch('/api/generate-production-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: sanitizeProjectForApi(project) })
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `İmalat ve tedarik planı üretilemedi (HTTP ${response.status}).`);
      }
      const result = await response.json();

      onUpdateProject({
        ...project,
        productionPlanSummary: result.summary,
        productionPlanDetailed: result.detailed
      });
    } catch (error: any) {
      setErr(error.message || 'Bir hata oluştu.');
    } finally {
      setIsGenerating(false);
    }
  };

  // Status updates
  const handleStatusChange = (id: string, newStatus: 'Satın Alınacak' | 'Üretilecek' | '') => {
    if (!project.analysis) return;
    const updatedAksesuarlar = project.analysis.aksesuarlar.map(item => {
      if (item.id === id) {
        return { ...item, status: newStatus };
      }
      return item;
    });

    onUpdateProject({
      ...project,
      analysis: {
        ...project.analysis,
        aksesuarlar: updatedAksesuarlar
      }
    });
  };

  const handleScenesChange = (id: string, scenesStr: string) => {
    if (!project.analysis) return;
    const scenesArray = scenesStr.split(',').map(s => s.trim()).filter(Boolean);
    const updatedAksesuarlar = project.analysis.aksesuarlar.map(item => {
      if (item.id === id) {
        return { ...item, kullanildigiSahneler: scenesArray };
      }
      return item;
    });

    onUpdateProject({
      ...project,
      analysis: {
        ...project.analysis,
        aksesuarlar: updatedAksesuarlar
      }
    });
  };

  // Excel / CSV Export
  const handleExport = (format: 'xlsx' | 'csv') => {
    setExportDropdownOpen(false);
    if (propsList.length === 0) return;

    const exportData = propsList.map(item => ({
      'Öğe Adı': item.ad,
      'Durum (Satın Alınacak/Üretilecek)': item.status || 'Belirlenmedi',
      'Kullanıldığı Sahneler/Perde': item.kullanildigiSahneler?.join(', ') || 'Belirtilmedi',
      'Kullanım Notu': item.kaynakAlinti || item.aciklama || ''
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Envanter Listesi');

    if (format === 'xlsx') {
      XLSX.writeFile(workbook, `${project.name.replace(/\s+/g, '_')}_aksesuar_dekor_listesi.xlsx`);
    } else {
      const csvOutput = XLSX.utils.sheet_to_csv(worksheet);
      const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvOutput], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${project.name.replace(/\s+/g, '_')}_aksesuar_dekor_listesi.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  // Helper to add the categorised accessories section in the PDFs
  const appendAccessoriesToPdf = (doc: jsPDF, startY: number): number => {
    let y = startY;
    if (y > 230) {
      doc.addPage();
      y = 20;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(197, 160, 89);
    doc.text(normalizeTurkishForPdf('3. Aksesuar ve Dekor Gruplari'), 15, y);
    y += 8;

    // A. Satın Alınacaklar
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(180, 100, 30);
    doc.text(normalizeTurkishForPdf('A. SATIN ALINACAK DEKOR VE AKSESUARLAR'), 15, y);
    y += 6;

    const buyItems = propsList.filter(p => p.status === 'Satın Alınacak');
    if (buyItems.length === 0) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      doc.setTextColor(100, 100, 100);
      doc.text(normalizeTurkishForPdf('Satin alinacak aksesuar isaretlenmemistir.'), 20, y);
      y += 6;
    } else {
      buyItems.forEach(item => {
        if (y > 270) {
          doc.addPage();
          y = 20;
        }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(40, 40, 40);
        
        const isReused = (item.kullanildigiSahneler || []).length > 1;
        const repeatTag = isReused ? ' [TEKRAR KULLANILAN]' : '';
        const scenesTag = item.kullanildigiSahneler?.length ? ` (Sahneler: ${item.kullanildigiSahneler.join(', ')})` : '';

        doc.text(normalizeTurkishForPdf(`- ${item.ad}${repeatTag}${scenesTag}`), 20, y);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(90, 90, 90);
        y = renderWrappedText(doc, item.aciklama || 'Aciklama yok', 25, y + 4, 165, 5) + 2;
      });
    }

    y += 4;
    if (y > 250) {
      doc.addPage();
      y = 20;
    }

    // B. Üretilecekler
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(13, 148, 136);
    doc.text(normalizeTurkishForPdf('B. URETILECEK / ATOLYE IMALATI AKSESUARLAR'), 15, y);
    y += 6;

    const produceItems = propsList.filter(p => p.status === 'Üretilecek');
    if (produceItems.length === 0) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      doc.setTextColor(100, 100, 100);
      doc.text(normalizeTurkishForPdf('Atolyede uretilecek aksesuar isaretlenmemistir.'), 20, y);
      y += 6;
    } else {
      produceItems.forEach(item => {
        if (y > 270) {
          doc.addPage();
          y = 20;
        }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(40, 40, 40);

        const isReused = (item.kullanildigiSahneler || []).length > 1;
        const repeatTag = isReused ? ' [TEKRAR KULLANILAN]' : '';
        const scenesTag = item.kullanildigiSahneler?.length ? ` (Sahneler: ${item.kullanildigiSahneler.join(', ')})` : '';

        doc.text(normalizeTurkishForPdf(`- ${item.ad}${repeatTag}${scenesTag}`), 20, y);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(90, 90, 90);
        y = renderWrappedText(doc, item.aciklama || 'Aciklama yok', 25, y + 4, 165, 5) + 2;
      });
    }

    return y;
  };

  // Download Summarized PDF (Özet Plan)
  const handleDownloadSummaryPdf = () => {
    try {
        const summary = project.productionPlanSummary;
        if (!summary) return;

        const doc = new jsPDF();
    
        // Cover/Header
        doc.setFillColor(17, 17, 17);
        doc.rect(0, 0, 210, 40, 'F');
        doc.setTextColor(197, 160, 89);
        doc.setFont('times', 'italic');
        doc.setFontSize(20);
        doc.text(normalizeTurkishForPdf('ZEHIR BEBEK - OZET IMALAT VE TEDARIK PLANI'), 15, 20);
    
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(120, 120, 120);
        doc.text(normalizeTurkishForPdf("Eto'nun Sahne Tasarimi Asistani"), 15, 30);
        doc.text(new Date().toLocaleDateString('tr-TR'), 175, 30);

        // Project Metadata Box
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(40, 40, 40);
        doc.text(normalizeTurkishForPdf(`PROJE: ${project.name}`), 15, 48);
    
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(100, 100, 100);
        doc.text(normalizeTurkishForPdf(`Hedef Sahne: ${project.sahne || 'Belirtilmedi'}`), 15, 53);
        doc.text(normalizeTurkishForPdf(`Kurum / Yapim: ${project.kurum || 'Belirtilmedi'}`), 100, 53);
        doc.text(normalizeTurkishForPdf(`Sahne Olculeri (En x Boy x Yuk): ${project.width}m x ${project.length}m x ${project.height}m`), 15, 58);
        doc.line(15, 61, 195, 61);

        let y = 68;

        // Integrated Approved Technical Drawings list
        if (approvedDrawings.length > 0) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(11);
          doc.setTextColor(40, 40, 40);
          doc.text(normalizeTurkishForPdf('Onayli Sahne Yerlesim & Teknik Cizim Paftalari:'), 15, y);
          y += 6;
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9);
          doc.setTextColor(80, 80, 80);
          approvedDrawings.forEach(d => {
            doc.text(normalizeTurkishForPdf(`* ${d.title} (Olcek: ${d.scale})`), 20, y);
            y += 5;
          });
          y += 5;
        }

        // Materials table
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(40, 40, 40);
        doc.text(normalizeTurkishForPdf('1. Gerekli Temel Malzeme Listesi'), 15, y);
        y += 8;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.text(normalizeTurkishForPdf('MALZEME ADI'), 15, y);
        doc.text(normalizeTurkishForPdf('MIKTAR'), 100, y);
        doc.text(normalizeTurkishForPdf('ACIKLAMA / NOT'), 130, y);
        doc.line(15, y + 2, 195, y + 2);
        y += 8;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(70, 70, 70);

        summary.materialList.forEach((mat: any) => {
          if (y > 270) {
            doc.addPage();
            y = 20;
          }
          doc.text(normalizeTurkishForPdf(mat.item), 15, y);
          doc.text(normalizeTurkishForPdf(mat.qty), 100, y);
          y = renderWrappedText(doc, mat.notes, 130, y, 65, 5) + 3;
        });

        // Job sequence
        y += 10;
        if (y > 250) {
          doc.addPage();
          y = 20;
        }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(40, 40, 40);
        doc.text(normalizeTurkishForPdf('2. Temel Is Sirasi'), 15, y);
        y += 8;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        summary.jobSequence.forEach((step: string, idx: number) => {
          if (y > 270) {
            doc.addPage();
            y = 20;
          }
          y = renderWrappedText(doc, `${idx + 1}. ${step}`, 15, y, 180, 5) + 2;
        });

        // Append accessories
        y += 8;
        appendAccessoriesToPdf(doc, y);

        doc.save(`${project.name.replace(/\s+/g, '_')}_ozet_uretim_plani.pdf`);
    } catch (pdfErr: any) {
      console.error('Özet plan PDF hatası:', pdfErr);
      setErr(`PDF oluşturulamadı: ${pdfErr?.message || 'bilinmeyen hata'}`);
    }
  };

  // Download Detailed PDF (Detaylı Plan)
  const handleDownloadDetailedPdf = () => {
    try {
        const detailed = project.productionPlanDetailed;
        if (!detailed) return;

        const doc = new jsPDF();
    
        // Header
        doc.setFillColor(17, 17, 17);
        doc.rect(0, 0, 210, 40, 'F');
        doc.setTextColor(197, 160, 89);
        doc.setFont('times', 'italic');
        doc.setFontSize(20);
        doc.text(normalizeTurkishForPdf('ZEHIR BEBEK - DETAYLI ATOLYE IMALAT PLANI'), 15, 20);
    
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(120, 120, 120);
        doc.text(normalizeTurkishForPdf("Eto'nun Sahne Tasarimi Asistani"), 15, 30);
        doc.text(new Date().toLocaleDateString('tr-TR'), 175, 30);

        // Project Metadata Box
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(40, 40, 40);
        doc.text(normalizeTurkishForPdf(`PROJE: ${project.name}`), 15, 48);
    
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(100, 100, 100);
        doc.text(normalizeTurkishForPdf(`Hedef Sahne: ${project.sahne || 'Belirtilmedi'}`), 15, 53);
        doc.text(normalizeTurkishForPdf(`Kurum / Yapim: ${project.kurum || 'Belirtilmedi'}`), 100, 53);
        doc.text(normalizeTurkishForPdf(`Sahne Olculeri (En x Boy x Yuk): ${project.width}m x ${project.length}m x ${project.height}m`), 15, 58);
        doc.line(15, 61, 195, 61);

        let y = 68;

        // Integrated Approved Technical Drawings list
        if (approvedDrawings.length > 0) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(11);
          doc.setTextColor(40, 40, 40);
          doc.text(normalizeTurkishForPdf('Referans Alinan Onayli Teknik Paftalar:'), 15, y);
          y += 6;
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9);
          doc.setTextColor(80, 80, 80);
          approvedDrawings.forEach(d => {
            doc.text(normalizeTurkishForPdf(`* ${d.title} (Mekan: ${d.scale} | Onayli)`), 20, y);
            y += 5;
          });
          y += 5;
        }

        // Crew requirements and estimate
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(40, 40, 40);
        doc.text(normalizeTurkishForPdf('1. Atolye Ekip Ihtiyaci ve Zaman Tahmini'), 15, y);
        y += 8;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.text(normalizeTurkishForPdf(`Tahmini Imalat Suresi: ${detailed.durationEstimate}`), 15, y);
        y += 6;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.text(normalizeTurkishForPdf('Gerekli Atolye Kadrosu & Is Gucu:'), 15, y);
        y += 5;

        doc.setFont('helvetica', 'normal');
        detailed.teamRequirements.forEach((role: string) => {
          doc.text(normalizeTurkishForPdf(`- ${role}`), 20, y);
          y += 5;
        });

        y += 10;
        if (y > 250) {
          doc.addPage();
          y = 20;
        }

        // Detailed material spec
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.text(normalizeTurkishForPdf('2. Detayli Malzeme ve Boyut Spesifikasyonlari'), 15, y);
        y += 8;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.text(normalizeTurkishForPdf('MALZEME'), 15, y);
        doc.text(normalizeTurkishForPdf('OZELLIK / BILGI'), 70, y);
        doc.text(normalizeTurkishForPdf('MIKTAR'), 140, y);
        doc.text(normalizeTurkishForPdf('TAHMINI MALIYET'), 165, y);
        doc.line(15, y + 2, 195, y + 2);
        y += 8;

        doc.setFont('helvetica', 'normal');
        detailed.materialList.forEach((mat: any) => {
          if (y > 270) {
            doc.addPage();
            y = 20;
          }
          doc.text(normalizeTurkishForPdf(mat.item), 15, y);
          doc.text(normalizeTurkishForPdf(mat.qty), 140, y);
          doc.text(normalizeTurkishForPdf(mat.costEstimate || '-'), 165, y);
          y = renderWrappedText(doc, mat.spec, 70, y, 65, 5) + 3;
        });

        // Step-by-step phases
        doc.addPage();
        y = 20;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.text(normalizeTurkishForPdf('3. Asama Asama Imalat Is Akisi'), 15, y);
        y += 8;

        detailed.jobSequence.forEach((phase: any) => {
          if (y > 240) {
            doc.addPage();
            y = 20;
          }
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(10);
          doc.setTextColor(197, 160, 89);
          doc.text(normalizeTurkishForPdf(`● AŞAMA: ${phase.step} (Evre: ${phase.phase} | Sure: ${phase.duration})`), 15, y);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9);
          doc.setTextColor(80, 80, 80);
          y += 5;
          doc.text(normalizeTurkishForPdf(`Sorumlu Ekip: ${phase.team}`), 20, y);
          y += 5;

          phase.steps.forEach((sub: string) => {
            if (y > 270) {
              doc.addPage();
              y = 20;
            }
            y = renderWrappedText(doc, `- ${sub}`, 20, y, 175, 5) + 2;
          });
          y += 4;
        });

        // Append accessories
        y += 8;
        appendAccessoriesToPdf(doc, y);

        doc.save(`${project.name.replace(/\s+/g, '_')}_detayli_uretim_plani.pdf`);
    } catch (pdfErr: any) {
      console.error('Detaylı plan PDF hatası:', pdfErr);
      setErr(`PDF oluşturulamadı: ${pdfErr?.message || 'bilinmeyen hata'}`);
    }
  };

  // Identify re-used items (in more than 1 scene)
  const reusedProps = propsList.filter(p => (p.kullanildigiSahneler || []).length > 1);

  return (
    <div className="my-6 space-y-6">
      {/* Previous-step integration panel */}
      <div className="bg-[#111] border border-[#2a2a2a] p-4 rounded flex items-center justify-between text-xs font-mono text-zinc-500">
        <div>
          <span className="text-zinc-400 font-bold font-sans">ADHD Asistan Özet Paneli:</span> 
          <span className="ml-2">Toplam {total} envanter öğesi, {reusedProps.length} tekrar kullanılan öğe tespit edildi. Onaylı pafta sayısı: {approvedDrawings.length}</span>
        </div>
        <span className="text-red-500 font-serif italic">Eto'nun sahne tasarımı asistanı</span>
      </div>

      {/* Approved Drawings warning/success */}
      {!hasApprovedDrawings ? (
        <div className="bg-red-950/20 border border-red-500/30 p-5 rounded-lg flex items-start gap-3.5 text-xs text-red-400 font-mono shadow-xl animate-pulse">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="font-bold uppercase tracking-wider text-red-400">DİKKAT: ONAYLI TEKNİK ÇİZİM PAFTASI BULUNAMADI</h4>
            <p className="text-zinc-400 font-sans leading-relaxed">
              Üretim ve atölye imalat planının sağlıklı bir şekilde yürütülebilmesi için onaylı bir teknik çizimin bulunması gerekmektedir. Lütfen <strong>Teknik Çizim</strong> sekmesinden taslak paftalarınızı onaylayın (Bu sekme ancak onay sonrası tam aktifleşir).
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-red-950/10 border border-red-800/40 p-5 rounded-lg flex items-start gap-3.5 text-xs text-red-200 font-mono shadow-xl">
          <CheckCircle2 className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="font-bold uppercase tracking-wider text-red-400">ONAYLANMIŞ TEKNİK ÇİZİMLER ENTEGRE EDİLDİ ({approvedDrawings.length})</h4>
            <p className="text-zinc-400 font-sans leading-relaxed">
              Aşağıdaki onaylı pafta ve montaj çizimleri imalat ve atölye planına başarıyla bağlanmıştır:
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              {approvedDrawings.map(d => (
                <span key={d.id} className="px-2.5 py-1 bg-red-950/40 border border-red-900/30 rounded text-[10px] text-red-300 uppercase font-mono tracking-wider font-bold">
                  ● {d.title} ({d.scale})
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Metrics overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[#111] p-4 rounded border border-[#2a2a2a] shadow-lg flex items-center justify-between">
          <div>
            <span className="text-zinc-500 text-[10px] uppercase font-mono tracking-wider">Toplam Öğe</span>
            <h4 className="text-2xl font-serif italic text-white mt-1">{total}</h4>
          </div>
          <ClipboardList className="w-8 h-8 text-zinc-600 opacity-20" />
        </div>
        <div className="bg-[#111] p-4 rounded border border-[#2a2a2a] shadow-lg flex items-center justify-between">
          <div>
            <span className="text-red-500 text-[10px] uppercase font-mono tracking-wider">Satın Alınacak</span>
            <h4 className="text-2xl font-serif italic text-red-500 mt-1">{toBuy}</h4>
          </div>
          <ShoppingBag className="w-8 h-8 text-red-500 opacity-20" />
        </div>
        <div className="bg-[#111] p-4 rounded border border-[#2a2a2a] shadow-lg flex items-center justify-between">
          <div>
            <span className="text-amber-500 text-[10px] uppercase font-mono tracking-wider">Üretilecek (Atölye)</span>
            <h4 className="text-2xl font-serif italic text-amber-500 mt-1">{toProduce}</h4>
          </div>
          <Hammer className="w-8 h-8 text-amber-500 opacity-20" />
        </div>
        <div className="bg-[#111] p-4 rounded border border-[#2a2a2a] shadow-lg flex items-center justify-between">
          <div>
            <span className="text-zinc-400 text-[10px] uppercase font-mono tracking-wider">Durumu Bekleyen</span>
            <h4 className="text-2xl font-serif italic text-zinc-400 mt-1">{pending}</h4>
          </div>
          <Clock className="w-8 h-8 text-zinc-400 opacity-20" />
        </div>
      </div>

      {/* Main Inventory list */}
      <div className="bg-[#111] border border-[#2a2a2a] rounded p-6 shadow-2xl space-y-4">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-serif italic text-white flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-red-500" />
              Konsolide Üretim ve Tedarik Envanteri
            </h3>
            <p className="text-xs text-zinc-400">Atölye ve satın alma durumlarını belirleyip AI tabanlı imalat planınızı alın.</p>
          </div>
          
          <div className="flex gap-2 relative">
            {/* Export Dropdown */}
            <div className="relative">
              <button
                onClick={() => setExportDropdownOpen(!exportDropdownOpen)}
                className="px-4 py-2 bg-zinc-800 border border-zinc-700 hover:border-red-500 text-zinc-300 rounded text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors"
              >
                <FileSpreadsheet className="w-4 h-4 text-red-500" />
                Dışa Aktar
              </button>
              {exportDropdownOpen && (
                <div className="absolute right-0 mt-1 w-40 bg-[#16171a] border border-[#2a2a2a] rounded shadow-xl z-20 overflow-hidden">
                  <button
                    onClick={() => handleExport('xlsx')}
                    className="w-full text-left px-4 py-2.5 text-xs text-zinc-300 hover:bg-[#222] hover:text-white flex items-center gap-2 border-b border-[#222]"
                  >
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    Excel (.xlsx)
                  </button>
                  <button
                    onClick={() => handleExport('csv')}
                    className="w-full text-left px-4 py-2.5 text-xs text-zinc-300 hover:bg-[#222] hover:text-white flex items-center gap-2"
                  >
                    <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                    CSV Formatı
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={handleGenerateProductionPlan}
              disabled={isGenerating || propsList.length === 0}
              className="px-4 py-2 bg-red-600 text-white rounded text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              {isGenerating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              AI ile İmalat Planı Üret
            </button>
          </div>
        </div>

        {err && (
          <div className="p-3 bg-red-950/20 border border-red-500/30 rounded text-red-400 text-xs font-mono">
            {err}
          </div>
        )}

        {propsList.length === 0 ? (
          <div className="text-center py-12 text-zinc-500 text-xs italic font-serif">
            Henüz analiz edilmiş bir aksesuar/dekor öğesi yok. Lütfen öncelikle "Metin Analizi" sekmesinden bir döküman analiz edin.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-zinc-300">
              <thead className="bg-[#0a0a0a] text-[9px] uppercase font-mono tracking-widest text-zinc-500 border-b border-[#2a2a2a]">
                <tr>
                  <th className="p-3">Eleman Adı</th>
                  <th className="p-3">Kategori</th>
                  <th className="p-3">Kullanıldığı Sahneler</th>
                  <th className="p-3">Tedarik/Üretim Durumu</th>
                  <th className="p-3">Açıklama / Kaynak Notu</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a2a2a]">
                {propsList.map(item => {
                  const isReused = (item.kullanildigiSahneler || []).length > 1;
                  return (
                    <tr key={item.id} className="hover:bg-[#0a0a0a]/40 transition-colors">
                      <td className="p-3 font-serif italic text-base text-[#e0e0e0] flex items-center gap-2">
                        {item.ad}
                        {isReused && (
                          <span className="px-1.5 py-0.5 bg-red-950/20 text-red-500 border border-red-900/30 text-[9px] uppercase tracking-wider rounded font-mono font-bold">
                            Tekrar Kullanılan
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                          item.kategori === 'dekor' 
                             ? 'bg-amber-950/20 border-amber-900/30 text-amber-400' 
                             : 'bg-teal-950/20 border-teal-900/30 text-teal-400'
                        }`}>
                          {item.kategori === 'dekor' ? 'Dekor / Mobilya' : 'El Aksesuarı'}
                        </span>
                      </td>
                      <td className="p-3">
                        <input 
                          type="text" 
                          value={item.kullanildigiSahneler?.join(', ') || ''} 
                          onChange={(e) => handleScenesChange(item.id, e.target.value)}
                          placeholder="Örn: Sahne 1, Sahne 2"
                          className="bg-[#0a0a0a] border border-[#2a2a2a] text-xs text-zinc-300 px-2 py-1 rounded w-44 outline-none focus:border-red-500 placeholder:opacity-30 font-mono"
                          title="Sahneleri virgülle ayırarak güncelleyin"
                        />
                      </td>
                      <td className="p-3">
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => handleStatusChange(item.id, 'Satın Alınacak')}
                            className={`px-2.5 py-1 rounded font-bold uppercase tracking-wider text-[9px] transition-all border ${
                              item.status === 'Satın Alınacak'
                                ? 'bg-red-600 border-red-600 text-white shadow-md'
                                : 'bg-[#0a0a0a] border-[#2a2a2a] text-zinc-500 hover:text-zinc-200'
                            }`}
                          >
                            Satın Al
                          </button>
                          <button
                            onClick={() => handleStatusChange(item.id, 'Üretilecek')}
                            className={`px-2.5 py-1 rounded font-bold uppercase tracking-wider text-[9px] transition-all border ${
                              item.status === 'Üretilecek'
                                ? 'bg-amber-600 border-amber-500 text-white shadow-md'
                                : 'bg-[#0a0a0a] border-[#2a2a2a] text-zinc-500 hover:text-zinc-200'
                            }`}
                          >
                            Üret / Atölye
                          </button>
                          <button
                            onClick={() => handleStatusChange(item.id, '')}
                            className={`px-1.5 py-1 rounded font-bold uppercase tracking-wider text-[9px] transition-all border ${
                              item.status === '' || !item.status
                                ? 'bg-[#222] border-[#333] text-zinc-300'
                                : 'bg-[#0a0a0a] border-[#2a2a2a] text-zinc-500 hover:text-zinc-400'
                            }`}
                            title="Temizle"
                          >
                            Temizle
                          </button>
                        </div>
                      </td>
                      <td className="p-3 text-zinc-400 max-w-xs text-xs font-mono truncate" title={item.aciklama}>
                        {item.kaynakAlinti || item.aciklama}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* AI Generated Production Plans (Summary and Detailed) */}
      {(project.productionPlanSummary || project.productionPlanDetailed) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Summary Plan */}
          {project.productionPlanSummary && (
            <div className="bg-[#111] border border-[#2a2a2a] rounded p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-base font-serif italic text-white flex items-center gap-2">
                  <ListOrdered className="w-5 h-5 text-red-500" />
                  Özet İmalat Planı
                </h4>
                <button
                  onClick={handleDownloadSummaryPdf}
                  className="px-3 py-1.5 bg-[#222] border border-[#333] hover:border-red-500 text-red-500 rounded text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Özet PDF
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <h5 className="text-xs font-mono text-zinc-400 uppercase tracking-widest mb-2 border-b border-[#222] pb-1">Gerekli Malzemeler</h5>
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1 scrollbar-thin">
                    {project.productionPlanSummary.materialList.map((m: any, idx: number) => (
                      <div key={idx} className="bg-[#0a0a0a] p-2.5 rounded border border-[#222] text-xs flex justify-between gap-4">
                        <div>
                          <span className="font-serif italic text-zinc-200 block">{m.item}</span>
                          <span className="text-[10px] text-zinc-500 font-sans">{m.notes}</span>
                        </div>
                        <span className="text-red-500 font-mono shrink-0">{m.qty}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h5 className="text-xs font-mono text-zinc-400 uppercase tracking-widest mb-2 border-b border-[#222] pb-1">Temel İş Sırası</h5>
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1 scrollbar-thin">
                    {project.productionPlanSummary.jobSequence.map((step: string, idx: number) => (
                      <div key={idx} className="text-xs flex gap-3 text-zinc-300">
                        <span className="text-red-500 font-mono font-bold">{idx + 1}.</span>
                        <p className="font-sans leading-relaxed">{step}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Detailed Plan */}
          {project.productionPlanDetailed && (
            <div className="bg-[#111] border border-[#2a2a2a] rounded p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-base font-serif italic text-white flex items-center gap-2">
                  <Workflow className="w-5 h-5 text-red-500" />
                  Detaylı İmalat Planı
                </h4>
                <button
                  onClick={handleDownloadDetailedPdf}
                  className="px-3 py-1.5 bg-[#222] border border-[#333] hover:border-amber-500 text-amber-500 rounded text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Detaylı PDF
                </button>
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-center bg-[#0a0a0a] p-3 rounded border border-[#222] text-xs font-mono">
                  <div>
                    <span className="text-zinc-500 block uppercase text-[10px]">Toplam Süre Tahmini</span>
                    <span className="text-red-500 font-bold">{project.productionPlanDetailed.durationEstimate}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-zinc-500 block uppercase text-[10px]">Atölye Ekip İhtiyacı</span>
                    <span className="text-zinc-300 font-bold">{(project.productionPlanDetailed.teamRequirements || []).length} Rol</span>
                  </div>
                </div>

                <div>
                  <h5 className="text-xs font-mono text-zinc-400 uppercase tracking-widest mb-2 border-b border-[#222] pb-1">Spesifikasyonlu Malzemeler & Tahmini Maliyet</h5>
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1 scrollbar-thin">
                    {project.productionPlanDetailed.materialList.map((m: any, idx: number) => (
                      <div key={idx} className="bg-[#0a0a0a] p-2.5 rounded border border-[#222] text-xs space-y-1">
                        <div className="flex justify-between">
                          <span className="font-serif italic text-zinc-200">{m.item}</span>
                          <span className="font-mono text-zinc-500">{m.qty}</span>
                        </div>
                        <div className="flex justify-between text-[10px]">
                          <span className="text-zinc-400">{m.spec}</span>
                          <span className="text-red-400 font-mono font-bold">{m.costEstimate}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h5 className="text-xs font-mono text-zinc-400 uppercase tracking-widest mb-2 border-b border-[#222] pb-1">Aşama Aşama Adımlar</h5>
                  <div className="space-y-3 max-h-48 overflow-y-auto pr-1 scrollbar-thin">
                    {project.productionPlanDetailed.jobSequence.map((phase: any, idx: number) => (
                      <div key={idx} className="bg-[#0a0a0a] p-3 rounded border border-[#222] text-xs space-y-2">
                        <div className="flex justify-between items-start gap-2">
                          <span className="font-bold text-zinc-200 font-serif italic">{phase.step} ({phase.phase})</span>
                          <span className="px-2 py-0.5 bg-zinc-800 text-zinc-400 rounded text-[9px] font-mono shrink-0">{phase.duration}</span>
                        </div>
                        <p className="text-[10px] text-zinc-500 font-mono">Sorumlu: {phase.team}</p>
                        <ul className="list-disc list-inside space-y-1 pl-1 text-[11px] text-zinc-400">
                          {(phase.steps || []).map((subStep: string, sIdx: number) => (
                            <li key={sIdx}>{subStep}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tedarik Gruplandırma Paneli (Satın Alınacak / Üretilecek) */}
      {propsList.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Satın Alınacaklar */}
          <div className="bg-[#111] border border-[#2a2a2a] rounded p-6 shadow-xl space-y-4">
            <h4 className="text-sm font-serif italic text-red-500 flex items-center gap-2">
              <ShoppingBag className="w-5 h-5 text-red-500" />
              Satın Alınacak Dekor ve Aksesuarlar
            </h4>
            <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1 scrollbar-thin">
              {propsList.filter(p => p.status === 'Satın Alınacak').length === 0 ? (
                <p className="text-xs text-zinc-500 italic font-serif">Satın alınacak olarak işaretlenmiş eleman yok.</p>
              ) : (
                propsList.filter(p => p.status === 'Satın Alınacak').map(item => (
                  <div key={item.id} className="bg-[#0a0a0a] p-3 rounded border border-[#222] text-xs flex justify-between items-start gap-4">
                    <div>
                      <span className="font-serif italic text-zinc-200 block text-sm">{item.ad}</span>
                      <span className="text-[10px] text-zinc-500 font-sans block mt-1">{item.aciklama}</span>
                    </div>
                    <span className="text-[10px] font-mono text-red-500 bg-red-950/20 px-2 py-1 rounded shrink-0 uppercase border border-red-500/20">
                      Sahneler: {item.kullanildigiSahneler?.join(', ') || '-'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Üretilecekler */}
          <div className="bg-[#111] border border-[#2a2a2a] rounded p-6 shadow-xl space-y-4">
            <h4 className="text-sm font-serif italic text-amber-500 flex items-center gap-2">
              <Hammer className="w-5 h-5 text-amber-500" />
              Üretilecek / Atölye İmalatı Aksesuarlar
            </h4>
            <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1 scrollbar-thin">
              {propsList.filter(p => p.status === 'Üretilecek').length === 0 ? (
                <p className="text-xs text-zinc-500 italic font-serif">Atölyede üretilecek olarak işaretlenmiş eleman yok.</p>
              ) : (
                propsList.filter(p => p.status === 'Üretilecek').map(item => (
                  <div key={item.id} className="bg-[#0a0a0a] p-3 rounded border border-[#222] text-xs flex justify-between items-start gap-4">
                    <div>
                      <span className="font-serif italic text-zinc-200 block text-sm">{item.ad}</span>
                      <span className="text-[10px] text-zinc-500 font-sans block mt-1">{item.aciklama}</span>
                    </div>
                    <span className="text-[10px] font-mono text-amber-400 bg-amber-950/20 px-2 py-1 rounded shrink-0 uppercase border border-amber-500/20">
                      Sahneler: {item.kullanildigiSahneler?.join(', ') || '-'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
