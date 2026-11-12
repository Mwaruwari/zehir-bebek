import React, { useState, useEffect, useRef } from 'react';
import { Project, TechnicalDrawing, PlacedProp, StyleReference } from '../types';
import { 
  Layers, 
  Upload, 
  Check, 
  X, 
  Trash2, 
  Sparkles, 
  Download, 
  Plus, 
  Move,
  BookOpen,
  MapPin,
  Ruler,
  AlertTriangle,
  Info,
  CheckCircle2,
  Minimize2,
  FileDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface TeknikCizimProps {
  project: Project;
  onUpdateProject: (p: Project) => void;
}

export function TeknikCizimView({ project, onUpdateProject }: TeknikCizimProps) {
  // Sub-tabs within Teknik Cizim
  const [subTab, setSubTab] = useState<'drawing' | 'layout'>('drawing');

  // Drawing state
  const [drawings, setDrawings] = useState<TechnicalDrawing[]>([]);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string>('');
  const [newTitle, setNewTitle] = useState('');
  const [selectedStyle, setSelectedStyle] = useState<'reference' | 'simple' | 'scaled' | 'labeled'>('simple');
  const [isEnhancing, setIsEnhancing] = useState(false);

  // Style Library state
  const [styleLibrary, setStyleLibrary] = useState<StyleReference[]>([]);

  // Layout Plan state
  const [placedProps, setPlacedProps] = useState<PlacedProp[]>([]);
  const [selectedPropToAdd, setSelectedPropToAdd] = useState<string>('');
  const [manualPropName, setManualPropName] = useState('');
  
  // Status banner state
  const [statusMessage, setStatusMessage] = useState<{ type: 'info' | 'success' | 'error'; text: string } | null>(null);

  // Load from project on mount or project change
  useEffect(() => {
    if (project) {
      setDrawings(project.technicalDrawings || []);
      setStyleLibrary(project.styleLibrary || []);
      setPlacedProps(project.placedProps || []);
      
      // Select first drawing by default
      const list = project.technicalDrawings || [];
      if (list.length > 0 && !selectedDrawingId) {
        setSelectedDrawingId(list[0].id);
      }
    }
  }, [project.id]);

  const addStatus = (type: 'info' | 'success' | 'error', text: string) => {
    setStatusMessage({ type, text });
    setTimeout(() => setStatusMessage(null), 4000);
  };

  // Helper to persist state
  const persistState = (updatedDrawings: TechnicalDrawing[], updatedLibrary: StyleReference[], updatedProps: PlacedProp[]) => {
    onUpdateProject({
      ...project,
      technicalDrawings: updatedDrawings,
      styleLibrary: updatedLibrary,
      placedProps: updatedProps
    });
  };

  // Upload Draft drawing
  const handleUploadDraft = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      const newDrawing: TechnicalDrawing = {
        id: Math.random().toString(36).substring(2, 9),
        title: newTitle || file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, ' ') + ' - Taslak',
        uploadedAt: new Date().toISOString(),
        image: base64String,
        style: selectedStyle,
        materialNotes: [
          `Zemin Kaplaması: Sahne ölçekli montaj kurgusu.`,
          `Fiziksel Boyutlar: En: ${project.width}m x Boy: ${project.length}m x Yükseklik: ${project.height}m.`,
          `Notlar: İmalat ve kurulum aşamasında sahne ölçüleri esastır.`
        ],
        scale: 'Ölçeksiz (Şematik)',
        approved: false
      };

      const updated = [...drawings, newDrawing];
      setDrawings(updated);
      setSelectedDrawingId(newDrawing.id);
      setNewTitle('');
      persistState(updated, styleLibrary, placedProps);
      addStatus('success', 'Teknik çizim taslağı başarıyla yüklendi.');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Upload Style Reference to Library
  const handleUploadStyleRef = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      const newRef: StyleReference = {
        id: Math.random().toString(36).substring(2, 9),
        name: file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, ' '),
        image: base64String,
        uploadedAt: new Date().toISOString()
      };

      const updatedLib = [...styleLibrary, newRef];
      setStyleLibrary(updatedLib);
      persistState(drawings, updatedLib, placedProps);
      addStatus('success', 'Stil kütüphanesine yeni referans eklendi!');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Delete Style Reference
  const deleteStyleRef = (id: string) => {
    const updatedLib = styleLibrary.filter(r => r.id !== id);
    setStyleLibrary(updatedLib);
    persistState(drawings, updatedLib, placedProps);
    addStatus('info', 'Stil referansı silindi.');
  };

  // Load a Style Reference as a new drawing draft
  const handleUseStyleRefAsDrawing = (ref: StyleReference) => {
    const newDrawing: TechnicalDrawing = {
      id: Math.random().toString(36).substring(2, 9),
      title: ref.name + ' - Referans Taslak',
      uploadedAt: new Date().toISOString(),
      image: ref.image,
      style: 'reference',
      materialNotes: [
        `Style Reference: ${ref.name}`,
        `Fiziksel Boyutlar: En: ${project.width}m x Boy: ${project.length}m x Yükseklik: ${project.height}m.`,
        `Notlar: Stil kütüphanesinden referans alınarak kurgulandı.`
      ],
      scale: 'Ölçeksiz (Referans)',
      approved: false
    };

    const updated = [...drawings, newDrawing];
    setDrawings(updated);
    setSelectedDrawingId(newDrawing.id);
    persistState(updated, styleLibrary, placedProps);
    addStatus('success', `"${ref.name}" referans çizimi yeni taslak olarak yüklendi!`);
  };

  // Enhance drawing with AI
  const handleEnhanceDrawing = async (id: string) => {
    const drawing = drawings.find(d => d.id === id);
    if (!drawing) return;

    setIsEnhancing(true);
    addStatus('info', `"${drawing.title}" yapay zeka ile netleştirilip malzeme notasyonları üretiliyor...`);

    try {
      const storedKey = localStorage.getItem('ANTHROPIC_API_KEY') || '';
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (storedKey) {
        headers['x-anthropic-api-key'] = storedKey;
      }

      const res = await fetch('/api/enhance-technical', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          style: drawing.style,
          project,
          drawingTitle: drawing.title,
          image: drawing.image
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Detaylandırma başarısız oldu');
      }

      const result = await res.json();
      
      const updated = drawings.map((d) => {
        if (d.id === id) {
          return {
            ...d,
            title: result.title,
            materialNotes: result.materialNotes,
            scale: result.scale,
            image: result.image || d.image
          };
        }
        return d;
      });

      setDrawings(updated);
      persistState(updated, styleLibrary, placedProps);
      addStatus('success', 'Çizim paftası detaylandırıldı, ölçeklendi ve malzeme notları eklendi!');
    } catch (err: any) {
      console.error(err);
      addStatus('error', `Hata: ${err.message}`);
    } finally {
      setIsEnhancing(false);
    }
  };

  // Toggle approval
  const toggleApproval = (id: string) => {
    const updated = drawings.map((d) => {
      if (d.id === id) {
        const nextState = !d.approved;
        if (nextState) {
          addStatus('success', `"${d.title}" Onaylanan Çizim olarak işaretlendi. Üretim Planı'na aktarıldı.`);
        } else {
          addStatus('info', `"${d.title}" onay listesinden çıkarıldı.`);
        }
        return { ...d, approved: nextState };
      }
      return d;
    });
    setDrawings(updated);
    persistState(updated, styleLibrary, placedProps);
  };

  // Update drawing style option
  const updateDrawingStyleOption = (id: string, style: 'reference' | 'simple' | 'scaled' | 'labeled') => {
    const updated = drawings.map((d) => {
      if (d.id === id) {
        return { ...d, style };
      }
      return d;
    });
    setDrawings(updated);
    persistState(updated, styleLibrary, placedProps);
  };

  // Delete drawing
  const handleDeleteDrawing = (id: string) => {
    const updated = drawings.filter(d => d.id !== id);
    setDrawings(updated);
    if (selectedDrawingId === id) {
      setSelectedDrawingId(updated.length > 0 ? updated[0].id : '');
    }
    persistState(updated, styleLibrary, placedProps);
    addStatus('info', 'Teknik çizim listeden silindi.');
  };

  // Get current active drawing
  const activeDrawing = drawings.find(d => d.id === selectedDrawingId);

  // Image Style CSS filters definition based on selection
  const getStyleCSSFilter = (style: string) => {
    switch (style) {
      case 'simple':
        // High contrast monochrome line draft
        return 'contrast(190%) brightness(105%) grayscale(100%)';
      case 'scaled':
        // Blue Blueprint schematic look (invert lines + blue overlay)
        return 'invert(100%) hue-rotate(180deg) brightness(85%) contrast(150%) saturate(150%)';
      case 'labeled':
        // Clean engineering CAD look
        return 'contrast(140%) brightness(100%) grayscale(100%)';
      case 'reference':
        // Soft sepia outline to match vintage references
        return 'sepia(40%) contrast(125%) brightness(95%)';
      default:
        return 'none';
    }
  };


  // ----------------------------------------------------
  // LAYOUT PLAN (YERLEŞİM PLANI) LOGIC
  // ----------------------------------------------------
  // Decor list filtered from accessories of Metin Analizi
  const decorItemsFromAnalysis = project.analysis?.aksesuarlar?.filter(item => item.kategori === 'dekor') || [];

  const handleAddPropToLayout = () => {
    let name = '';
    let propId = '';

    if (selectedPropToAdd === 'manual') {
      if (!manualPropName.trim()) return;
      name = manualPropName;
      propId = 'manual_' + Math.random().toString(36).substring(2, 5);
      setManualPropName('');
    } else {
      const found = decorItemsFromAnalysis.find(p => p.id === selectedPropToAdd);
      if (!found) return;
      name = found.ad;
      propId = found.id;
    }

    // Default sizes based on stage width/length
    const newPlaced: PlacedProp = {
      id: Math.random().toString(36).substring(2, 9),
      propId,
      name,
      x: 45, // center x percent
      y: 45, // center y percent
      widthPercent: 12, // default 12% width
      lengthPercent: 12 // default 12% length
    };

    const updated = [...placedProps, newPlaced];
    setPlacedProps(updated);
    setSelectedPropToAdd('');
    persistState(drawings, styleLibrary, updated);
    addStatus('success', `"${name}" yerleşim planına eklendi.`);
  };

  // Delete placed item
  const handleRemovePlacedProp = (id: string) => {
    const updated = placedProps.filter(p => p.id !== id);
    setPlacedProps(updated);
    persistState(drawings, styleLibrary, updated);
    addStatus('info', 'Dekor elemanı yerleşim planından kaldırıldı.');
  };

  // Update placed item properties (size, coordinates)
  const updatePlacedPropValue = (id: string, field: 'x' | 'y' | 'widthPercent' | 'lengthPercent', amount: number) => {
    const updated = placedProps.map((p) => {
      if (p.id === id) {
        const val = p[field];
        const nextVal = Math.max(2, Math.min(95, val + amount));
        return { ...p, [field]: nextVal };
      }
      return p;
    });
    setPlacedProps(updated);
    persistState(drawings, styleLibrary, updated);
  };

  // Standard Drag and Drop state
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const [activeDraggingId, setActiveDraggingId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>, item: PlacedProp) => {
    e.preventDefault();
    setActiveDraggingId(item.id);
    
    if (gridContainerRef.current) {
      const rect = gridContainerRef.current.getBoundingClientRect();
      const pointerX = e.clientX - rect.left;
      const pointerY = e.clientY - rect.top;
      
      const itemXPercent = (pointerX / rect.width) * 100;
      const itemYPercent = (pointerY / rect.height) * 100;
      
      setDragOffset({
        x: itemXPercent - item.x,
        y: itemYPercent - item.y
      });
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!activeDraggingId || !gridContainerRef.current) return;
    
    const rect = gridContainerRef.current.getBoundingClientRect();
    const pointerX = e.clientX - rect.left;
    const pointerY = e.clientY - rect.top;

    // Convert pointer coordinate to percentage of parent bounds
    let pctX = (pointerX / rect.width) * 100 - dragOffset.x;
    let pctY = (pointerY / rect.height) * 100 - dragOffset.y;

    // Boundary constraints inside stage coordinates
    pctX = Math.max(0, Math.min(100, pctX));
    pctY = Math.max(0, Math.min(100, pctY));

    setPlacedProps(prev => prev.map(p => {
      if (p.id === activeDraggingId) {
        return { ...p, x: Math.round(pctX), y: Math.round(pctY) };
      }
      return p;
    }));
  };

  const handlePointerUp = () => {
    if (activeDraggingId) {
      setActiveDraggingId(null);
      persistState(drawings, styleLibrary, placedProps);
    }
  };

  // Export Layout Plan as PNG Image
  const handleExportLayoutPNG = () => {
    if (!gridContainerRef.current) return;
    addStatus('info', 'Yerleşim planı çiziliyor...');

    try {
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 500;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // 1. Draw Blueprint Background
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Grid Pattern
      ctx.strokeStyle = '#222222';
      ctx.lineWidth = 1;
      const gridSpacing = 40;
      for (let x = 0; x < canvas.width; x += gridSpacing) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y < canvas.height; y += gridSpacing) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }

      // Outer border frame
      ctx.strokeStyle = '#c5a059';
      ctx.lineWidth = 3;
      ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);

      // Title header
      ctx.fillStyle = '#c5a059';
      ctx.font = 'bold 16px Courier New';
      ctx.fillText(`${project.name.toUpperCase()} - YERLEŞİM KAT PLANI`, 30, 45);

      ctx.fillStyle = '#666666';
      ctx.font = '10px Courier New';
      ctx.fillText(`SAHNE ÖLÇEĞİ: ${project.width}m x ${project.length}m // ONAYLI PLAN`, 30, 65);

      // 2. Draw placed elements
      placedProps.forEach((p) => {
        const itemX = (p.x / 100) * (canvas.width - 60) + 30;
        const itemY = (p.y / 100) * (canvas.height - 100) + 80;
        const itemW = (p.widthPercent / 100) * (canvas.width - 60);
        const itemH = (p.lengthPercent / 100) * (canvas.height - 100);

        // Rectangle fill
        ctx.fillStyle = 'rgba(197, 160, 89, 0.15)';
        ctx.fillRect(itemX - itemW/2, itemY - itemH/2, itemW, itemH);

        // Rectangle borders
        ctx.strokeStyle = '#c5a059';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(itemX - itemW/2, itemY - itemH/2, itemW, itemH);

        // Diagonal crosshairs to feel like blueprint architectural style
        ctx.strokeStyle = 'rgba(197, 160, 89, 0.3)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(itemX - itemW/2, itemY - itemH/2);
        ctx.lineTo(itemX + itemW/2, itemY + itemH/2);
        ctx.moveTo(itemX + itemW/2, itemY - itemH/2);
        ctx.lineTo(itemX - itemW/2, itemY + itemH/2);
        ctx.stroke();

        // Label text inside box
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 9px Courier New';
        ctx.textAlign = 'center';
        ctx.fillText(p.name, itemX, itemY + 3);
      });

      // 3. Compass and notations
      ctx.fillStyle = '#666666';
      ctx.font = '10px Courier New';
      ctx.textAlign = 'center';
      ctx.fillText('ARKA DUVAR / DEKOR HATTI', canvas.width / 2, 470);
      ctx.fillText('ÖN SAHNE (SEYİRCİ)', canvas.width / 2, 95);

      // Convert to image download
      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `${project.name}_Yerlesim_Plani.png`;
      link.href = dataUrl;
      link.click();
      
      addStatus('success', 'Yerleşim planı çizimi görsel olarak indirildi.');
    } catch (e: any) {
      console.error(e);
      addStatus('error', 'Yerleşim planı kaydedilirken hata oluştu.');
    }
  };

  return (
    <div className="space-y-6 my-6">

      {/* TOP SUB-TABS ROUTING */}
      <div className="flex bg-[#111] p-1.5 rounded-lg border border-[#2a2a2a] max-w-md">
        <button
          onClick={() => setSubTab('drawing')}
          className={`flex-1 py-2 text-xs font-bold uppercase tracking-widest transition-all rounded ${
            subTab === 'drawing'
              ? 'bg-[#c5a059] text-black font-extrabold shadow-md'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
          id="btn-subtab-technical-drafts"
        >
          Eskiz ve Paftalar
        </button>
        <button
          onClick={() => setSubTab('layout')}
          className={`flex-1 py-2 text-xs font-bold uppercase tracking-widest transition-all rounded ${
            subTab === 'layout'
              ? 'bg-[#c5a059] text-black font-extrabold shadow-md'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
          id="btn-subtab-layout-planner"
        >
          Yerleşim Planı (2D)
        </button>
      </div>

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
              <CheckCircle2 className="w-5 h-5 text-teal-400 shrink-0" />
            ) : statusMessage.type === 'error' ? (
              <X className="w-5 h-5 text-red-400 shrink-0" />
            ) : (
              <Sparkles className="w-5 h-5 text-[#c5a059] shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </motion.div>
        )}
      </AnimatePresence>


      {/* ---------------------------------------------------- */}
      {/* SUB-TAB: ESKİZ VE PAFTALAR (TECHNICAL DRAFTS) */}
      {/* ---------------------------------------------------- */}
      {subTab === 'drawing' && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          
          {/* CONTROL BLOCK (UPLOAD, SETTINGS, LIBRARY) */}
          <div className="space-y-6">
            
            {/* DRAFT UPLOAD CONTAINER */}
            <div className="bg-[#111] border border-[#2a2a2a] rounded-lg p-5 shadow-xl space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 font-mono">
                Yeni Taslak Yükle
              </h3>
              
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase text-zinc-500 font-mono">Pafta Başlığı</label>
                  <input
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="Örn: 'Ana Salon Kesiti v1'"
                    className="w-full bg-[#0a0a0a] text-xs text-zinc-300 rounded border border-[#2a2a2a] px-3 py-2 outline-none focus:border-gold"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase text-zinc-500 font-mono">Varsayılan Çizim Stili</label>
                  <select
                    value={selectedStyle}
                    onChange={(e) => setSelectedStyle(e.target.value as any)}
                    className="w-full bg-[#0a0a0a] text-xs text-zinc-300 rounded border border-[#2a2a2a] px-3 py-2 outline-none focus:border-gold"
                  >
                    <option value="simple">Sade Çizgi Taslağı</option>
                    <option value="scaled">Ölçekli Plan-Kesit (Mavi Grid)</option>
                    <option value="labeled">Etiketli ve Notasyonlu (CAD)</option>
                    <option value="reference">Referans Stile Göre Düzenle</option>
                  </select>
                </div>

                {/* Upload Trigger Area */}
                <label className="border-2 border-dashed border-[#222] hover:border-gold hover:bg-[#0a0a0a]/40 rounded-lg p-8 text-center flex flex-col items-center justify-center gap-3 cursor-pointer transition-all">
                  <Upload className="w-6 h-6 text-zinc-500" />
                  <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider">Taslak Seçin</span>
                  <span className="text-[9px] text-zinc-600 font-mono">PNG, JPG, JPEG</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleUploadDraft}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            {/* PERSISTENT STYLE LIBRARY */}
            <div className="bg-[#111] border border-[#2a2a2a] rounded-lg p-5 shadow-xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 font-mono flex items-center gap-1.5">
                  <BookOpen className="w-4 h-4 text-gold" />
                  Stil Kütüphanesi
                </h3>
                
                {/* Upload to library button */}
                <label className="text-[9px] font-bold uppercase tracking-wider text-gold hover:text-[#d9b87a] cursor-pointer transition-colors bg-[#0a0a0a] px-2 py-1 rounded border border-[#222]">
                  Referans Ekle
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleUploadStyleRef}
                    className="hidden"
                  />
                </label>
              </div>

              <p className="text-[10px] text-zinc-500 leading-relaxed font-sans">
                Hesabınızda kalıcı olarak saklanacak referans pafta/kesit çizimlerinizi yükleyin. Yapay zeka, gelecek düzenlemelerde bu referans stillerini otomatik referans alır.
              </p>

              {styleLibrary.length === 0 ? (
                <p className="text-[11px] text-zinc-600 italic font-serif text-center py-4 border border-[#222] border-dashed rounded">
                  Kütüphanede kayıtlı referans çizim yok.
                </p>
              ) : (
                /* STYLE LIST GRID */
                <div className="grid grid-cols-2 gap-3 max-h-[160px] overflow-y-auto pr-1">
                  {styleLibrary.map((ref) => (
                    <div key={ref.id} className="relative aspect-video rounded bg-[#0a0a0a] overflow-hidden border border-[#222] group">
                      <img src={ref.image} alt={ref.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      <div className="absolute inset-0 bg-black/85 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-2">
                        <p className="text-[9px] font-mono text-zinc-300 truncate font-bold">{ref.name}</p>
                        <div className="flex items-center justify-between w-full mt-1">
                          <button
                            onClick={() => handleUseStyleRefAsDrawing(ref)}
                            className="text-[8px] text-teal-400 font-black uppercase hover:text-teal-300 bg-teal-950/60 px-1.5 py-0.5 rounded border border-teal-800/40"
                          >
                            Kullan
                          </button>
                          <button
                            onClick={() => deleteStyleRef(ref.id)}
                            className="text-[9px] text-red-400 font-bold uppercase hover:text-red-300"
                          >
                            Sil
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* LIST OF CURRENT TECHNICAL DRAWINGS */}
            <div className="bg-[#111] border border-[#2a2a2a] rounded-lg p-5 shadow-xl space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 font-mono">
                Mevcut Çizimler ({drawings.length})
              </h3>

              {drawings.length === 0 ? (
                <p className="text-xs text-zinc-600 italic font-serif text-center py-4">
                  Henüz bir teknik çizim yüklenmedi.
                </p>
              ) : (
                <div className="space-y-2.5 max-h-[220px] overflow-y-auto pr-1">
                  {drawings.map((draw) => {
                    const isActive = selectedDrawingId === draw.id;
                    return (
                      <div
                        key={draw.id}
                        onClick={() => setSelectedDrawingId(draw.id)}
                        className={`p-3 rounded border text-xs flex items-center justify-between cursor-pointer transition-all ${
                          isActive
                            ? 'bg-[#1c1c1c] border-gold text-gold font-bold'
                            : 'bg-[#0a0a0a] border-[#222] text-zinc-400 hover:border-[#3d3d3d] hover:text-zinc-200'
                        }`}
                      >
                        <div className="space-y-0.5 truncate max-w-[170px]">
                          <p className="truncate">{draw.title}</p>
                          <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest">
                            {draw.style === 'scaled' ? 'Plan-Kesit' : draw.style === 'labeled' ? 'CAD' : 'Sade Eskiz'}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          {draw.approved ? (
                            <span className="px-1.5 py-0.5 bg-teal-500/20 text-teal-400 text-[8px] font-extrabold uppercase rounded border border-teal-500/30">ONAYLI</span>
                          ) : (
                            <span className="px-1.5 py-0.5 bg-zinc-800 text-zinc-600 text-[8px] uppercase rounded">TASLAK</span>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteDrawing(draw.id);
                            }}
                            className="text-zinc-600 hover:text-red-400 p-1 rounded"
                            title="Çizimi Sil"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>

          {/* RIGHT COLUMN: ACTIVE DRAWING DISPLAY IN CAD FRAME (SPAN-2) */}
          <div className="xl:col-span-2 space-y-6">
            {!activeDrawing ? (
              <div className="bg-[#111] border border-[#2a2a2a] rounded-lg p-16 text-center shadow-2xl flex flex-col items-center justify-center gap-4">
                <div className="w-16 h-16 bg-gold/10 rounded-full flex items-center justify-center border border-gold/20">
                  <Layers className="w-8 h-8 text-gold" />
                </div>
                <div className="max-w-md">
                  <h3 className="text-lg font-serif italic text-gold mb-2">Teknik Pafta Düzenleyici</h3>
                  <p className="text-zinc-500 text-xs leading-relaxed font-sans">
                    Burada el çizimi taslaklarınızı, ölçülendirme şemalarınızı ve plan kesitlerinizi profesyonel bir imalat paftasına dönüştürebilirsiniz. Başlamak için sol panelden yeni bir taslak yükleyin.
                  </p>
                </div>
              </div>
            ) : (
              <div className="bg-[#111] border border-[#2a2a2a] rounded-lg p-6 shadow-xl space-y-6">
                
                {/* TOOLBAR CONTROLS */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#222] pb-4">
                  <div className="space-y-1">
                    <h2 className="text-base font-serif italic text-gold flex items-center gap-1.5 font-bold">
                      {activeDrawing.title}
                    </h2>
                    <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                      Yükleme: {new Date(activeDrawing.uploadedAt).toLocaleDateString('tr-TR')} // ÖLÇEK: {activeDrawing.scale}
                    </p>
                  </div>

                  {/* Actions Bar */}
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Style modifier inside active drawing */}
                    <select
                      value={activeDrawing.style}
                      onChange={(e) => updateDrawingStyleOption(activeDrawing.id, e.target.value as any)}
                      className="bg-[#0a0a0a] text-zinc-300 text-xs rounded border border-[#2a2a2a] px-3 py-1.5 outline-none focus:border-gold"
                    >
                      <option value="simple">Sade Çizgi Taslağı</option>
                      <option value="scaled">Ölçekli Plan-Kesit</option>
                      <option value="labeled">Etiketli ve Notasyonlu</option>
                      <option value="reference">Referans Stile Göre</option>
                    </select>

                    <button
                      onClick={() => handleEnhanceDrawing(activeDrawing.id)}
                      disabled={isEnhancing}
                      className="px-3.5 py-1.5 bg-[#c5a059] hover:bg-[#d9b87a] disabled:bg-zinc-800 disabled:text-zinc-600 text-black text-xs font-bold uppercase tracking-wider rounded transition-all flex items-center gap-1"
                      id="btn-enhance-active-drawing"
                    >
                      {isEnhancing ? (
                        <div className="w-3.5 h-3.5 border-2 border-black border-t-transparent animate-spin rounded-full"></div>
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                      <span>Yapay Zeka ile Netleştir</span>
                    </button>

                    <button
                      onClick={() => toggleApproval(activeDrawing.id)}
                      className={`px-3.5 py-1.5 border font-bold uppercase tracking-wider text-xs rounded transition-all flex items-center gap-1 ${
                        activeDrawing.approved
                          ? 'bg-teal-950/80 border-teal-500/40 text-teal-400 shadow-md'
                          : 'bg-[#0a0a0a] border-[#222] text-zinc-400 hover:border-gold hover:text-gold'
                      }`}
                      id="btn-toggle-approve-drawing"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>{activeDrawing.approved ? 'Onaylandı' : 'Onayla'}</span>
                    </button>
                  </div>
                </div>

                {/* PAFTA CAD DRAFTING FRAME DISPLAY */}
                <div className="relative bg-[#0d0d0d] border border-[#222] p-5 rounded-lg overflow-hidden flex flex-col justify-between aspect-video select-none border-dashed">
                  
                  {/* Grid background blueprint layer */}
                  <div className="absolute inset-0 grid grid-cols-12 grid-rows-8 opacity-10 pointer-events-none">
                    {Array.from({ length: 96 }).map((_, i) => (
                      <div key={i} className="border border-zinc-400"></div>
                    ))}
                  </div>

                  {/* SVG Notations overlays (Ruler measurements based on style === 'labeled' or 'scaled') */}
                  {(activeDrawing.style === 'labeled' || activeDrawing.style === 'scaled') && (
                    <div className="absolute inset-x-12 top-10 flex items-center justify-between text-[10px] font-mono text-zinc-500 pointer-events-none z-10">
                      <span className="shrink-0 font-bold border-r border-[#3d3d3d] h-4"></span>
                      <div className="flex-1 border-t border-dashed border-[#3d3d3d] flex items-center justify-center gap-1 text-[#c5a059] font-bold">
                        <Ruler className="w-3 h-3" />
                        <span>SAHNE ENİ: {project.width}m</span>
                      </div>
                      <span className="shrink-0 font-bold border-l border-[#3d3d3d] h-4"></span>
                    </div>
                  )}

                  {(activeDrawing.style === 'labeled' || activeDrawing.style === 'scaled') && (
                    <div className="absolute inset-y-12 right-10 flex flex-col items-center justify-between text-[10px] font-mono text-zinc-500 pointer-events-none z-10">
                      <span className="shrink-0 font-bold border-b border-[#3d3d3d] w-4"></span>
                      <div className="flex-1 flex items-center justify-center gap-1 text-[#c5a059] font-bold rotate-90 my-auto shrink-0 w-max">
                        <Ruler className="w-3 h-3" />
                        <span>SAHNE BOYU: {project.length}m</span>
                      </div>
                      <span className="shrink-0 font-bold border-t border-[#3d3d3d] w-4"></span>
                    </div>
                  )}

                  {/* Blueprint Corners CAD markup */}
                  <div className="absolute top-2 left-2 text-[9px] font-mono text-zinc-600">ARKA SAHNE</div>
                  <div className="absolute bottom-2 left-2 text-[9px] font-mono text-zinc-600">ÖN SAHNE (SEYİRCİ)</div>

                  {/* THE IMAGE RENDERING */}
                  <div className="w-full h-full flex items-center justify-center relative overflow-hidden bg-black/40 rounded p-6">
                    <img
                      src={activeDrawing.image}
                      alt={activeDrawing.title}
                      className="max-w-full max-h-[85%] object-contain rounded transition-all duration-300"
                      style={{ filter: getStyleCSSFilter(activeDrawing.style) }}
                      referrerPolicy="no-referrer"
                    />

                    {/* Labeled annotations pointers layer */}
                    {activeDrawing.style === 'labeled' && (
                      <div className="absolute inset-0 pointer-events-none z-10">
                        {/* Dot with lines pointing to areas to make it feel extremely detailed */}
                        <div className="absolute top-1/4 left-1/3 flex flex-col items-center">
                          <span className="w-2 h-2 bg-red-500 rounded-full animate-ping"></span>
                          <span className="text-[8px] bg-black/95 text-red-400 font-mono border border-red-500/20 px-1 py-0.5 mt-1 rounded shadow">ANA KONSTRÜKSİYON</span>
                        </div>

                        <div className="absolute bottom-1/4 right-1/4 flex flex-col items-center">
                          <span className="w-2 h-2 bg-teal-500 rounded-full animate-ping"></span>
                          <span className="text-[8px] bg-black/95 text-teal-400 font-mono border border-teal-500/20 px-1 py-0.5 mt-1 rounded shadow">ZEMİN YÜZEY KAPLAMA</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* METRIC TITLE BLOCK (CAD LEGEND FRAME) */}
                  <div className="absolute bottom-4 right-4 bg-[#0a0a0a] border border-[#2a2a2a] p-3 text-[9px] font-mono text-zinc-400 flex flex-col gap-1 rounded w-52 z-20 shadow-2xl">
                    <p className="font-bold text-[#c5a059] border-b border-[#222] pb-1 truncate uppercase">ZB TECHNICAL DRAWING BLOCK</p>
                    <p className="truncate">PROJE: {project.name.toUpperCase()}</p>
                    <p>ÖLÇEK: {activeDrawing.scale}</p>
                    <p>TARİH: {new Date(activeDrawing.uploadedAt).toLocaleDateString('tr-TR')}</p>
                    <p className="text-zinc-500">PAFTA: DWG-ZB-{project.id.toUpperCase()}</p>
                  </div>

                </div>

                {/* BOTTOM BLOCK: MATERIAL NOTES & NOTATIONS */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-[#0a0a0a] p-5 rounded border border-[#222]">
                  
                  {/* Notes List */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-300 font-mono flex items-center gap-1.5">
                      <Info className="w-4 h-4 text-[#c5a059]" />
                      Malzeme ve Konstrüksiyon Notları
                    </h4>
                    
                    <ul className="space-y-2 text-xs text-zinc-400 font-mono list-disc pl-4 leading-relaxed">
                      {activeDrawing.materialNotes.map((note, idx) => (
                        <li key={idx} className="marker:text-gold">{note}</li>
                      ))}
                    </ul>
                  </div>

                  {/* CAD Legend Box */}
                  <div className="space-y-3 border-t md:border-t-0 md:border-l border-[#222] pt-4 md:pt-0 md:pl-6 flex flex-col justify-between">
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-300 font-mono flex items-center gap-1.5">
                        <Layers className="w-4 h-4 text-[#c5a059]" />
                        Çizim Paftası Lejantı
                      </h4>
                      <p className="text-[11px] text-zinc-500 leading-relaxed font-sans mt-2">
                        Seçilen stil (<span className="text-gold font-bold">{activeDrawing.style.toUpperCase()}</span>) pafta üzerindeki çizgileri netleştirir, boyut göstergelerini filtreler ve iskelet detaylarını otomatik olarak CAD imalat formuna uydurur.
                      </p>
                    </div>

                    <div className="flex items-center gap-3 text-[10px] font-mono text-zinc-500 mt-4 bg-[#111] p-2.5 rounded border border-[#222]">
                      <span className="w-3 h-3 bg-red-500/20 border border-red-500 rounded-full"></span>
                      <span>Konstrüksiyon Detayları</span>
                      <span className="w-3 h-3 bg-teal-500/20 border border-teal-500 rounded-full"></span>
                      <span>Malzeme Kaplamaları</span>
                    </div>
                  </div>

                </div>

              </div>
            )}
          </div>

        </div>
      )}


      {/* ---------------------------------------------------- */}
      {/* SUB-TAB: YERLEŞİM PLANI (LAYOUT PLANNER) */}
      {/* ---------------------------------------------------- */}
      {subTab === 'layout' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* GRID PLAN CANVAS MAP (SPAN-2) */}
          <div className="lg:col-span-2 bg-[#111] border border-[#2a2a2a] rounded-lg p-6 shadow-xl flex flex-col justify-between min-h-[480px]">
            <div>
              <div className="flex items-center justify-between mb-4 border-b border-[#222] pb-3">
                <div className="space-y-1">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5 font-mono">
                    <Layers className="w-4 h-4 text-gold" />
                    2D Sahne Üst Kat Planı (Yerleşim Izgarası)
                  </h3>
                  <p className="text-[11px] text-zinc-500 font-sans">
                    Fiziksel Ölçüler: En {project.width}m x Boy {project.length}m // Fare/dokunma ile sürükleyerek konumlandırın.
                  </p>
                </div>

                {/* Export Plan button */}
                <button
                  onClick={handleExportLayoutPNG}
                  disabled={placedProps.length === 0}
                  className="px-3 py-1.5 bg-teal-600 hover:bg-teal-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold uppercase tracking-wider rounded transition-all flex items-center gap-1.5"
                  id="btn-export-layout-png"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  <span>Kat Planı Görseli İndir</span>
                </button>
              </div>

              {/* GRID WORKSPACE */}
              <div
                ref={gridContainerRef}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
                className="relative w-full aspect-video bg-[#0a0a0a] rounded border-2 border-dashed border-[#222] overflow-hidden flex items-center justify-center select-none"
                style={{ touchAction: 'none' }}
              >
                {/* Visual grid ticks */}
                <div className="absolute inset-0 grid grid-cols-10 grid-rows-6 opacity-5 pointer-events-none">
                  {Array.from({ length: 60 }).map((_, i) => (
                    <div key={i} className="border border-zinc-500"></div>
                  ))}
                </div>

                {/* Stage Boundaries directions labels */}
                <div className="absolute top-2 left-1/2 -translate-x-1/2 text-[9px] uppercase tracking-wider font-mono text-zinc-700">ARKA DUVAR / PERDE HATTI</div>
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[9px] uppercase tracking-wider font-mono text-zinc-700">ÖN SAHNE (SEYİRCİ / IŞIK)</div>
                <div className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] uppercase tracking-wider font-mono text-zinc-700 rotate-90 origin-left">SAHNE SOLU (KULİS)</div>
                <div className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] uppercase tracking-wider font-mono text-zinc-700 -rotate-90 origin-right">SAHNE SAĞI (KULİS)</div>

                {/* PLACED DRAGGABLE ITEMS */}
                {placedProps.length === 0 ? (
                  <div className="text-center text-zinc-600 italic font-serif text-xs max-w-sm pointer-events-none">
                    Sahnede yerleştirilmiş dekor öğesi yok. Sağ paneldeki ekleme modülünden dekor yerleştirebilirsiniz.
                  </div>
                ) : (
                  placedProps.map((item) => {
                    const isDragged = activeDraggingId === item.id;
                    return (
                      <div
                        key={item.id}
                        onPointerDown={(e) => handlePointerDown(e, item)}
                        className={`absolute rounded text-[10px] font-bold shadow-2xl flex flex-col items-center justify-center border transition-shadow cursor-move ${
                          isDragged
                            ? 'bg-[#c5a059] text-black border-white shadow-gold/40 z-30'
                            : 'bg-[#2a2012]/95 border-gold/40 text-gold hover:border-gold hover:bg-[#322615] z-20'
                        }`}
                        style={{
                          left: `${item.x}%`,
                          top: `${item.y}%`,
                          width: `${item.widthPercent}%`,
                          height: `${item.lengthPercent}%`,
                          transform: 'translate(-50%, -50%)'
                        }}
                      >
                        <span className="truncate max-w-full px-1">{item.name}</span>
                        
                        {/* Size labels */}
                        <span className="text-[7px] opacity-60 font-mono leading-none">
                          {Math.round((item.widthPercent / 100) * project.width * 10) / 10}m × {Math.round((item.lengthPercent / 100) * project.length * 10) / 10}m
                        </span>

                        {/* Direct deletion handle inside item */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemovePlacedProp(item.id);
                          }}
                          className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-[#0a0a0a] text-zinc-500 hover:text-red-400 rounded-full border border-[#222] flex items-center justify-center text-[8px] font-extrabold"
                          title="Sil"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <p className="text-[11px] text-zinc-500 mt-4 leading-relaxed font-mono">
              * Tasarımları sürükleyerek dilediğiniz konuma bırakın. Ölçekleri sahnenizin fiziksel boyut oranlarına göre otomatik ayarlanır.
            </p>
          </div>

          {/* RIGHT SIDEBAR: PLACED ITEMS AND SIZES */}
          <div className="space-y-6">
            
            {/* ADD DECOR TO WORKSPACE */}
            <div className="bg-[#111] border border-[#2a2a2a] rounded-lg p-5 shadow-xl space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 font-mono">
                Sahneye Dekor Ekle
              </h3>

              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase text-zinc-500 font-mono">Dekor Listesi (Analizden)</label>
                  <select
                    value={selectedPropToAdd}
                    onChange={(e) => setSelectedPropToAdd(e.target.value)}
                    className="w-full bg-[#0a0a0a] text-xs text-zinc-300 rounded border border-[#2a2a2a] px-3 py-2 outline-none focus:border-gold"
                    id="select-layout-prop-add"
                  >
                    <option value="">-- Öğe Seçin --</option>
                    {decorItemsFromAnalysis.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.ad} (Metin Tespiti)
                      </option>
                    ))}
                    <option value="manual">-- Özel Manuel Dekor Ekle --</option>
                  </select>
                </div>

                {/* Manual entry if applicable */}
                {selectedPropToAdd === 'manual' && (
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase text-zinc-500 font-mono">Manuel Dekor Adı</label>
                    <input
                      type="text"
                      value={manualPropName}
                      onChange={(e) => setManualPropName(e.target.value)}
                      placeholder="Örn: 'Ana Şömine', 'Ağaç Dekoru'"
                      className="w-full bg-[#0a0a0a] text-xs text-zinc-300 rounded border border-[#2a2a2a] px-3 py-2 outline-none focus:border-gold"
                    />
                  </div>
                )}

                <button
                  onClick={handleAddPropToLayout}
                  disabled={!selectedPropToAdd || (selectedPropToAdd === 'manual' && !manualPropName.trim())}
                  className="w-full py-2 bg-[#c5a059] hover:bg-[#d9b87a] disabled:bg-zinc-800 disabled:text-zinc-600 text-black rounded text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-1 transition-all"
                  id="btn-add-layout-prop"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Sahneye Ekle</span>
                </button>
              </div>
            </div>

            {/* LIST OF PLACED ITEMS & COORDINATE CONTROL */}
            <div className="bg-[#111] border border-[#2a2a2a] rounded-lg p-5 shadow-xl space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 font-mono">
                Yerleşen Öğeler ve Boyutlandırma
              </h3>

              {placedProps.length === 0 ? (
                <p className="text-xs text-zinc-600 italic font-serif text-center py-4">
                  Sahnede yerleştirilmiş öğe yok.
                </p>
              ) : (
                <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1">
                  {placedProps.map((item) => (
                    <div key={item.id} className="bg-[#0a0a0a] p-3 rounded border border-[#222] text-xs space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="font-serif italic text-gold font-bold truncate max-w-[140px]">{item.name}</span>
                        <button
                          onClick={() => handleRemovePlacedProp(item.id)}
                          className="text-zinc-600 hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Coordinates notation */}
                      <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-zinc-500">
                        <span>Pozisyon X: %{item.x}</span>
                        <span>Pozisyon Y: %{item.y}</span>
                      </div>

                      {/* Manual sliders adjustments */}
                      <div className="space-y-2 pt-1 border-t border-[#111]">
                        {/* Width controller */}
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-zinc-500 font-mono">Genişlik (X-Ölçeği)</span>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => updatePlacedPropValue(item.id, 'widthPercent', -2)}
                              className="w-5 h-5 bg-[#161616] border border-[#222] hover:bg-[#222] rounded flex items-center justify-center font-bold text-zinc-300"
                            >
                              -
                            </button>
                            <span className="w-10 text-center font-mono text-[10px] text-zinc-300">{item.widthPercent}%</span>
                            <button
                              onClick={() => updatePlacedPropValue(item.id, 'widthPercent', 2)}
                              className="w-5 h-5 bg-[#161616] border border-[#222] hover:bg-[#222] rounded flex items-center justify-center font-bold text-zinc-300"
                            >
                              +
                            </button>
                          </div>
                        </div>

                        {/* Length controller */}
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-zinc-500 font-mono">Derinlik (Y-Ölçeği)</span>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => updatePlacedPropValue(item.id, 'lengthPercent', -2)}
                              className="w-5 h-5 bg-[#161616] border border-[#222] hover:bg-[#222] rounded flex items-center justify-center font-bold text-zinc-300"
                            >
                              -
                            </button>
                            <span className="w-10 text-center font-mono text-[10px] text-zinc-300">{item.lengthPercent}%</span>
                            <button
                              onClick={() => updatePlacedPropValue(item.id, 'lengthPercent', 2)}
                              className="w-5 h-5 bg-[#161616] border border-[#222] hover:bg-[#222] rounded flex items-center justify-center font-bold text-zinc-300"
                            >
                              +
                            </button>
                          </div>
                        </div>

                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>

        </div>
      )}

    </div>
  );
}
