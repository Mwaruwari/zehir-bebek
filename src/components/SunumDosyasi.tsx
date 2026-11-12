import React, { useState, useEffect } from 'react';
import { Project, PresentationImage, VerbalLanguage } from '../types';
import { sanitizeProjectForApi } from '../utils/apiPayload';
import { 
  FileText, 
  Upload, 
  ArrowUp, 
  ArrowDown, 
  Trash2, 
  Sparkles, 
  Download, 
  Undo2, 
  MessageSquare,
  Image as ImageIcon,
  MapPin,
  CheckCircle,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { jsPDF } from 'jspdf';

interface SunumDosyasiProps {
  project: Project;
  onUpdateProject: (p: Project) => void;
  addLog?: (level: 'info' | 'error', message: string) => Promise<void> | void;
}

export function SunumDosyasiView({ project, onUpdateProject, addLog }: SunumDosyasiProps) {
  const [images, setImages] = useState<PresentationImage[]>([]);
  const [verbal, setVerbal] = useState<VerbalLanguage>({ headline: '', narrative: '' });
  const [verbalHistory, setVerbalHistory] = useState<VerbalLanguage[]>([]);
  const [instruction, setInstruction] = useState('');
  
  const [isGeneratingVerbal, setIsGeneratingVerbal] = useState(false);
  const [isGeneratingRationale, setIsGeneratingRationale] = useState<Record<string, boolean>>({});
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'info' | 'success' | 'error'; text: string } | null>(null);

  // Merge script scenes and analyzed locations as choices
  const sceneOptions = Array.from(new Set([
    ...(project.scenes || []).map(s => s.name),
    ...(project.sceneBoundaries || []).map(b => b.name),
    ...(project.analysis?.mekanlar || []).map(m => m.ad)
  ])).sort((a, b) => {
    const aNum = a.match(/\d+/);
    const bNum = b.match(/\d+/);
    if (aNum && bNum) return parseInt(aNum[0], 10) - parseInt(bNum[0], 10);
    return a.localeCompare(b);
  });

  const sortImagesChronologically = (imgsToSort: PresentationImage[]) => {
    const sceneOrderMap = new Map<string, number>();
    
    // Map script scenes chronologically
    (project.scenes || []).forEach((sc, idx) => {
      const cleanName = sc.name.toLowerCase().trim();
      sceneOrderMap.set(cleanName, idx);
      const numMatch = cleanName.match(/\d+/);
      if (numMatch) {
        sceneOrderMap.set(numMatch[0], idx);
      }
    });

    // Map scene boundaries chronologically
    (project.sceneBoundaries || []).forEach((b, idx) => {
      const cleanName = b.name.toLowerCase().trim();
      if (!sceneOrderMap.has(cleanName)) {
        sceneOrderMap.set(cleanName, idx + 100);
      }
      const numMatch = cleanName.match(/\d+/);
      if (numMatch && !sceneOrderMap.has(numMatch[0])) {
        sceneOrderMap.set(numMatch[0], idx + 100);
      }
    });

    return [...imgsToSort].sort((a, b) => {
      const aVal = a.sceneId ? a.sceneId.toLowerCase().trim() : '';
      const bVal = b.sceneId ? b.sceneId.toLowerCase().trim() : '';

      if (!aVal && !bVal) return a.order - b.order;
      if (!aVal) return 1; // empty ones at the end
      if (!bVal) return -1;

      const aIdx = sceneOrderMap.get(aVal) ?? (aVal.match(/\d+/) ? parseInt(aVal.match(/\d+/)![0], 10) : 999);
      const bIdx = sceneOrderMap.get(bVal) ?? (bVal.match(/\d+/) ? parseInt(bVal.match(/\d+/)![0], 10) : 999);

      if (aIdx === bIdx) return a.order - b.order;
      return aIdx - bIdx;
    }).map((img, i) => ({ ...img, order: i + 1 }));
  };

  // Load from project on mount or project change
  useEffect(() => {
    if (project) {
      setImages(project.presentationImages || []);
      setVerbal(project.verbalLanguage || { headline: '', narrative: '' });
      setVerbalHistory(project.sozselDilVersiyonlari || project.verbalLanguageHistory || []);
    }
  }, [project.id]);

  // Helper to trigger save to parent & backend
  const saveProjectState = (updatedImages: PresentationImage[], updatedVerbal: VerbalLanguage, updatedHistory: VerbalLanguage[]) => {
    onUpdateProject({
      ...project,
      presentationImages: updatedImages,
      verbalLanguage: updatedVerbal,
      verbalLanguageHistory: updatedHistory,
      sozselDilVersiyonlari: updatedHistory
    });
  };

  const addStatus = (type: 'info' | 'success' | 'error', text: string) => {
    setStatusMessage({ type, text });
    setTimeout(() => setStatusMessage(null), 4000);
  };

  // Image upload handling (Base64 + Gemini Vision Analysis)
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploadingImage(true);
    const loadedImages: PresentationImage[] = [...images];
    let successCount = 0;

    for (const file of Array.from(files) as any[]) {
      const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
      const fileFormat = file.type || 'Bilinmiyor';

      // Stage 1: File received/read on client
      if (addLog) {
        addLog('info', `Görsel dosyası alındı: "${file.name}" | Boyut: ${fileSizeMB} MB | Format: ${fileFormat}`);
      }

      try {
        const base64String = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('Dosya okunamadı.'));
          reader.readAsDataURL(file);
        });

        // Stage 2: Sending to API
        if (addLog) {
          addLog('info', `Görsel analiz çağrısı yapılıyor: Endpoint = "/api/analyze-image", Model = "gemini-3.1-flash-lite"`);
        }

        // Set a 60-second timeout on the request
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          controller.abort();
        }, 60000);

        const res = await fetch('/api/analyze-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image: base64String,
            imageName: file.name,
            // Send only the image being analysed; the project's other images
            // would duplicate megabytes of base64 in every request.
            project: sanitizeProjectForApi(project)
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        // Stage 3: Result returned or failed
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${res.status} hatası.`);
        }

        const result = await res.json();

        if (addLog) {
          addLog('info', `Görsel analiz tamamlandı ve sonuç döndü: "${file.name}" | Üretilen Başlık: "${result.title}"`);
        }

        const newImg: PresentationImage = {
          id: Math.random().toString(36).substring(2, 9),
          name: file.name,
          data: base64String,
          sceneId: result.sceneId || '',
          order: loadedImages.length + 1,
          title: result.title || file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, ' '),
          description: result.description || ''
        };

        loadedImages.push(newImg);
        successCount++;
      } catch (err: any) {
        const isTimeout = err.name === 'AbortError';
        if (isTimeout) {
          if (addLog) {
            addLog('error', `Görsel analiz isteği 60 saniye içinde yanıt vermedi (Zaman Aşımı). Dosya: "${file.name}"`);
          }
          addStatus('error', `Görsel işlenemedi, tekrar deneyin veya daha küçük bir görsel yükleyin`);
        } else {
          if (addLog) {
            addLog('error', `Görsel yükleme/analiz hatası alındı: ${err.message || err} | Dosya: "${file.name}"`);
          }
          addStatus('error', `Hata: ${err.message || 'Görsel işlenemedi.'}`);
        }
      }
    }

    if (successCount > 0) {
      const sorted = sortImagesChronologically(loadedImages);
      setImages(sorted);
      saveProjectState(sorted, verbal, verbalHistory);
      addStatus('success', `${successCount} görsel başarıyla analiz edildi ve eklendi.`);
    }

    setIsUploadingImage(false);
    // Reset file input
    e.target.value = '';
  };

  // Drag and drop sorting state
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    
    const reordered = [...images];
    const draggedItem = reordered[draggedIndex];
    
    // Remove from old pos
    reordered.splice(draggedIndex, 1);
    // Insert into new pos
    reordered.splice(index, 0, draggedItem);
    
    // Map orders
    const updated = reordered.map((img, i) => ({ ...img, order: i + 1 }));
    setImages(updated);
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    saveProjectState(images, verbal, verbalHistory);
  };

  // Reorder manually (Up/Down buttons)
  const moveImage = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === images.length - 1) return;

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    const updated = [...images];
    const temp = updated[index];
    updated[index] = updated[targetIndex];
    updated[targetIndex] = temp;

    // Map orders
    const sorted = updated.map((img, i) => ({ ...img, order: i + 1 }));
    setImages(sorted);
    saveProjectState(sorted, verbal, verbalHistory);
  };

  // Remove image
  const removeImage = (id: string) => {
    const updated = images.filter(img => img.id !== id).map((img, i) => ({ ...img, order: i + 1 }));
    setImages(updated);
    saveProjectState(updated, verbal, verbalHistory);
    addStatus('info', 'Görsel sunum listesinden kaldırıldı.');
  };

  // Update image details
  const updateImageDetail = (id: string, field: 'title' | 'sceneId' | 'description', value: string) => {
    let updated = images.map((img) => {
      if (img.id === id) {
        return { ...img, [field]: value };
      }
      return img;
    });

    if (field === 'sceneId') {
      updated = sortImagesChronologically(updated);
    }

    setImages(updated);
    saveProjectState(updated, verbal, verbalHistory);
  };

  // Generate Verbal Language with AI
  const handleGenerateVerbal = async () => {
    setIsGeneratingVerbal(true);
    addStatus('info', 'Sözsel dil ve vurucu başlık yapay zeka ile üretiliyor...');
    
    try {
      const storedKey = localStorage.getItem('ANTHROPIC_API_KEY') || '';
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (storedKey) {
        headers['x-anthropic-api-key'] = storedKey;
      }

      const res = await fetch('/api/generate-verbal', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          project: sanitizeProjectForApi(project),
          instruction
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Üretim başarısız oldu');
      }

      const result: VerbalLanguage = await res.json();
      
      // Save current verbal to history before updating
      const updatedHistory = verbal.headline ? [verbal, ...verbalHistory].slice(0, 10) : verbalHistory;
      
      setVerbal(result);
      setVerbalHistory(updatedHistory);
      saveProjectState(images, result, updatedHistory);
      setInstruction('');
      addStatus('success', 'Sözsel dil başarıyla üretildi ve güncellendi!');
    } catch (err: any) {
      console.error(err);
      addStatus('error', `Hata: ${err.message}`);
    } finally {
      setIsGeneratingVerbal(false);
    }
  };

  // Rollback verbal language
  const handleRollbackVerbal = () => {
    if (verbalHistory.length === 0) return;
    const previous = verbalHistory[0];
    const remainingHistory = verbalHistory.slice(1);
    
    setVerbal(previous);
    setVerbalHistory(remainingHistory);
    saveProjectState(images, previous, remainingHistory);
    addStatus('info', 'Önceki sözsel dil versiyonuna başarıyla geri dönüldü.');
  };

  // Generate rationale for specific image
  const handleGenerateRationale = async (img: PresentationImage) => {
    setIsGeneratingRationale(prev => ({ ...prev, [img.id]: true }));
    addStatus('info', `"${img.title}" için sanatsal gerekçe üretiliyor...`);

    try {
      const storedKey = localStorage.getItem('ANTHROPIC_API_KEY') || '';
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (storedKey) {
        headers['x-anthropic-api-key'] = storedKey;
      }

      const res = await fetch('/api/generate-rationale', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          imageTitle: img.title,
          sceneId: img.sceneId,
          itemDescription: img.description,
          project
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Açıklama üretimi başarısız oldu');
      }

      const result = await res.json();
      updateImageDetail(img.id, 'description', result.description);
      addStatus('success', `"${img.title}" için gerekçe başarıyla üretildi.`);
    } catch (err: any) {
      console.error(err);
      addStatus('error', `Gerekçe üretim hatası: ${err.message}`);
    } finally {
      setIsGeneratingRationale(prev => ({ ...prev, [img.id]: false }));
    }
  };

  const normalizeTurkishForPdf = (text: string): string => {
    if (!text) return '';
    return text
      .replace(/ç/g, 'c').replace(/Ç/g, 'C')
      .replace(/ğ/g, 'g').replace(/Ğ/g, 'G')
      .replace(/ı/g, 'i').replace(/İ/g, 'I')
      .replace(/ö/g, 'o').replace(/Ö/g, 'O')
      .replace(/ş/g, 's').replace(/Ş/g, 'S')
      .replace(/ü/g, 'u').replace(/Ü/g, 'U');
  };

  // Export PDF with jsPDF
  const handleDownloadPDF = () => {
    addStatus('info', 'Sunum PDF dosyası derleniyor, lütfen bekleyin...');
    
    try {
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      // Setup typography colors
      const goldColor = { r: 197, g: 160, b: 89 };
      const charcoalColor = { r: 17, g: 17, b: 17 };
      const grayColor = { r: 100, g: 100, b: 100 };

      // Helper for header border
      const drawPaftaBorders = (titleText: string, pageNum: number, total: number) => {
        doc.setDrawColor(220, 220, 220);
        doc.setLineWidth(0.3);
        // Outer box
        doc.rect(8, 8, pageWidth - 16, pageHeight - 16);
        // Header line
        doc.line(8, 22, pageWidth - 8, 22);
        // Footer line
        doc.line(8, pageHeight - 16, pageWidth - 8, pageHeight - 16);

        // Header text
        doc.setTextColor(charcoalColor.r, charcoalColor.g, charcoalColor.b);
        doc.setFont('Helvetica', 'bold');
        doc.setFontSize(10);
        doc.text(normalizeTurkishForPdf("ZEHİR BEBEK // REJİ VE SUNUM DOSYASI"), 12, 16);

        doc.setFont('Helvetica', 'normal');
        doc.setTextColor(grayColor.r, grayColor.g, grayColor.b);
        doc.setFontSize(8);
        doc.text(normalizeTurkishForPdf(titleText.toUpperCase()), pageWidth - 12, 16, { align: 'right' });

        // Footer text
        doc.text(normalizeTurkishForPdf(`PROJE: ${project.name.toUpperCase()}`), 12, pageHeight - 11);
        doc.text(normalizeTurkishForPdf(`SAYFA ${pageNum} / ${total}`), pageWidth - 12, pageHeight - 11, { align: 'right' });
      };

      const totalPages = 1 + images.length;

      // ----------------------------------------
      // COVER PAGE - VERBAL LANGUAGE
      // ----------------------------------------
      // Background dark tint (simulated with white text layouts for clean printing)
      drawPaftaBorders("Kapak & Sözsel Dil", 1, totalPages);

      // Main Branding
      doc.setTextColor(goldColor.r, goldColor.g, goldColor.b);
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(26);
      doc.text(normalizeTurkishForPdf(project.name.toUpperCase()), pageWidth / 2, 60, { align: 'center' });

      doc.setTextColor(grayColor.r, grayColor.g, grayColor.b);
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(11);
      doc.text(normalizeTurkishForPdf("SANATSAL KONSEPT VE REJİ SUNUM DÖKÜMANI"), pageWidth / 2, 68, { align: 'center' });

      // Gold-like divider
      doc.setDrawColor(goldColor.r, goldColor.g, goldColor.b);
      doc.setLineWidth(1);
      doc.line(pageWidth / 2 - 30, 75, pageWidth / 2 + 30, 75);

      // Verbal Language Section
      doc.setTextColor(charcoalColor.r, charcoalColor.g, charcoalColor.b);
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(16);
      const headlineStr = verbal.headline ? `"${verbal.headline}"` : `"${project.name}"`;
      const splitHeadline = doc.splitTextToSize(normalizeTurkishForPdf(headlineStr), pageWidth - 40);
      doc.text(splitHeadline, pageWidth / 2, 95, { align: 'center' });

      doc.setTextColor(grayColor.r, grayColor.g, grayColor.b);
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(11);
      const narrativeStr = verbal.narrative || "Bu döküman, sahne mekan analizi, dekor, atmosfer ve imalat notlarını içeren teknik ve sanatsal reji sunum paftasıdır. Sahnelerin dramatik bütünlüğü göz önünde bulundurularak kurgulanmıştır.";
      const splitNarrative = doc.splitTextToSize(normalizeTurkishForPdf(narrativeStr), pageWidth - 40);
      doc.text(splitNarrative, 20, 115, { align: 'left', maxWidth: pageWidth - 40 });

      // Project Metrics Block
      doc.rect(20, 180, pageWidth - 40, 35);
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(10);
      doc.text(normalizeTurkishForPdf("FİZİKSEL SAHNE VE PLAN ÖLÇÜLERİ"), 25, 187);
      
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(normalizeTurkishForPdf(`Sahne Genişliği (En): ${project.width} Metre`), 25, 195);
      doc.text(normalizeTurkishForPdf(`Sahne Derinliği (Boy): ${project.length} Metre`), 25, 201);
      doc.text(normalizeTurkishForPdf(`Sahne Yüksekliği: ${project.height} Metre`), 25, 207);
      doc.text(normalizeTurkishForPdf(`Toplam Dekor/Aksesuar Öğesi: ${project.analysis?.aksesuarlar?.length || 0} Adet`), 110, 195);
      doc.text(normalizeTurkishForPdf(`Tasarım Tarihi: ${new Date(project.createdAt).toLocaleDateString('tr-TR')}`), 110, 201);

      // ----------------------------------------
      // SUBSEQUENT PAGES - DECOR IMAGES
      // ----------------------------------------
      images.forEach((img, index) => {
        doc.addPage();
        drawPaftaBorders(`Görsel Referans #${index + 1}`, index + 2, totalPages);

        // Drawing the image
        try {
          // Calculate fits for A4 page. Max width 150mm, max height 110mm
          const maxImgW = pageWidth - 40; // 170mm
          const maxImgH = 100;
          
          // Simple image placing
          doc.addImage(img.data, 'JPEG', 20, 30, maxImgW, maxImgH);
        } catch (e) {
          // Drawing placeholder box in case of corruption/load errors
          doc.rect(20, 30, pageWidth - 40, 100);
          doc.setFontSize(10);
          doc.text(normalizeTurkishForPdf("GÖRSEL REFERANS VERİSİ"), pageWidth / 2, 75, { align: 'center' });
          doc.setFontSize(8);
          doc.text(normalizeTurkishForPdf("(PDF aktarımında şematik temsil)"), pageWidth / 2, 82, { align: 'center' });
        }

        // Image details text
        doc.setTextColor(charcoalColor.r, charcoalColor.g, charcoalColor.b);
        doc.setFont('Helvetica', 'bold');
        doc.setFontSize(14);
        doc.text(normalizeTurkishForPdf(img.title.toUpperCase()), 20, 145);

        // Associate Scene Tag
        if (img.sceneId) {
          doc.setFillColor(240, 240, 240);
          doc.rect(20, 150, doc.getTextWidth(normalizeTurkishForPdf(img.sceneId)) + 10, 6, 'F');
          doc.setTextColor(goldColor.r, goldColor.g, goldColor.b);
          doc.setFont('Helvetica', 'bold');
          doc.setFontSize(8);
          doc.text(normalizeTurkishForPdf(img.sceneId.toUpperCase()), 25, 154);
        }

        // Description / Rationale text
        doc.setTextColor(grayColor.r, grayColor.g, grayColor.b);
        doc.setFont('Helvetica', 'normal');
        doc.setFontSize(10);
        const descText = img.description || "Bu görsel için henüz sanatsal gerekçe veya açıklama girilmemiştir. Sahnelerin dramatik ve mekansal yapısıyla olan uyumu temsil etmektedir.";
        const splitDesc = doc.splitTextToSize(normalizeTurkishForPdf(descText), pageWidth - 40);
        doc.text(splitDesc, 20, 163);
      });

      // Download triggered
      doc.save(`${project.name}_Sunum_Dosyasi.pdf`);
      addStatus('success', 'Sunum PDF dosyası başarıyla indirildi!');
    } catch (error: any) {
      console.error(error);
      addStatus('error', `PDF oluşturulurken hata: ${error.message}`);
    }
  };

  // List of locations from Metin Analizi
  const locationsList = project.analysis?.mekanlar || [];

  return (
    <div className="space-y-8 my-6">
      
      {/* STATUS BANNER */}
      <AnimatePresence>
        {statusMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`p-4 rounded border flex items-center gap-3 shadow-lg max-w-2xl mx-auto text-xs font-mono z-50 ${
              statusMessage.type === 'success' 
                ? 'bg-teal-950/80 border-teal-500/30 text-teal-300' 
                : statusMessage.type === 'error'
                ? 'bg-red-950/80 border-red-500/30 text-red-300'
                : 'bg-zinc-900/95 border-zinc-700 text-zinc-300'
            }`}
          >
            {statusMessage.type === 'success' ? (
              <CheckCircle className="w-5 h-5 text-teal-400 shrink-0" />
            ) : statusMessage.type === 'error' ? (
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
            ) : (
              <Sparkles className="w-5 h-5 text-[#c5a059] shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* LEFT COLUMN: VERBAL LANGUAGE & ACTIONS */}
        <div className="space-y-6">
          
          {/* VERBAL LANGUAGE (SÖZSEL DİL) */}
          <div className="bg-[#111] border border-[#2a2a2a] rounded-lg p-6 shadow-xl flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-2 font-mono">
                  <FileText className="w-4 h-4 text-gold" />
                  Sözsel Dil & Konsept
                </h3>
                {verbalHistory.length > 0 && (
                  <button
                    onClick={handleRollbackVerbal}
                    className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-gold uppercase font-mono tracking-wider transition-all"
                    title="Önceki versiyona geri dön"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                    <span>Geri Al ({verbalHistory.length})</span>
                  </button>
                )}
              </div>

              {/* Headline display */}
              <div className="bg-[#0a0a0a]/70 border border-[#222] p-4 rounded min-h-[70px] flex flex-col justify-center">
                {verbal.headline ? (
                  <h4 className="text-lg font-serif italic text-gold text-center font-bold">
                    "{verbal.headline}"
                  </h4>
                ) : (
                  <p className="text-zinc-600 text-xs italic text-center font-serif">
                    Henüz bir sözsel başlık üretilmedi.
                  </p>
                )}
              </div>

              {/* Narrative description */}
              <div className="bg-[#0a0a0a]/70 border border-[#222] p-4 rounded min-h-[120px] text-xs leading-relaxed text-zinc-400 font-sans">
                {verbal.narrative ? (
                  <p>{verbal.narrative}</p>
                ) : (
                  <p className="text-zinc-600 italic font-serif text-center py-6">
                    Mekan analizi ve sahneleri temel alarak sanatsal/reklamcı gözüyle etkileyici bir konsept anlatımı oluşturmak için aşağıdaki butona basın.
                  </p>
                )}
              </div>

              {/* Correction Instruction Input */}
              <div className="space-y-1.5 pt-2">
                <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono flex items-center gap-1">
                  <MessageSquare className="w-3.5 h-3.5" />
                  Yönetmen / Düzeltme Talimatı
                </label>
                <textarea
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="Örn: 'daha karanlık ve neo-noir bir hava olsun', 'daha minimalist ve endüstriyel olsun'"
                  className="w-full bg-[#0a0a0a] text-xs text-zinc-300 rounded border border-[#2a2a2a] p-2.5 outline-none focus:border-gold h-16 resize-none placeholder:opacity-30 font-sans"
                  id="textarea-verbal-correction"
                />
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-[#222] space-y-3">
              <button
                onClick={handleGenerateVerbal}
                disabled={isGeneratingVerbal}
                className="w-full py-2.5 bg-[#c5a059] hover:bg-[#d9b87a] disabled:bg-zinc-800 disabled:text-zinc-500 text-black rounded text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-md"
                id="btn-generate-verbal"
              >
                {isGeneratingVerbal ? (
                  <div className="w-4 h-4 border-2 border-black border-t-transparent animate-spin rounded-full"></div>
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                <span>SÖZSEL DİL ÜRET / DÜZELT</span>
              </button>
            </div>
          </div>

          {/* DOWNLOAD MODULE */}
          <div className="bg-[#111] border border-[#2a2a2a] rounded-lg p-5 shadow-xl flex flex-col justify-between">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2 font-mono">
                Sunumu Tamamla
              </h4>
              <p className="text-[11px] text-zinc-500 leading-relaxed font-sans mb-4">
                Kapak sayfasında reji felsefesini içeren Sözsel Dil'i, takip eden sayfalarda ise eşleştirdiğiniz tüm dekor görsellerini ve sanatsal açıklamalarını barındıran PDF paftasını hazırlayabilirsiniz.
              </p>
            </div>
            <button
              onClick={handleDownloadPDF}
              disabled={images.length === 0}
              className="w-full py-3 bg-teal-600 hover:bg-teal-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white font-bold uppercase tracking-widest text-xs flex items-center justify-center gap-2 rounded transition-all shadow-lg shadow-teal-950/20"
              id="btn-download-pdf-presentation"
            >
              <Download className="w-4 h-4" />
              <span>PDF SUNUMU İNDİR</span>
            </button>
          </div>

        </div>

        {/* RIGHT COLUMN: IMAGES DIRECTORY & ORDERING (SPAN-2) */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* IMAGE DECK MANAGEMENT */}
          <div className="bg-[#111] border border-[#2a2a2a] rounded-lg p-6 shadow-xl flex flex-col justify-between min-h-[400px]">
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-2 font-mono">
                    <ImageIcon className="w-4 h-4 text-gold" />
                    Dekor Referans Görsel Havuzu ({images.length})
                  </h3>
                  <p className="text-[11px] text-zinc-500 mt-1 font-sans">
                    Görselleri sürükleyip bırakarak veya ok tuşlarıyla sunum sırasına dizin. Her biri için reji gerekçesi üretin.
                  </p>
                </div>

                {/* File Upload Button */}
                <label className={`px-4 py-2 bg-[#222] border border-[#333] hover:border-gold hover:bg-[#2a2a2a] text-xs font-bold uppercase tracking-wider text-zinc-300 rounded cursor-pointer transition-all flex items-center justify-center gap-1.5 self-start ${isUploadingImage ? 'opacity-50 pointer-events-none' : ''}`}>
                  {isUploadingImage ? (
                    <div className="w-3.5 h-3.5 border border-gold border-t-transparent animate-spin rounded-full"></div>
                  ) : (
                    <Upload className="w-3.5 h-3.5 text-gold" />
                  )}
                  <span>{isUploadingImage ? 'Görsel Analiz Ediliyor...' : 'Görsel Yükle'}</span>
                  {!isUploadingImage && (
                    <input
                      type="file"
                      multiple
                      accept="image/*"
                      onChange={handleImageUpload}
                      className="hidden"
                    />
                  )}
                </label>
              </div>

              {/* Upload Drag area if empty */}
              {images.length === 0 ? (
                <div className="border-2 border-dashed border-[#222] rounded-lg p-16 text-center bg-[#0a0a0a]/30 flex flex-col items-center justify-center gap-4 my-6">
                  <div className="w-12 h-12 bg-[#222] border border-[#333] rounded-full flex items-center justify-center text-zinc-500">
                    <Upload className="w-6 h-6" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Henüz Dekor Görseli Eklenmedi</p>
                    <p className="text-[10px] text-zinc-600 font-mono">Sürükle bırak yapabilir veya yukarıdaki 'Görsel Yükle' butonuyla birden fazla resim seçebilirsiniz.</p>
                  </div>
                </div>
              ) : (
                /* DECK FLOW LIST */
                <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-[#2a2a2a]">
                  {images.map((img, index) => (
                    <div
                      key={img.id}
                      draggable
                      onDragStart={() => handleDragStart(index)}
                      onDragOver={(e) => handleDragOver(e, index)}
                      onDragEnd={handleDragEnd}
                      className={`bg-[#0a0a0a] border border-[#222] rounded p-4 flex flex-col md:flex-row gap-4 hover:border-[#333] transition-all cursor-move select-none relative ${
                        draggedIndex === index ? 'opacity-40 border-dashed border-gold/40' : ''
                      }`}
                    >
                      {/* Image Preview & Order Badges */}
                      <div className="flex flex-col gap-2 shrink-0 w-full md:w-32 items-center md:items-stretch">
                        <div className="relative aspect-video md:aspect-square bg-[#111] rounded overflow-hidden border border-[#222]">
                          <img
                            src={img.data}
                            alt={img.title}
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                          <div className="absolute top-1 left-1 w-5 h-5 bg-gold text-black text-[10px] font-bold rounded-full flex items-center justify-center shadow-md">
                            {index + 1}
                          </div>
                        </div>

                        {/* Reordering and deleting buttons */}
                        <div className="flex items-center justify-between gap-1 w-full mt-1">
                          <button
                            onClick={() => moveImage(index, 'up')}
                            disabled={index === 0}
                            className="flex-1 py-1 bg-[#161616] border border-[#222] hover:bg-[#222] hover:text-gold disabled:opacity-20 disabled:cursor-not-allowed text-zinc-400 rounded transition-colors"
                            title="Sırayı Yukarı Taşı"
                          >
                            <ArrowUp className="w-3.5 h-3.5 mx-auto" />
                          </button>
                          <button
                            onClick={() => moveImage(index, 'down')}
                            disabled={index === images.length - 1}
                            className="flex-1 py-1 bg-[#161616] border border-[#222] hover:bg-[#222] hover:text-gold disabled:opacity-20 disabled:cursor-not-allowed text-zinc-400 rounded transition-colors"
                            title="Sırayı Aşağı Taşı"
                          >
                            <ArrowDown className="w-3.5 h-3.5 mx-auto" />
                          </button>
                          <button
                            onClick={() => removeImage(img.id)}
                            className="px-2 py-1 bg-red-950/40 border border-red-900/30 hover:bg-red-900 hover:text-white text-red-400 rounded transition-all"
                            title="Listeden Kaldır"
                          >
                            <Trash2 className="w-3.5 h-3.5 mx-auto" />
                          </button>
                        </div>
                      </div>

                      {/* Image Details Editing */}
                      <div className="flex-1 space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          
                          {/* Title Input */}
                          <div className="space-y-1">
                            <label className="text-[9px] uppercase tracking-wider text-zinc-500 font-mono">Görsel / Pafta Başlığı</label>
                            <input
                              type="text"
                              value={img.title}
                              onChange={(e) => updateImageDetail(img.id, 'title', e.target.value)}
                              className="w-full bg-[#111] text-xs text-zinc-300 rounded border border-[#222] px-2.5 py-1.5 outline-none focus:border-gold font-sans"
                            />
                          </div>

                          {/* Associated Scene Dropdown */}
                          <div className="space-y-1">
                            <label className="text-[9px] uppercase tracking-wider text-zinc-500 font-mono flex items-center gap-1">
                              <MapPin className="w-3 h-3 text-gold" />
                              Sahne / Mekan Eşleşmesi
                            </label>
                            <select
                              value={img.sceneId}
                              onChange={(e) => updateImageDetail(img.id, 'sceneId', e.target.value)}
                              className="w-full bg-[#111] text-xs text-zinc-300 rounded border border-[#222] px-2.5 py-1.5 outline-none focus:border-gold font-sans"
                            >
                              <option value="">-- Sahne/Mekan Seç --</option>
                              {sceneOptions.map((opt, oIdx) => (
                                <option key={oIdx} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                          </div>

                        </div>

                        {/* Rationale/Description Input & Generation */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <label className="text-[9px] uppercase tracking-wider text-zinc-500 font-mono">Sanatsal Gerekçe & Rasyonel Açıklaması</label>
                            <button
                              onClick={() => handleGenerateRationale(img)}
                              disabled={isGeneratingRationale[img.id]}
                              className="text-[9px] font-bold uppercase font-mono tracking-wider text-[#c5a059] hover:text-[#d9b87a] disabled:text-zinc-600 flex items-center gap-1 transition-colors bg-[#111] px-2 py-0.5 rounded border border-[#222]"
                            >
                              {isGeneratingRationale[img.id] ? (
                                <div className="w-2.5 h-2.5 border border-[#c5a059] border-t-transparent animate-spin rounded-full"></div>
                              ) : (
                                <Sparkles className="w-2.5 h-2.5" />
                              )}
                              <span>GEREKÇE METNİ ÜRET</span>
                            </button>
                          </div>
                          <textarea
                            value={img.description}
                            onChange={(e) => updateImageDetail(img.id, 'description', e.target.value)}
                            placeholder="Bu dekor görselinin dönem detaylarını, sahne atmosferini, reji ve dramatik tasarıma olan katkılarını yazın veya yukarıdaki 'Gerekçe Metni Üret' butonuyla yapay zekaya ürettirin..."
                            className="w-full bg-[#111] text-xs text-zinc-300 rounded border border-[#222] p-2.5 outline-none focus:border-gold h-20 resize-none placeholder:opacity-30 font-sans leading-relaxed"
                          />
                        </div>

                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>

      </div>

    </div>
  );
}
