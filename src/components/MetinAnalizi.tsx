import { useState, useRef, useEffect, DragEvent } from 'react';
import * as XLSX from 'xlsx';
import { Project, Scene, SceneBoundary, SceneAnalysis, Mekan, Gecis, Olay, Aksesuar } from '../types';
import { 
  UploadCloud, 
  File, 
  Trash2, 
  Sparkles, 
  ArrowRight, 
  CheckCircle, 
  CornerDownRight, 
  Activity, 
  Sliders, 
  MapPin, 
  Compass, 
  Package, 
  Layers, 
  Play, 
  Terminal, 
  Plus, 
  X, 
  ArrowRightLeft,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  EyeOff,
  Edit3,
  Check
} from 'lucide-react';

interface MetinAnaliziProps {
  project: Project;
  onUpdateProject: (p: Project) => void;
  addLog: (level: 'info' | 'error', message: string) => void;
}

const convertBeatsToScenes = (text: string, beats: { name: string; startPercentage: number; endPercentage: number }[]): { boundaries: SceneBoundary[], scenes: Scene[] } => {
  const textLen = text.length;
  const boundaries: SceneBoundary[] = [];
  const scenes: Scene[] = [];

  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i];
    
    let startIdx = Math.floor((beat.startPercentage / 100) * textLen);
    let endIdx = Math.floor((beat.endPercentage / 100) * textLen);

    if (i > 0) {
      startIdx = boundaries[i - 1].endIdx;
    } else {
      startIdx = 0;
    }

    if (i === beats.length - 1) {
      endIdx = textLen;
    } else {
      const nextNewline = text.indexOf('\n', endIdx);
      if (nextNewline !== -1 && nextNewline - endIdx < 1000) {
        endIdx = nextNewline + 1;
      } else {
        const nextSpace = text.indexOf(' ', endIdx);
        if (nextSpace !== -1 && nextSpace - endIdx < 100) {
          endIdx = nextSpace + 1;
        }
      }
    }

    boundaries.push({
      name: beat.name.toUpperCase().trim(),
      startIdx,
      endIdx,
      approved: true
    });

    scenes.push({
      id: `scene-${i}-${Math.random().toString(36).substring(2, 6)}`,
      name: beat.name.toUpperCase().trim(),
      content: text.slice(startIdx, endIdx).trim()
    });
  }

  return { boundaries, scenes };
};

export default function MetinAnalizi({ project, onUpdateProject, addLog }: MetinAnaliziProps) {
  const [fileLoading, setFileLoading] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<{
    extraction: 'idle' | 'running' | 'completed' | 'error';
    mekanOlay: 'idle' | 'running' | 'completed' | 'error';
    aksesuar: 'idle' | 'running' | 'completed' | 'error';
  }>({ extraction: 'idle', mekanOlay: 'idle', aksesuar: 'idle' });
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [anthropicApiKey, setAnthropicApiKey] = useState(() => {
    return localStorage.getItem('ANTHROPIC_API_KEY') || '';
  });
  const [showApiKeyPanel, setShowApiKeyPanel] = useState(false);
  const [isKeySaved, setIsKeySaved] = useState(false);

  const [workspaceTab, setWorkspaceTab] = useState<'aksesuarlar' | 'diger'>('aksesuarlar');
  const [activePerdeTab, setActivePerdeTab] = useState<'Perde 1' | 'Perde 2'>('Perde 1');
  const [expandedScenes, setExpandedScenes] = useState<Record<string, boolean>>({});
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  const [showScriptManagement, setShowScriptManagement] = useState(!project.scriptText);
  const [aksesuarCorrections, setAksesuarCorrections] = useState<Record<string, string>>({});
  const [correctingSceneId, setCorrectingSceneId] = useState<string | null>(null);
  const [showDebugRaw, setShowDebugRaw] = useState(false);

  // Editing scene boundaries before split
  const [boundaries, setBoundaries] = useState<SceneBoundary[]>([]);
  const [newBoundaryName, setNewBoundaryName] = useState('');

  // Prose specific states
  const [isDetectingBeats, setIsDetectingBeats] = useState(false);
  const [editingBeatIdx, setEditingBeatIdx] = useState<number | null>(null);
  const [editingBeatName, setEditingBeatName] = useState('');
  const [editingBeatDesc, setEditingBeatDesc] = useState('');
  const [newBeatName, setNewBeatName] = useState('');
  const [newBeatDesc, setNewBeatDesc] = useState('');

  // Editing correction instructions
  const [corrections, setCorrections] = useState<{
    mekanlar: string;
    gecisler: string;
    olaylar: string;
    aksesuarlar: string;
  }>({
    mekanlar: '',
    gecisler: '',
    olaylar: '',
    aksesuarlar: '',
  });

  // Highlight and temporary edits
  const [tempData, setTempData] = useState<{
    mekanlar?: Mekan[];
    gecisler?: Gecis[];
    olaylar?: Olay[];
    aksesuarlar?: Aksesuar[];
  }>({});

  const [correctingTable, setCorrectingTable] = useState<{
    mekanlar: boolean;
    gecisler: boolean;
    olaylar: boolean;
    aksesuarlar: boolean;
  }>({
    mekanlar: false,
    gecisler: false,
    olaylar: false,
    aksesuarlar: false,
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize boundaries when scriptText is loaded
  useEffect(() => {
    if (project.scriptText) {
      if (project.sceneBoundaries && project.sceneBoundaries.length > 0) {
        setBoundaries(project.sceneBoundaries);
      } else {
        // Auto run regex boundaries
        const detected = detectBoundaries(project.scriptText);
        setBoundaries(detected);
      }
    }
  }, [project.scriptText, project.sceneBoundaries]);

  // Set default selected scene once scenes are split
  useEffect(() => {
    if (project.scenes && project.scenes.length > 0 && !selectedSceneId) {
      setSelectedSceneId(project.scenes[0].id);
    }
  }, [project.scenes]);

  // Regex Boundary Detector
  const detectBoundaries = (text: string): SceneBoundary[] => {
    // Regex for typical Turkish play headers: "SAHNE 1", "PERDE II", "BÖLÜM 3", "TABLO 4", "İÇ MEKAN"
    const regex = /(?:SAHNE|PERDE|BÖLÜM|TABLO)\s+([0-9a-zA-ZIVXLCİıŞşĞğÇçÖöÜü]+)|(?:[0-9]+)\.\s*(?:SAHNE|PERDE|BÖLÜM|TABLO)|(?:İÇ|DIŞ)\s*MEKAN/gi;
    const list: SceneBoundary[] = [];
    let match;

    while ((match = regex.exec(text)) !== null) {
      list.push({
        name: match[0].toUpperCase().trim(),
        startIdx: match.index,
        endIdx: text.length,
        approved: false
      });
    }

    if (list.length === 0) {
      list.push({
        name: 'SAHNE 1',
        startIdx: 0,
        endIdx: text.length,
        approved: false
      });
    } else {
      for (let i = 0; i < list.length - 1; i++) {
        list[i].endIdx = list[i + 1].startIdx;
      }
    }

    return list;
  };

  const analyzeScriptViaApi = async (scriptText: string, scenes: Scene[]) => {
    addLog('info', `Mekan/Aksesuar analizi paralel olarak başladı, karakter sayısı: ${scriptText.length}`);
    console.log(`Mekan/Aksesuar analizi başladı, karakter sayısı: ${scriptText.length}`);
    
    setAnalysisProgress(p => ({ ...p, mekanOlay: 'running', aksesuar: 'running' }));

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (anthropicApiKey) {
        headers['x-anthropic-api-key'] = anthropicApiKey;
      }

      // Parallelize calls via Promise.all
      const [mekanOlayRes, aksesuarRes] = await Promise.all([
        fetch('/api/analyze-script', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            scriptText,
            scenes,
            analysisType: 'mekan-olay'
          })
        }).then(async (res) => {
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Mekan/Olay analizi başarısız oldu' }));
            throw new Error(err.error || 'Mekan/Olay analizi başarısız oldu');
          }
          setAnalysisProgress(p => ({ ...p, mekanOlay: 'completed' }));
          addLog('info', 'Mekan, geçiş ve olay tespiti başarıyla tamamlandı.');
          return res.json();
        }).catch(err => {
          setAnalysisProgress(p => ({ ...p, mekanOlay: 'error' }));
          addLog('error', `Mekan/Olay analizi hatası: ${err.message}`);
          throw err;
        }),

        fetch('/api/analyze-script', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            scriptText,
            scenes,
            analysisType: 'aksesuar'
          })
        }).then(async (res) => {
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Aksesuar analizi başarısız oldu' }));
            throw new Error(err.error || 'Aksesuar analizi başarısız oldu');
          }
          setAnalysisProgress(p => ({ ...p, aksesuar: 'completed' }));
          addLog('info', 'Dekor/Aksesuar tespiti başarıyla tamamlandı.');
          return res.json();
        }).catch(err => {
          setAnalysisProgress(p => ({ ...p, aksesuar: 'error' }));
          addLog('error', `Aksesuar analizi hatası: ${err.message}`);
          throw err;
        })
      ]);

      const result = {
        mekanlar: mekanOlayRes.mekanlar || [],
        gecisler: mekanOlayRes.gecisler || [],
        olaylar: mekanOlayRes.olaylar || [],
        aksesuarlar: aksesuarRes.aksesuarlar || []
      };

      const isEmpty = (!result.mekanlar || result.mekanlar.length === 0) &&
                      (!result.aksesuarlar || result.aksesuarlar.length === 0) &&
                      (!result.olaylar || result.olaylar.length === 0);

      if (isEmpty) {
        throw new Error('Bu belge çok uzun veya analiz tamamlanamadı, lütfen tekrar deneyin.');
      }

      addLog('info', `Mekan/Aksesuar analizi tamamlandı: ${result.mekanlar?.length || 0} mekan, ${result.aksesuarlar?.length || 0} aksesuar bulundu`);
      console.log(`Mekan/Aksesuar analizi tamamlandı: ${result.mekanlar?.length || 0} mekan, ${result.aksesuarlar?.length || 0} aksesuar bulundu`);

      return result;
    } catch (err: any) {
      addLog('error', `Mekan/Aksesuar analizi hatası: ${err.message}`);
      console.error(`Mekan/Aksesuar analizi hatası: ${err.message}`);
      throw err;
    }
  };

  // 1. File Upload Handlers
  const handleFileUpload = async (file: File) => {
    setFileLoading(true);
    setUploadError(null);
    setAnalysisProgress({ extraction: 'running', mekanOlay: 'idle', aksesuar: 'idle' });
    addLog('info', `"${file.name}" dosyası sunucuya gönderiliyor...`);
    
    try {
      const reader = new FileReader();
      
      reader.onload = async () => {
        try {
          const base64Data = (reader.result as string).split(',')[1];
          
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (anthropicApiKey) {
            headers['x-anthropic-api-key'] = anthropicApiKey;
          }

          const response = await fetch('/api/parse-file', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              fileName: file.name,
              fileType: file.type,
              fileData: base64Data
            })
          });

          if (!response.ok) {
            const errData = await response.json().catch(() => ({ error: 'Dosya ayrıştırılamadı' }));
            throw new Error(errData.error || 'Dosya ayrıştırılamadı');
          }

          const data = await response.json();
          if (!data || !data.text) {
            throw new Error('Sunucudan geçerli bir metin alınamadı. Çıkarılan metin boş.');
          }

          const pageCountLog = data.pageCount ? ` (${data.pageCount} sayfa)` : '';
          addLog('info', `Metin çıkarma başarılı: ${data.text.length} karakter okundu${pageCountLog}.`);
          setAnalysisProgress(p => ({ ...p, extraction: 'completed' }));
          
          // Auto detect play headers vs prose (robust detection)
          const checkIsPlayScript = (text: string): boolean => {
            // Line-starting structural play elements
            const lineHeaderRegex = /^\s*(?:(?:SAHNE|PERDE|TABLO|BÖLÜM)\s+[0-9a-zA-ZIVXLCİıŞşĞğÇçÖöÜü]+|(?:[0-9]+)\.\s*(?:SAHNE|PERDE|TABLO|BÖLÜM)|(?:İÇ|DIŞ)\s*MEKAN)\s*$/gim;
            const headerMatches = text.match(lineHeaderRegex) || [];
            
            // Character dialogue starts, e.g. "AYŞE: " or "ALİ - " at the start of a line
            const dialogueRegex = /^\s*[A-ZĞÜŞİÖÇI]{2,}(?:\s+[A-ZĞÜŞİÖÇI]{2,})*\s*[:\-–—]\s*\w+/gm;
            const dialogueMatches = text.match(dialogueRegex) || [];
            
            console.log(`[Script Detection] Header matches: ${headerMatches.length}, Dialogue matches: ${dialogueMatches.length}`);
            
            // If substantial dialogue markers or multiple distinct line-starting play headers are present, it is a play script.
            // A typical novel/prose has 0 dialogue lines starting with "CHARACTER: " and at most 1 or 2 section headings on separate lines.
            if (dialogueMatches.length > 5 || headerMatches.length > 2) {
              return true;
            }
            return false;
          };

          const hasPlayHeaders = checkIsPlayScript(data.text);
          addLog('info', `Metin türü tespit edildi: ${hasPlayHeaders ? 'TİYATRO' : 'DÜZYAZI'}`);

          if (!hasPlayHeaders) {
            addLog('info', 'Düzyazı (roman/hikaye) formatı tespit edildi. Doğal anlatı birimleri (narrative beats) analizi başlatılıyor...');
            setIsDetectingBeats(true);
            
            try {
              const beatsRes = await fetch('/api/detect-narrative-beats', {
                method: 'POST',
                headers,
                body: JSON.stringify({ scriptText: data.text })
              });
              
              if (!beatsRes.ok) {
                const errData = await beatsRes.json().catch(() => ({ error: 'Anlatı birimleri çıkartılamadı' }));
                throw new Error(errData.error || 'Anlatı birimleri çıkartılamadı');
              }
              
              const beatsData = await beatsRes.json();
              addLog('info', `Yapay zeka metni ${beatsData.beats.length} doğal anlatı birimine (dramatik kesite) böldü.`);
              
              onUpdateProject({
                ...project,
                scriptText: data.text,
                isProse: true,
                narrativeBeats: beatsData.beats,
                scenes: [],
                sceneBoundaries: []
              });
            } catch (beatsErr: any) {
              addLog('error', `Anlatı birimleri tespit edilirken hata: ${beatsErr.message}`);
              throw beatsErr;
            } finally {
              setIsDetectingBeats(false);
            }
          } else {
            // Auto detect boundaries for play script
            const detected = detectBoundaries(data.text);

            // Split text into scenes immediately to bypass confirmation step
            const scenes: Scene[] = detected.map((b, i) => {
              const content = data.text.slice(b.startIdx, b.endIdx).trim();
              return {
                id: `scene-${i}-${Math.random().toString(36).substring(2, 6)}`,
                name: b.name,
                content
              };
            });

            // Run Claude analysis directly after text extraction completes
            const result = await analyzeScriptViaApi(data.text, scenes);

            // Mark all scenes as analyzed in debug state
            const newDebug: Record<string, any> = {};
            for (const sc of scenes) {
              newDebug[sc.id] = {
                timestamp: new Date().toISOString(),
                sceneName: sc.name,
                analyzedByUnified: true
              };
            }

            onUpdateProject({
              ...project,
              scriptText: data.text,
              isProse: false,
              sceneBoundaries: detected.map(b => ({ ...b, approved: true })),
              scenes,
              analysis: {
                mekanlar: result.mekanlar,
                gecisler: result.gecisler,
                olaylar: result.olaylar,
                aksesuarlar: result.aksesuarlar,
                debug: newDebug
              }
            });
          }
        } catch (err: any) {
          addLog('error', `Analiz hatası: ${err.message}`);
          console.error(`Analiz hatası: ${err.message}`);
          setUploadError(err.message || 'Analiz sırasında beklenmeyen bir hata oluştu.');
          setAnalysisProgress(p => ({
            extraction: p.extraction === 'running' ? 'error' : p.extraction,
            mekanOlay: p.mekanOlay === 'running' ? 'error' : p.mekanOlay,
            aksesuar: p.aksesuar === 'running' ? 'error' : p.aksesuar
          }));
        } finally {
          setFileLoading(false);
        }
      };

      reader.onerror = () => {
        addLog('error', 'Dosya okunamadı');
        setUploadError('Yüklenen dosya okunamadı. Lütfen dosyanın bozuk olmadığından emin olun.');
        setFileLoading(false);
      };

      reader.readAsDataURL(file);
    } catch (err: any) {
      addLog('error', `Yükleme hatası: ${err.message}`);
      console.error(`Yükleme hatası: ${err.message}`);
      setUploadError(err.message || 'Dosya yükleme sırasında bir hata oluştu.');
      setFileLoading(false);
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  // 2. Boundary Editing Handlers
  const handleAddBoundary = () => {
    if (!newBoundaryName.trim() || !project.scriptText) return;
    const newBound: SceneBoundary = {
      name: newBoundaryName.toUpperCase().trim(),
      startIdx: Math.floor(project.scriptText.length / 2), // place somewhere in-between
      endIdx: project.scriptText.length,
      approved: false
    };

    const updated = [...boundaries, newBound].sort((a, b) => a.startIdx - b.startIdx);
    // recalculate end index bounds
    for (let i = 0; i < updated.length - 1; i++) {
      updated[i].endIdx = updated[i + 1].startIdx;
    }
    setBoundaries(updated);
    setNewBoundaryName('');
    addLog('info', `Yeni sahne sınırı eklendi: "${newBound.name}"`);
  };

  const handleDeleteBoundary = (idx: number) => {
    const updated = boundaries.filter((_, i) => i !== idx);
    // recalculate end index bounds
    for (let i = 0; i < updated.length - 1; i++) {
      updated[i].endIdx = updated[i + 1].startIdx;
    }
    if (updated.length > 0) {
      updated[updated.length - 1].endIdx = project.scriptText?.length || 0;
    }
    setBoundaries(updated);
    addLog('info', `Sahne sınırı kaldırıldı.`);
  };

  const handleBoundaryNameChange = (idx: number, val: string) => {
    const updated = [...boundaries];
    updated[idx].name = val.toUpperCase();
    setBoundaries(updated);
  };

  const handleConfirmBoundaries = () => {
    if (!project.scriptText || boundaries.length === 0) return;
    
    // Split the script text into scenes
    const scenes: Scene[] = boundaries.map((b, i) => {
      const content = project.scriptText!.slice(b.startIdx, b.endIdx).trim();
      return {
        id: `scene-${i}-${Math.random().toString(36).substring(2, 6)}`,
        name: b.name,
        content
      };
    });

    onUpdateProject({
      ...project,
      sceneBoundaries: boundaries.map(b => ({ ...b, approved: true })),
      scenes,
      analysis: {
        mekanlar: [],
        gecisler: [],
        olaylar: [],
        aksesuarlar: [],
        debug: null
      }
    });

    addLog('info', `Sahne sınırları onaylandı. Tiyatro metni ${scenes.length} sahneye ayrıştırıldı.`);
  };

  // Reset/Clear script
  const handleClearScript = () => {
    if (!confirm('Senaryoyu ve tüm analiz verilerini silmek istediğinize emin misiniz?')) return;
    onUpdateProject({
      ...project,
      scriptText: undefined,
      sceneBoundaries: [],
      scenes: [],
      isProse: undefined,
      narrativeBeats: undefined,
      analysis: undefined
    });
    setBoundaries([]);
    setSelectedSceneId(null);
    addLog('info', 'Proje senaryosu temizlendi.');
  };

  // Prose Narrative Beats editing handlers
  const rebalanceBeatPercentages = (list: any[]) => {
    if (list.length === 0) return [];
    const count = list.length;
    const step = Math.floor(100 / count);
    return list.map((b, idx) => ({
      ...b,
      startPercentage: idx * step,
      endPercentage: idx === count - 1 ? 100 : (idx + 1) * step
    }));
  };

  const handleAddProseBeat = () => {
    if (!newBeatName.trim()) return;
    const newBeat = {
      name: newBeatName.trim(),
      description: newBeatDesc.trim() || 'Yeni eklenen anlatı birimi.',
      startPercentage: 0,
      endPercentage: 100
    };
    const updated = rebalanceBeatPercentages([...(project.narrativeBeats || []), newBeat]);
    onUpdateProject({
      ...project,
      narrativeBeats: updated
    });
    setNewBeatName('');
    setNewBeatDesc('');
    addLog('info', `Yeni anlatı birimi eklendi: "${newBeat.name}"`);
  };

  const handleDeleteProseBeat = (idx: number) => {
    const filtered = (project.narrativeBeats || []).filter((_, i) => i !== idx);
    const updated = rebalanceBeatPercentages(filtered);
    onUpdateProject({
      ...project,
      narrativeBeats: updated
    });
    addLog('info', 'Anlatı birimi kaldırıldı.');
  };

  const handleUpdateProseBeat = (idx: number, name: string, description: string) => {
    const updated = (project.narrativeBeats || []).map((b, i) => {
      if (i === idx) {
        return { ...b, name, description };
      }
      return b;
    });
    onUpdateProject({
      ...project,
      narrativeBeats: updated
    });
    addLog('info', `Anlatı birimi güncellendi: "${name}"`);
  };

  const handleConfirmProseBeats = async () => {
    if (!project.scriptText || !project.narrativeBeats || project.narrativeBeats.length === 0) return;
    
    setFileLoading(true);
    setAnalysisProgress({ extraction: 'completed', mekanOlay: 'running', aksesuar: 'running' });
    addLog('info', 'Düzyazı anlatı birimleri üzerinden bütünsel metin analizi işlemi başlatıldı...');
    
    try {
      const { boundaries: finalBounds, scenes: finalScenes } = convertBeatsToScenes(project.scriptText, project.narrativeBeats);
      const result = await analyzeScriptViaApi(project.scriptText, finalScenes);

      // Mark all scenes as analyzed in debug state
      const newDebug: Record<string, any> = {};
      for (const sc of finalScenes) {
        newDebug[sc.id] = {
          timestamp: new Date().toISOString(),
          sceneName: sc.name,
          analyzedByUnified: true
        };
      }

      onUpdateProject({
        ...project,
        sceneBoundaries: finalBounds,
        scenes: finalScenes,
        analysis: {
          mekanlar: result.mekanlar,
          gecisler: result.gecisler,
          olaylar: result.olaylar,
          aksesuarlar: result.aksesuarlar,
          debug: newDebug
        }
      });
      
      addLog('info', 'Düzyazı analizi başarıyla tamamlandı!');
    } catch (err: any) {
      addLog('error', `Düzyazı analizi hatası: ${err.message}`);
      console.error(err);
    } finally {
      setFileLoading(false);
    }
  };

  // 3. Gemini Extraction Execution
  const handleAnalyzeScene = async (scene: Scene) => {
    setAnalyzingId(scene.id);
    addLog('info', `Yapay zeka analizi başlatıldı. Sahne: "${scene.name}"`);
    
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (anthropicApiKey) {
        headers['x-anthropic-api-key'] = anthropicApiKey;
      }

      const res = await fetch('/api/analyze-scene', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          sceneText: scene.content,
          sceneName: scene.name
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Analiz başarısız oldu');
      }

      const result = await res.json();
      addLog('info', `Sahne analizi başarıyla tamamlandı. (${result.mekanlar.length} mekan, ${result.aksesuarlar.length} dekor/aksesuar bulundu)`);

      // Merge results with existing project analysis if any
      const existingMekanlar = project.analysis?.mekanlar || [];
      const existingGecisler = project.analysis?.gecisler || [];
      const existingOlaylar = project.analysis?.olaylar || [];
      const existingAksesuarlar = project.analysis?.aksesuarlar || [];

      // Avoid double-inserting duplicates by checking names
      const newMekanlar = [...existingMekanlar];
      for (const m of result.mekanlar) {
        if (!newMekanlar.some(em => em.ad.toLowerCase() === m.ad.toLowerCase())) {
          newMekanlar.push(m);
        }
      }

      // Append transitions and events directly as they are scene-specific
      const newGecisler = [...existingGecisler, ...result.gecisler];
      const newOlaylar = [...existingOlaylar, ...result.olaylar];

      // Handle accessories and track scenes
      const newAksesuarlar = [...existingAksesuarlar];
      for (const a of result.aksesuarlar) {
        const matchIdx = newAksesuarlar.findIndex(ea => ea.ad.toLowerCase() === a.ad.toLowerCase());
        if (matchIdx > -1) {
          // If already exists, append this scene to "Kullanıldığı Sahneler" list
          const list = newAksesuarlar[matchIdx].kullanildigiSahneler || [];
          if (!list.includes(scene.name)) {
            newAksesuarlar[matchIdx].kullanildigiSahneler = [...list, scene.name];
          }
        } else {
          newAksesuarlar.push({
            ...a,
            kullanildigiSahneler: [scene.name]
          });
        }
      }

      onUpdateProject({
        ...project,
        analysis: {
          mekanlar: newMekanlar,
          gecisler: newGecisler,
          olaylar: newOlaylar,
          aksesuarlar: newAksesuarlar,
          debug: {
            ...(project.analysis?.debug || {}),
            [scene.id]: result.debug
          }
        }
      });
    } catch (error: any) {
      addLog('error', `Analiz hatası: ${error.message}`);
      alert(`Hata: ${error.message}`);
    } finally {
      setAnalyzingId(null);
    }
  };

  // Run all scenes consecutively -> Refactored to a single unified API call
  const handleAnalyzeAll = async () => {
    if (!project.scriptText || !project.scenes || project.scenes.length === 0) return;
    if (!confirm('Tüm oyun metni tek parça halinde yapay zeka ile analiz edilecektir. Devam etmek istiyor musunuz?')) return;
    
    setFileLoading(true);
    setAnalysisProgress({ extraction: 'completed', mekanOlay: 'running', aksesuar: 'running' });
    addLog('info', 'Yapay zeka ile bütünsel metin analizi işlemi başlatıldı...');
    
    try {
      const result = await analyzeScriptViaApi(project.scriptText, project.scenes);

      // Mark all scenes as analyzed in debug state
      const newDebug: Record<string, any> = {};
      for (const sc of project.scenes) {
        newDebug[sc.id] = {
          timestamp: new Date().toISOString(),
          sceneName: sc.name,
          analyzedByUnified: true
        };
      }

      onUpdateProject({
        ...project,
        analysis: {
          mekanlar: result.mekanlar,
          gecisler: result.gecisler,
          olaylar: result.olaylar,
          aksesuarlar: result.aksesuarlar,
          debug: newDebug
        }
      });
    } catch (error: any) {
      addLog('error', `Metin analizi hatası: ${error.message}`);
      console.error(`Metin analizi hatası: ${error.message}`);
      alert(error.message);
      setAnalysisProgress(p => ({
        ...p,
        mekanOlay: p.mekanOlay === 'running' ? 'error' : p.mekanOlay,
        aksesuar: p.aksesuar === 'running' ? 'error' : p.aksesuar
      }));
    } finally {
      setFileLoading(false);
    }
  };

  // 4. AIS-Driven Correction Instructions
  const handleApplyCorrection = async (tableType: 'mekanlar' | 'gecisler' | 'olaylar' | 'aksesuarlar', customSceneId?: string) => {
    const targetSceneId = customSceneId || selectedSceneId;
    if (!targetSceneId) return;

    const activeScene = project.scenes?.find(s => s.id === targetSceneId);
    if (!activeScene) return;

    const instruction = tableType === 'aksesuarlar' && customSceneId 
      ? aksesuarCorrections[customSceneId] 
      : corrections[tableType];

    if (!instruction || !instruction.trim()) return;

    setCorrectingTable(prev => ({ ...prev, [tableType]: true }));
    if (customSceneId) {
      setCorrectingSceneId(customSceneId);
    }
    addLog('info', `Düzeltme talimatı sunucuya iletiliyor: "${instruction}"`);

    // Get table elements specifically associated with this scene
    let currentData: any[] = [];
    if (tableType === 'mekanlar') {
      currentData = project.analysis?.mekanlar || [];
    } else if (tableType === 'gecisler') {
      currentData = (project.analysis?.gecisler || []).filter(g => g.sahneNo === activeScene.name);
    } else if (tableType === 'olaylar') {
      currentData = (project.analysis?.olaylar || []).filter(o => o.sahneNo === activeScene.name);
    } else if (tableType === 'aksesuarlar') {
      currentData = (project.analysis?.aksesuarlar || []).filter(a => a.kullanildigiSahneler?.includes(activeScene.name));
    }

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (anthropicApiKey) {
        headers['x-anthropic-api-key'] = anthropicApiKey;
      }

      const res = await fetch('/api/correct-table', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tableType,
          currentData,
          instruction,
          sceneText: activeScene.content
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Düzeltme uygulanamadı');
      }

      const responseData = await res.json();
      addLog('info', `Yapay zeka düzeltmeyi başarıyla uyguladı. Satırlar güncellendi.`);

      // Store in tempData so we can render green added / red removed highlights
      setTempData(prev => ({
        ...prev,
        [tableType]: responseData.data
      }));
    } catch (err: any) {
      addLog('error', `Düzeltme uygulama hatası: ${err.message}`);
      alert(`Hata: ${err.message}`);
      if (customSceneId) {
        setCorrectingSceneId(null);
      }
    } finally {
      setCorrectingTable(prev => ({ ...prev, [tableType]: false }));
    }
  };

  const handleConfirmCorrection = (tableType: 'mekanlar' | 'gecisler' | 'olaylar' | 'aksesuarlar', customSceneId?: string) => {
    const modifiedList = tempData[tableType];
    if (!modifiedList || !project.analysis) return;

    // Filter out rows marked as 'removed' and clear 'added' flags
    const finalizedList = modifiedList
      .filter(item => item.changed !== 'removed')
      .map(item => ({ ...item, changed: null }));

    const targetSceneId = customSceneId || selectedSceneId;
    const activeScene = project.scenes?.find(s => s.id === targetSceneId);
    const sceneName = activeScene?.name || '';

    let newMekanlar = [...project.analysis.mekanlar];
    let newGecisler = [...project.analysis.gecisler];
    let newOlaylar = [...project.analysis.olaylar];
    let newAksesuarlar = [...project.analysis.aksesuarlar];

    if (tableType === 'mekanlar') {
      newMekanlar = finalizedList;
    } else if (tableType === 'gecisler') {
      // Re-merge scene transitions
      newGecisler = [
        ...newGecisler.filter(g => g.sahneNo !== sceneName),
        ...finalizedList
      ];
    } else if (tableType === 'olaylar') {
      // Re-merge scene events
      newOlaylar = [
        ...newOlaylar.filter(o => o.sahneNo !== sceneName),
        ...finalizedList
      ];
    } else if (tableType === 'aksesuarlar') {
      // Re-merge accessories: remove this scene reference for deleted ones, or add
      const otherAksesuarlar = newAksesuarlar.filter(a => !a.kullanildigiSahneler?.includes(sceneName));
      
      // Merge verified ones back
      newAksesuarlar = [
        ...otherAksesuarlar,
        ...finalizedList.map(a => ({
          ...a,
          kullanildigiSahneler: a.kullanildigiSahneler?.includes(sceneName) 
            ? a.kullanildigiSahneler 
            : [...(a.kullanildigiSahneler || []), sceneName]
        }))
      ];
    }

    onUpdateProject({
      ...project,
      analysis: {
        ...project.analysis,
        mekanlar: newMekanlar,
        gecisler: newGecisler,
        olaylar: newOlaylar,
        aksesuarlar: newAksesuarlar
      }
    });

    // Clear temp states
    setTempData(prev => ({ ...prev, [tableType]: undefined }));
    if (customSceneId) {
      setAksesuarCorrections(prev => ({ ...prev, [customSceneId]: '' }));
      setCorrectingSceneId(null);
    } else {
      setCorrections(prev => ({ ...prev, [tableType]: '' }));
    }
    addLog('info', `"${tableType}" tablosunun düzeltmeleri onaylandı ve kaydedildi.`);
  };

  const handleCancelCorrection = (tableType: 'mekanlar' | 'gecisler' | 'olaylar' | 'aksesuarlar', customSceneId?: string) => {
    setTempData(prev => ({ ...prev, [tableType]: undefined }));
    if (customSceneId) {
      setCorrectingSceneId(null);
    }
    addLog('info', `Düzeltmeler iptal edildi.`);
  };

  const handleUpdateAksesuarStatus = (id: string, status: 'Satın Alınacak' | 'Üretilecek' | '') => {
    if (!project.analysis) return;
    const updatedAksesuarlar = (project.analysis.aksesuarlar || []).map(a => {
      if (a.id === id) {
        return { ...a, status };
      }
      return a;
    });
    
    onUpdateProject({
      ...project,
      analysis: {
        ...project.analysis,
        aksesuarlar: updatedAksesuarlar
      }
    });
    addLog('info', `Aksesuar statüsü "${status || 'Boş'}" olarak güncellendi.`);
  };

  const getPerdeGroup = (sceneName: string, idx: number, total: number): 'Perde 1' | 'Perde 2' => {
    const nameLower = sceneName.toLowerCase();
    if (nameLower.includes('2. perde') || nameLower.includes('perde 2') || nameLower.includes('perde ii') || nameLower.includes('ikinci perde') || nameLower.includes('2.perde')) {
      return 'Perde 2';
    }
    if (nameLower.includes('1. perde') || nameLower.includes('perde 1') || nameLower.includes('perde i') || nameLower.includes('birinci perde') || nameLower.includes('1.perde')) {
      return 'Perde 1';
    }
    if (idx >= total / 2) {
      return 'Perde 2';
    }
    return 'Perde 1';
  };

  // Assign each scene to its Perde sequentially
  let currentPerdeTracker: 'Perde 1' | 'Perde 2' = 'Perde 1';
  const scenesWithPerde = (project.scenes || []).map((scene, idx, arr) => {
    const nameLower = scene.name.toLowerCase();
    if (nameLower.includes('2. perde') || nameLower.includes('perde 2') || nameLower.includes('perde ii') || nameLower.includes('ikinci perde') || nameLower.includes('2.perde')) {
      currentPerdeTracker = 'Perde 2';
    } else if (nameLower.includes('1. perde') || nameLower.includes('perde 1') || nameLower.includes('perde i') || nameLower.includes('birinci perde') || nameLower.includes('1.perde')) {
      currentPerdeTracker = 'Perde 1';
    } else {
      if (idx >= arr.length / 2 && currentPerdeTracker === 'Perde 1' && !arr.slice(idx).some(s => s.name.toLowerCase().includes('perde'))) {
        currentPerdeTracker = 'Perde 2';
      }
    }
    return { ...scene, perde: currentPerdeTracker };
  });

  const visibleScenes = scenesWithPerde.filter(s => s.perde === activePerdeTab);

  const handleExport = (format: 'xlsx' | 'csv') => {
    const list = project.analysis?.aksesuarlar || [];
    if (list.length === 0) {
      alert("Dışa aktarılacak aksesuar verisi bulunamadı!");
      return;
    }

    const exportData = list.map(item => {
      const scenesUsed = item.kullanildigiSahneler || [];
      const perdeInfo = scenesUsed.map(sName => {
        const sIdx = (project.scenes || []).findIndex(sc => sc.name.toLowerCase() === sName.toLowerCase());
        const pNum = getPerdeGroup(sName, sIdx === -1 ? 0 : sIdx, project.scenes?.length || 1);
        return `${pNum === 'Perde 2' ? '2. Perde' : '1. Perde'} - ${sName}`;
      }).join(', ');

      return {
        'Öğe/Aksesuar Adı': item.ad,
        'Durum': item.status || 'Belirsiz',
        'Kullanıldığı Sahneler': scenesUsed.join(', '),
        'Perde / Sahne Bilgisi': perdeInfo,
        'Kullanım Notu / Gerekçe': item.aciklama || ''
      };
    });

    if (format === 'xlsx') {
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Dekor ve Aksesuar Listesi");
      XLSX.writeFile(workbook, `${project.name}_Dekor_Aksesuar_Listesi.xlsx`);
      addLog('info', `Aksesuar listesi Excel (.xlsx) olarak başarıyla indirildi.`);
    } else {
      const headers = ['Öğe/Aksesuar Adı', 'Durum', 'Kullanıldığı Sahneler', 'Perde / Sahne Bilgisi', 'Kullanım Notu / Gerekçe'];
      const csvContent = [
        headers.join(','),
        ...exportData.map(row => headers.map(h => {
          let val = row[h as keyof typeof row] || '';
          if (val.includes(',') || val.includes('"') || val.includes('\n')) {
            val = `"${val.replace(/"/g, '""')}"`;
          }
          return val;
        }).join(','))
      ].join('\r\n');

      const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `${project.name}_Dekor_Aksesuar_Listesi.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      addLog('info', `Aksesuar listesi CSV olarak başarıyla indirildi.`);
    }
  };

  // Helper selectors
  const activeSceneObj = project.scenes?.find(s => s.id === selectedSceneId);
  const activeSceneName = activeSceneObj?.name || '';

  // Get filtered elements for rendering the tables of the SELECTED scene
  const tableMekanlar = tempData.mekanlar || project.analysis?.mekanlar || [];
  
  const tableGecisler = tempData.gecisler || 
    (project.analysis?.gecisler || []).filter(g => g.sahneNo === activeSceneName);

  const tableOlaylar = tempData.olaylar || 
    (project.analysis?.olaylar || []).filter(o => o.sahneNo === activeSceneName);

  const tableAksesuarlar = tempData.aksesuarlar || 
    (project.analysis?.aksesuarlar || []).filter(a => a.kullanildigiSahneler?.includes(activeSceneName));

  // Calculating reused props (Tekrar Kullanılan Öğeler)
  const allProps = project.analysis?.aksesuarlar || [];
  const reusedProps = allProps.filter(a => a.kullanildigiSahneler && a.kullanildigiSahneler.length > 1);

  const handleAddMekan = () => {
    const defaultMekan: Mekan = {
      id: Math.random().toString(36).substring(2, 9),
      ad: 'Yeni Mekan',
      tip: 'iç',
      donem: '1935',
      atmosfer: 'Yeni mekan atmosfer açıklaması.'
    };
    const currentMekanlar = project.analysis?.mekanlar || [];
    const updated = [...currentMekanlar, defaultMekan];
    
    onUpdateProject({
      ...project,
      analysis: {
        ...(project.analysis || {}),
        mekanlar: updated,
        gecisler: project.analysis?.gecisler || [],
        olaylar: project.analysis?.olaylar || [],
        aksesuarlar: project.analysis?.aksesuarlar || []
      }
    });
    addLog('info', `Yeni mekan eklendi: "Yeni Mekan"`);
  };

  const handleUpdateMekan = (id: string, field: keyof Mekan, value: any) => {
    const currentMekanlar = project.analysis?.mekanlar || [];
    const updated = currentMekanlar.map(m => m.id === id ? { ...m, [field]: value } : m);
    onUpdateProject({
      ...project,
      analysis: {
        ...(project.analysis || {}),
        mekanlar: updated,
        gecisler: project.analysis?.gecisler || [],
        olaylar: project.analysis?.olaylar || [],
        aksesuarlar: project.analysis?.aksesuarlar || []
      }
    });
  };

  const handleDeleteMekan = (id: string) => {
    const currentMekanlar = project.analysis?.mekanlar || [];
    const updated = currentMekanlar.filter(m => m.id !== id);
    onUpdateProject({
      ...project,
      analysis: {
        ...(project.analysis || {}),
        mekanlar: updated,
        gecisler: project.analysis?.gecisler || [],
        olaylar: project.analysis?.olaylar || [],
        aksesuarlar: project.analysis?.aksesuarlar || []
      }
    });
    addLog('info', `Mekan silindi.`);
  };

  const handleAddGecis = () => {
    const defaultGecis: Gecis = {
      id: Math.random().toString(36).substring(2, 9),
      sahneNo: project.scenes?.[0]?.name || 'SAHNE 1',
      mekanAd: project.analysis?.mekanlar?.[0]?.ad || 'Yeni Mekan',
      not: 'Yeni geçiş detayı.'
    };
    const currentGecisler = project.analysis?.gecisler || [];
    const updated = [...currentGecisler, defaultGecis];
    onUpdateProject({
      ...project,
      analysis: {
        ...(project.analysis || {}),
        mekanlar: project.analysis?.mekanlar || [],
        gecisler: updated,
        olaylar: project.analysis?.olaylar || [],
        aksesuarlar: project.analysis?.aksesuarlar || []
      }
    });
    addLog('info', `Yeni geçiş noktası eklendi.`);
  };

  const handleUpdateGecis = (id: string, field: keyof Gecis, value: any) => {
    const currentGecisler = project.analysis?.gecisler || [];
    const updated = currentGecisler.map(g => g.id === id ? { ...g, [field]: value } : g);
    onUpdateProject({
      ...project,
      analysis: {
        ...(project.analysis || {}),
        mekanlar: project.analysis?.mekanlar || [],
        gecisler: updated,
        olaylar: project.analysis?.olaylar || [],
        aksesuarlar: project.analysis?.aksesuarlar || []
      }
    });
  };

  const handleDeleteGecis = (id: string) => {
    const currentGecisler = project.analysis?.gecisler || [];
    const updated = currentGecisler.filter(g => g.id !== id);
    onUpdateProject({
      ...project,
      analysis: {
        ...(project.analysis || {}),
        mekanlar: project.analysis?.mekanlar || [],
        gecisler: updated,
        olaylar: project.analysis?.olaylar || [],
        aksesuarlar: project.analysis?.aksesuarlar || []
      }
    });
    addLog('info', `Geçiş noktası silindi.`);
  };

  // Helper lists filtered by active Perde tab
  const activePerdeScenes = visibleScenes.map(s => s.name.toLowerCase());
  
  const currentPerdeMekanlar = project.analysis?.mekanlar || [];

  const currentPerdeGecisler = (project.analysis?.gecisler || []).filter(g => 
    activePerdeScenes.includes(g.sahneNo.toLowerCase())
  );

  const renderSceneTableCorrectionBox = (scene: any, tableType: 'gecisler' | 'olaylar' | 'aksesuarlar') => {
    const isPendingConfirm = tempData[tableType] !== undefined && correctingSceneId === scene.id;
    const isCorrecting = correctingTable[tableType] && correctingSceneId === scene.id;
    const currentInstruction = tableType === 'aksesuarlar' 
      ? (aksesuarCorrections[scene.id] || '') 
      : corrections[tableType];

    return (
      <div className="space-y-2 bg-[#0d0e10] p-2.5 rounded border border-[#1f2125]">
        <span className="text-[9px] font-bold uppercase text-zinc-500 font-mono tracking-wider block">
          {tableType === 'gecisler' ? 'Geçişleri' : tableType === 'olaylar' ? 'Hareketleri' : 'Aksesuarları'} Düzenle (Yapay Zeka)
        </span>

        {isPendingConfirm ? (
          <div className="space-y-2">
            <p className="text-[11px] text-zinc-400">
              Yapay zeka güncellemeyi hesapladı. Tablodaki renkli değişiklikleri kontrol edin.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => handleConfirmCorrection(tableType, scene.id)}
                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold uppercase rounded transition-colors flex items-center gap-1"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                Onayla
              </button>
              <button
                onClick={() => handleCancelCorrection(tableType, scene.id)}
                className="px-2.5 py-1 bg-red-900 hover:bg-red-950 text-red-200 text-[10px] font-bold uppercase rounded transition-colors flex items-center gap-1"
              >
                <X className="w-3.5 h-3.5" />
                İptal Et
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <textarea
              value={currentInstruction}
              onChange={(e) => {
                const val = e.target.value;
                if (tableType === 'aksesuarlar') {
                  setAksesuarCorrections(prev => ({ ...prev, [scene.id]: val }));
                } else {
                  setCorrections(prev => ({ ...prev, [tableType]: val }));
                }
              }}
              placeholder={`Örn: "${tableType === 'gecisler' ? 'Bu sahnenin mekanını kütüphane yap' : tableType === 'olaylar' ? 'Masa devrilme olayını ve arbedeyi ekle' : 'Masa üstüne gümüş çatal bıçak takımı ve boş kadehler ekle'}"`}
              className="flex-1 bg-[#131517] border border-[#1f2125] focus:border-red-600 text-[11px] text-zinc-300 rounded p-1.5 outline-none font-mono h-9 resize-none leading-tight"
            />
            <button
              onClick={() => handleApplyCorrection(tableType, scene.id)}
              disabled={isCorrecting || !currentInstruction.trim()}
              className="px-3 py-1 bg-[#25272c] hover:bg-[#1f2125] border border-[#1f2125] text-red-500 rounded text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 disabled:opacity-50 transition-colors shrink-0"
            >
              {isCorrecting ? (
                <div className="w-3.5 h-3.5 border-2 border-red-500 border-t-transparent animate-spin rounded-full"></div>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Uygula</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      
      {fileLoading && (
        <div className="bg-[#131517] border border-red-900/30 rounded-lg p-8 shadow-xl text-center space-y-6 max-w-2xl mx-auto my-12 animate-fade-in">
          <div className="relative w-16 h-16 mx-auto flex items-center justify-center">
            <div className="absolute inset-0 rounded-full border-4 border-zinc-800 border-t-red-600 animate-spin"></div>
            <div className="absolute inset-2 rounded-full border-4 border-zinc-800 border-b-red-500 animate-pulse"></div>
            <Sparkles className="w-6 h-6 text-red-500 animate-pulse" />
          </div>
          
          <div className="space-y-2">
            <h3 className="text-lg font-bold text-zinc-100 tracking-wide">Yapay Zeka Tiyatro Metni Analizi Çalışıyor</h3>
            <p className="text-xs text-zinc-400 max-w-md mx-auto leading-relaxed">
              Tiyatro metniniz yapay zeka tarafından taranmaktadır. Süreyi yarı yarıya düşürmek için <span className="text-red-500 font-bold">Mekan/Olay Tespiti</span> ve <span className="text-red-500 font-bold">Aksesuar Tespiti</span> eşzamanlı (paralel) olarak yürütülmektedir.
            </p>
          </div>

          <div className="bg-[#16171a] border border-[#1f2125] rounded-lg p-5 text-left space-y-4 max-w-md mx-auto">
            {/* Step 1: Text extraction */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold font-mono ${
                  analysisProgress.extraction === 'completed' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' :
                  analysisProgress.extraction === 'running' ? 'bg-red-950 text-red-400 border border-red-800 animate-pulse' :
                  'bg-[#25272c] text-zinc-500 border border-[#1f2125]'
                }`}>
                  {analysisProgress.extraction === 'completed' ? '✓' : '1'}
                </div>
                <span className={`text-xs ${analysisProgress.extraction === 'running' ? 'text-zinc-200 font-semibold' : 'text-zinc-400'}`}>
                  Metin Çıkarma ve Ön Hazırlık
                </span>
              </div>
              <span className="text-[10px] font-mono text-zinc-500 uppercase">
                {analysisProgress.extraction === 'completed' ? 'Tamamlandı' :
                 analysisProgress.extraction === 'running' ? 'Devam ediyor...' : 'Bekliyor'}
              </span>
            </div>

            {/* Step 2: Mekan/Olay */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold font-mono ${
                  analysisProgress.mekanOlay === 'completed' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' :
                  analysisProgress.mekanOlay === 'running' ? 'bg-red-950 text-red-400 border border-red-800 animate-pulse' :
                  analysisProgress.mekanOlay === 'error' ? 'bg-red-950 text-red-500 border border-red-800' :
                  'bg-[#25272c] text-zinc-500 border border-[#1f2125]'
                }`}>
                  {analysisProgress.mekanOlay === 'completed' ? '✓' : 
                   analysisProgress.mekanOlay === 'error' ? '✗' : '2'}
                </div>
                <span className={`text-xs ${analysisProgress.mekanOlay === 'running' ? 'text-zinc-200 font-semibold' : 'text-zinc-400'}`}>
                  Mekan, Geçiş ve Olay Tespiti (Paralel)
                </span>
              </div>
              <span className={`text-[10px] font-mono uppercase ${
                analysisProgress.mekanOlay === 'completed' ? 'text-emerald-500' :
                analysisProgress.mekanOlay === 'running' ? 'text-red-500 animate-pulse' :
                analysisProgress.mekanOlay === 'error' ? 'text-red-500' : 'text-zinc-500'
              }`}>
                {analysisProgress.mekanOlay === 'completed' ? 'Tamamlandı' :
                 analysisProgress.mekanOlay === 'running' ? 'Analiz ediliyor...' :
                 analysisProgress.mekanOlay === 'error' ? 'Hata Oluştu' : 'Bekliyor'}
              </span>
            </div>

            {/* Step 3: Aksesuarlar */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold font-mono ${
                  analysisProgress.aksesuar === 'completed' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' :
                  analysisProgress.aksesuar === 'running' ? 'bg-red-950 text-red-400 border border-red-800 animate-pulse' :
                  analysisProgress.aksesuar === 'error' ? 'bg-red-950 text-red-500 border border-red-800' :
                  'bg-[#25272c] text-zinc-500 border border-[#1f2125]'
                }`}>
                  {analysisProgress.aksesuar === 'completed' ? '✓' : 
                   analysisProgress.aksesuar === 'error' ? '✗' : '3'}
                </div>
                <span className={`text-xs ${analysisProgress.aksesuar === 'running' ? 'text-zinc-200 font-semibold' : 'text-zinc-400'}`}>
                  Dekor ve Aksesuar Tespiti (Paralel)
                </span>
              </div>
              <span className={`text-[10px] font-mono uppercase ${
                analysisProgress.aksesuar === 'completed' ? 'text-emerald-500' :
                analysisProgress.aksesuar === 'running' ? 'text-red-500 animate-pulse' :
                analysisProgress.aksesuar === 'error' ? 'text-red-500' : 'text-zinc-500'
              }`}>
                {analysisProgress.aksesuar === 'completed' ? 'Tamamlandı' :
                 analysisProgress.aksesuar === 'running' ? 'Analiz ediliyor...' :
                 analysisProgress.aksesuar === 'error' ? 'Hata Oluştu' : 'Bekliyor'}
              </span>
            </div>
          </div>

          <p className="text-[10px] text-zinc-500 max-w-sm mx-auto leading-relaxed italic">
            "Süreç arka planda asenkron olarak güvenle yürütülmektedir. Sayfayı kapatmamanızı tavsiye ederiz."
          </p>
        </div>
      )}

      {!fileLoading && (
        <>
      
      {/* COLLAPSIBLE SCRIPT METİN YÖNETİMİ & YAPAY ZEKA ANALİZİ */}
      <div className="bg-[#131517] border border-[#1f2125] rounded-lg p-4 shadow-sm">
        <button 
          onClick={() => setShowScriptManagement(!showScriptManagement)}
          className="w-full flex items-center justify-between text-left text-xs uppercase tracking-widest text-red-500 font-bold"
        >
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-red-500" />
            <span>SAHNE METİN YÖNETİMİ & YAPAY ZEKA ANALİZ PANELİ</span>
          </div>
          <span className="text-[10px] font-mono text-zinc-500 hover:text-red-500 transition-colors">
            {showScriptManagement ? '[ GİZLE ]' : '[ GÖSTER / METİN ANALİZİ YAP ]'}
          </span>
        </button>

        {showScriptManagement && (
          <div className="mt-4 pt-4 border-t border-[#1f2125] space-y-6 animate-fade-in">
            {/* API Key Panel embedded inside */}
            <div className="bg-[#16171a] border border-[#1f2125] p-3 rounded-lg space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase text-zinc-400 font-mono tracking-wider">YAPAY ZEKA SERVİS AYARLARI (Anthropic Claude)</span>
                <button 
                  onClick={() => setShowApiKeyPanel(!showApiKeyPanel)} 
                  className="text-[10px] text-red-500 font-bold hover:underline"
                >
                  {showApiKeyPanel ? 'Gizle' : 'Düzenle'}
                </button>
              </div>

              {showApiKeyPanel && (
                <div className="space-y-3 text-xs pt-2 border-t border-[#1f2125]">
                  <p className="text-zinc-400 leading-relaxed">
                    Metin Analizi ve Aksesuar Tespiti sekmelerindeki backend işlevi artık daha gelişmiş sonuçlar için <strong className="text-red-500">Anthropic Claude (claude-sonnet-4-6)</strong> API'sini kullanıyor.
                  </p>
                  <div className="flex flex-col md:flex-row md:items-center gap-3">
                    <div className="flex-1 space-y-1">
                      <label className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500 font-mono">
                        ANTHROPIC_API_KEY Girin
                      </label>
                      <input
                        type="password"
                        placeholder="sk-ant-..."
                        value={anthropicApiKey}
                        onChange={(e) => {
                          setAnthropicApiKey(e.target.value);
                          setIsKeySaved(false);
                        }}
                        className="w-full bg-[#0d0e10] text-xs font-mono text-zinc-300 rounded border border-[#1f2125] px-3 py-2 outline-none focus:border-red-600 placeholder:opacity-20"
                      />
                    </div>
                    <div className="flex md:items-end h-full pt-4 md:pt-0">
                      <button
                        onClick={() => {
                          localStorage.setItem('ANTHROPIC_API_KEY', anthropicApiKey);
                          setIsKeySaved(true);
                          addLog('info', 'Anthropic API Anahtarı tarayıcı hafızasına kaydedildi.');
                          setTimeout(() => setIsKeySaved(false), 3000);
                        }}
                        className="px-4 py-2 bg-[#25272c] hover:bg-zinc-800 border border-[#1f2125] text-red-500 rounded font-bold uppercase tracking-wider text-[11px] transition-all"
                      >
                        {isKeySaved ? 'KAYDEDİLDİ!' : 'TARAYICIYA KAYDET'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {uploadError && (
              <div className="bg-red-950/20 border border-red-900/40 text-red-400 p-4 rounded-lg flex items-start gap-3 mb-4">
                <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <div className="text-xs space-y-1">
                  <p className="font-bold text-red-500">Analiz / Yükleme Hatası</p>
                  <p>{uploadError}</p>
                </div>
              </div>
            )}

            {/* Workspace Steps */}
            {isDetectingBeats ? (
              <div className="bg-[#16171a] border border-[#1f2125] rounded-lg p-12 text-center space-y-4 w-full">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto"></div>
                <h3 className="text-zinc-200 font-bold text-sm tracking-wide">Düzyazı Analiz Ediliyor</h3>
                <p className="text-xs text-zinc-500 max-w-sm mx-auto leading-relaxed">
                  Metniniz düzyazı (roman/hikaye) olarak tespit edildi. Yapay zeka ile doğal anlatı birimleri (narrative beats) çıkartılıyor... Lütfen bekleyin.
                </p>
              </div>
            ) : !project.scriptText ? (
              <div className="space-y-4 w-full">
                <div 
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className="border border-dashed border-[#1f2125] bg-[#16171a]/30 hover:bg-[#16171a]/60 hover:border-red-600/40 rounded-lg p-12 text-center cursor-pointer transition-all group shadow-sm w-full"
                >
                  <input 
                    type="file" 
                    ref={fileInputRef}
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        handleFileUpload(e.target.files[0]);
                      }
                    }}
                    accept=".docx,.pdf,.txt"
                    className="hidden"
                  />
                  <UploadCloud className="w-10 h-10 text-zinc-600 group-hover:text-red-500 mx-auto mb-3 transition-colors" />
                  <h3 className="text-zinc-200 font-bold text-sm tracking-wide">Oyun Metnini Yükleyin</h3>
                  <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto leading-relaxed">
                    Mükemmel ayrıştırma için <strong className="text-red-500">PDF (.pdf)</strong>, <strong className="text-red-500">Word (.docx)</strong> veya düz metin (.txt) dosyası seçin.
                  </p>
                </div>
              </div>
            ) : project.isProse && (!project.scenes || project.scenes.length === 0) ? (
              <div className="bg-[#16171a] border border-[#1f2125] rounded-lg p-6 space-y-6 w-full shadow-lg">
                <div className="border-b border-[#1f2125] pb-4">
                  <h2 className="text-md font-bold text-white tracking-wide uppercase flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-red-500" />
                    Düzyazı Anlatı Birimlerini Onayla ve Düzenle
                  </h2>
                  <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                    Yapay zeka bu metinde fiziksel sahne başlıkları bulunmadığı için dramatik akışına göre doğal anlatı birimlerini (narrative beats) tespit etti. Sahneleri oluşturmak için bu bölünmeyi onaylayabilir veya istediğiniz gibi düzenleyebilirsiniz. (En az 5, en fazla 15 birim önerilir).
                  </p>
                </div>

                {/* Edit list of narrative beats */}
                <div className="space-y-4">
                  {(project.narrativeBeats || []).map((beat, idx) => {
                    const isEditing = editingBeatIdx === idx;
                    return (
                      <div 
                        key={idx} 
                        className="p-4 bg-[#0d0e10] rounded-lg border border-[#1f2125] flex flex-col md:flex-row md:items-start justify-between gap-4 transition-all hover:border-zinc-800"
                      >
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono font-bold text-red-500 bg-red-950/20 border border-red-900/40 px-2 py-0.5 rounded">
                              Birim #{idx + 1} ({beat.startPercentage}% - {beat.endPercentage}%)
                            </span>
                          </div>
                          
                          {isEditing ? (
                            <div className="space-y-2 mt-2">
                              <input
                                type="text"
                                value={editingBeatName}
                                onChange={(e) => setEditingBeatName(e.target.value)}
                                className="w-full bg-[#16171a] text-xs text-zinc-200 rounded border border-[#1f2125] px-2 py-1 outline-none focus:border-red-600 font-bold"
                                placeholder="Birim Başlığı"
                              />
                              <textarea
                                value={editingBeatDesc}
                                onChange={(e) => setEditingBeatDesc(e.target.value)}
                                className="w-full h-16 bg-[#16171a] text-xs text-zinc-400 rounded border border-[#1f2125] px-2 py-1 outline-none focus:border-red-600 resize-none"
                                placeholder="Birim Açıklaması"
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={() => {
                                    handleUpdateProseBeat(idx, editingBeatName, editingBeatDesc);
                                    setEditingBeatIdx(null);
                                  }}
                                  className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-[10px] font-bold uppercase rounded transition-colors"
                                >
                                  Kaydet
                                </button>
                                <button
                                  onClick={() => setEditingBeatIdx(null)}
                                  className="px-3 py-1 bg-[#25272c] hover:bg-zinc-800 text-zinc-300 text-[10px] font-bold uppercase rounded border border-[#1f2125] transition-colors"
                                >
                                  İptal
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <h4 className="text-xs font-bold text-zinc-200">{beat.name}</h4>
                              <p className="text-[11px] text-zinc-500 leading-normal">{beat.description}</p>
                            </div>
                          )}
                        </div>

                        {!isEditing && (
                          <div className="flex items-center gap-1.5 self-end md:self-start">
                            <button
                              onClick={() => {
                                setEditingBeatIdx(idx);
                                setEditingBeatName(beat.name);
                                setEditingBeatDesc(beat.description);
                              }}
                              className="p-1.5 bg-[#16171a] hover:bg-zinc-800 text-zinc-400 hover:text-white rounded border border-[#1f2125] transition-colors"
                              title="Düzenle"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteProseBeat(idx)}
                              className="p-1.5 bg-[#16171a] hover:bg-red-950/40 text-zinc-400 hover:text-red-400 rounded border border-[#1f2125] transition-colors"
                              title="Sil"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Add new narrative beat */}
                <div className="p-4 bg-[#131517] rounded-lg border border-[#1f2125] space-y-3">
                  <span className="text-[10px] font-bold uppercase font-mono text-zinc-400 block border-b border-[#1f2125] pb-1.5">Yeni Anlatı Birimi Ekle</span>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <input
                      type="text"
                      placeholder="Birim Adı (Örn: Eve Dönüş)"
                      value={newBeatName}
                      onChange={(e) => setNewBeatName(e.target.value)}
                      className="w-full bg-[#0d0e10] text-xs text-zinc-300 rounded border border-[#1f2125] px-3 py-2 outline-none focus:border-red-600 font-mono"
                    />
                    <input
                      type="text"
                      placeholder="Birim Açıklaması / Dramatik İçerik"
                      value={newBeatDesc}
                      onChange={(e) => setNewBeatDesc(e.target.value)}
                      className="w-full bg-[#0d0e10] text-xs text-zinc-300 rounded border border-[#1f2125] px-3 py-2 outline-none focus:border-red-600 font-mono"
                    />
                  </div>
                  <button
                    onClick={handleAddProseBeat}
                    className="w-full py-1.5 bg-[#25272c] hover:bg-zinc-800 text-zinc-300 font-bold uppercase text-[10px] rounded border border-[#1f2125] transition-colors"
                  >
                    Yeni Anlatı Birimi Ekle (Bölmeler Yeniden Hesaplanır)
                  </button>
                </div>

                {/* Bottom actions */}
                <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-[#1f2125]">
                  <button
                    onClick={handleClearScript}
                    className="px-4 py-2 bg-[#25272c] hover:bg-zinc-800 border border-[#1f2125] text-zinc-400 rounded font-bold uppercase text-[11px] transition-colors"
                  >
                    Metni Temizle / Sıfırla
                  </button>
                  <button
                    onClick={handleConfirmProseBeats}
                    disabled={fileLoading || (project.narrativeBeats || []).length === 0}
                    className="flex-1 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold rounded text-[11px] uppercase tracking-wider transition-colors flex items-center justify-center gap-2"
                  >
                    {fileLoading ? (
                      <>
                        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
                        <span>Bütünsel Analiz Yapılıyor...</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        <span>Bölünmeyi Onayla ve Bütünsel Analizi Başlat</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              /* Split scene workspace */
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                
                {/* Scenes side selector list */}
                <div className="lg:col-span-1 space-y-4">
                  <div className="bg-[#16171a] border border-[#1f2125] rounded-lg p-4 space-y-4">
                    <div className="flex items-center justify-between border-b border-[#1f2125] pb-2">
                      <span className="text-[11px] font-bold uppercase text-white font-mono">Sahneler ({project.scenes.length})</span>
                      <button
                        onClick={handleClearScript}
                        className="text-[9px] font-mono uppercase text-zinc-500 hover:text-red-400 transition-colors"
                      >
                        Sıfırla
                      </button>
                    </div>

                    <button
                      onClick={handleAnalyzeAll}
                      className="w-full py-2 bg-red-950/10 border border-red-900/30 hover:bg-red-950/20 text-red-500 text-xs font-bold rounded flex items-center justify-center gap-1.5 transition-colors"
                      id="btn-analyze-all"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Tüm Sahneleri Sırayla Analiz Et
                    </button>

                    <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                      {/* Perde 1 group */}
                      {(() => {
                        const perde1 = (project.scenes || []).filter((sc, idx) => {
                          const nameLower = (sc.name || '').toLowerCase();
                          if (nameLower.includes('2. perde') || nameLower.includes('perde 2') || nameLower.includes('perde ii') || nameLower.includes('ikinci perde') || nameLower.includes('2.perde')) return false;
                          if (nameLower.includes('1. perde') || nameLower.includes('perde 1') || nameLower.includes('perde i') || nameLower.includes('birinci perde') || nameLower.includes('1.perde')) return true;
                          return idx < (project.scenes?.length || 0) / 2;
                        });

                        const perde2 = (project.scenes || []).filter((sc, idx) => {
                          const nameLower = (sc.name || '').toLowerCase();
                          if (nameLower.includes('2. perde') || nameLower.includes('perde 2') || nameLower.includes('perde ii') || nameLower.includes('ikinci perde') || nameLower.includes('2.perde')) return true;
                          if (nameLower.includes('1. perde') || nameLower.includes('perde 1') || nameLower.includes('perde i') || nameLower.includes('birinci perde') || nameLower.includes('1.perde')) return false;
                          return idx >= (project.scenes?.length || 0) / 2;
                        });

                        const renderGroupItem = (sc: Scene) => {
                          const isSelected = sc.id === selectedSceneId;
                          const isSceneAnalyzed = project.analysis?.debug?.[sc.id] || false;
                          
                          return (
                            <div
                              key={sc.id}
                              className={`group/item w-full p-2 rounded transition-all flex flex-col gap-1 border ${
                                isSelected 
                                  ? 'bg-[#0d0e10] border-red-800 text-red-500 shadow-sm'
                                  : 'bg-[#131517]/50 border-transparent text-zinc-400 hover:bg-[#131517] hover:text-zinc-200'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-1.5 w-full">
                                <button
                                  onClick={() => {
                                    setSelectedSceneId(sc.id);
                                    setCorrections({ mekanlar: '', gecisler: '', olaylar: '', aksesuarlar: '' });
                                    setTempData({});
                                  }}
                                  className="text-left flex-1 truncate"
                                >
                                  <span className="text-xs font-bold text-zinc-300 mr-1.5 block truncate">
                                    {sc.name}
                                  </span>
                                  <span className="text-[9px] text-zinc-500 truncate block font-mono">{sc.content.substring(0, 30)}...</span>
                                </button>

                                <div className="flex items-center gap-1.5 shrink-0">
                                  {isSceneAnalyzed ? (
                                    <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0" title="Analiz edilmiş" />
                                  ) : (
                                    <div className="w-2.5 h-2.5 rounded-full border border-zinc-700 shrink-0" title="Analiz edilmemiş"></div>
                                  )}

                                  {!isSceneAnalyzed && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleAnalyzeScene(sc);
                                      }}
                                      disabled={analyzingId !== null}
                                      className="hidden group-hover/item:flex items-center gap-0.5 px-1 py-0.5 bg-red-950 border border-red-900 hover:bg-red-900 text-red-200 text-[8px] font-bold uppercase rounded font-mono transition-colors disabled:opacity-50"
                                    >
                                      <Sparkles className="w-2.5 h-2.5" />
                                      <span>Analiz</span>
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        };

                        return (
                          <div className="space-y-3">
                            <div className="space-y-1">
                              <button
                                onClick={() => setExpandedScenes(prev => ({ ...prev, 'Perde 1': !prev['Perde 1'] }))}
                                className="w-full flex items-center justify-between p-1.5 bg-[#131517] border border-[#1f2125] rounded text-[10px] font-bold text-zinc-300 font-mono uppercase tracking-wider hover:bg-[#1a1b20] transition-colors"
                              >
                                <span className="flex items-center gap-1.5">
                                  <Layers className="w-3.5 h-3.5 text-red-500" />
                                  1. Perde ({perde1.length})
                                </span>
                                {expandedScenes['Perde 1'] ? (
                                  <ChevronDown className="w-3 h-3 text-zinc-500" />
                                ) : (
                                  <ChevronUp className="w-3 h-3 text-zinc-500" />
                                )}
                              </button>
                              
                              {!expandedScenes['Perde 1'] && (
                                <div className="space-y-1 pl-1 pt-1">
                                  {perde1.map(renderGroupItem)}
                                </div>
                              )}
                            </div>

                            <div className="space-y-1">
                              <button
                                onClick={() => setExpandedScenes(prev => ({ ...prev, 'Perde 2': !prev['Perde 2'] }))}
                                className="w-full flex items-center justify-between p-1.5 bg-[#131517] border border-[#1f2125] rounded text-[10px] font-bold text-zinc-300 font-mono uppercase tracking-wider hover:bg-[#1a1b20] transition-colors"
                              >
                                <span className="flex items-center gap-1.5">
                                  <Layers className="w-3.5 h-3.5 text-red-500" />
                                  2. Perde ({perde2.length})
                                </span>
                                {expandedScenes['Perde 2'] ? (
                                  <ChevronDown className="w-3 h-3 text-zinc-500" />
                                ) : (
                                  <ChevronUp className="w-3 h-3 text-zinc-500" />
                                )}
                              </button>
                              
                              {!expandedScenes['Perde 2'] && (
                                <div className="space-y-1 pl-1 pt-1">
                                  {perde2.map(renderGroupItem)}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Scene Boundaries editor */}
                  <div className="bg-[#16171a] border border-[#1f2125] rounded-lg p-4 space-y-3">
                    <span className="text-[10px] font-bold uppercase font-mono text-zinc-400 block border-b border-[#1f2125] pb-1.5">Sahne Sınırlarını Düzenle</span>
                    <p className="text-[10px] text-zinc-500 leading-normal">
                      Metindeki otomatik sahneleri değiştirebilir veya ekleyebilirsiniz.
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="SAHNE ADI (Örn: SAHNE 5)"
                        value={newBoundaryName}
                        onChange={(e) => setNewBoundaryName(e.target.value)}
                        className="flex-1 bg-[#0d0e10] text-xs text-zinc-300 rounded border border-[#1f2125] px-2 py-1 outline-none focus:border-red-600 font-mono"
                      />
                      <button
                        onClick={handleAddBoundary}
                        className="px-2.5 py-1 bg-[#25272c] hover:bg-zinc-800 text-zinc-300 font-bold uppercase text-[10px] rounded border border-[#1f2125] transition-colors"
                      >
                        Ekle
                      </button>
                    </div>

                    <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                      {boundaries.map((b, idx) => (
                        <div key={idx} className="bg-[#0d0e10] p-1.5 rounded border border-[#1f2125] flex items-center justify-between gap-2">
                          <span className="text-[9px] text-zinc-600 font-mono font-bold">#{idx + 1}</span>
                          <input
                            type="text"
                            value={b.name}
                            onChange={(e) => handleBoundaryNameChange(idx, e.target.value)}
                            className="flex-1 bg-transparent text-xs text-white font-bold outline-none border border-transparent focus:border-[#1f2125] rounded px-1"
                          />
                          <button
                            onClick={() => handleDeleteBoundary(idx)}
                            className="text-zinc-600 hover:text-red-400"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>

                    <button
                      onClick={() => {
                        if (confirm('Sahneleri bu sınırlarla yeniden bölmek istiyor musunuz? Mevcut analizleriniz silinecektir.')) {
                          handleConfirmBoundaries();
                        }
                      }}
                      className="w-full py-1.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded text-[10px] uppercase tracking-wider transition-colors"
                    >
                      Uygula ve Yeniden Böl
                    </button>
                  </div>
                </div>

                {/* Selected scene detailed analysis */}
                <div className="lg:col-span-3 space-y-4">
                  {selectedSceneId ? (
                    (() => {
                      const scene = project.scenes.find(s => s.id === selectedSceneId)!;
                      const isSceneAnalyzed = project.analysis?.debug?.[scene.id];
                      const isSceneCorrecting = correctingSceneId === scene.id;
                      
                      const rawAccessories = isSceneCorrecting && tempData.aksesuarlar
                        ? tempData.aksesuarlar
                        : (project.analysis?.aksesuarlar || []);
                      const sceneAccessories = rawAccessories.filter(
                        a => a.kullanildigiSahneler?.includes(scene.name)
                      );

                      const sceneGecisler = (tempData.gecisler || project.analysis?.gecisler || []).filter(
                        g => g.sahneNo === scene.name
                      );

                      const sceneOlaylar = (tempData.olaylar || project.analysis?.olaylar || []).filter(
                        o => o.sahneNo === scene.name
                      );

                      return (
                        <div className="bg-[#16171a] border border-[#1f2125] rounded-lg p-5 space-y-4 shadow-sm">
                          <div className="flex items-center justify-between border-b border-[#1f2125] pb-2.5">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-white uppercase">{scene.name} Detay Analizi</span>
                              <span className="text-[9px] font-mono text-zinc-500 bg-[#0d0e10] border border-[#1f2125] px-2 py-0.5 rounded">
                                {scene.content.length} Karakter
                              </span>
                            </div>

                            {!isSceneAnalyzed && (
                              <button
                                onClick={() => handleAnalyzeScene(scene)}
                                disabled={analyzingId !== null}
                                className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-[10px] font-bold uppercase rounded flex items-center gap-1.5 transition-colors disabled:opacity-50"
                              >
                                {analyzingId === scene.id ? (
                                  <>
                                    <div className="w-3 h-3 border-2 border-white border-t-transparent animate-spin rounded-full"></div>
                                    <span>Analiz Ediliyor...</span>
                                  </>
                                ) : (
                                  <>
                                    <Sparkles className="w-3 h-3" />
                                    <span>Analiz Et</span>
                                  </>
                                )}
                              </button>
                            )}
                          </div>

                          <div className="bg-[#0d0e10] p-3 rounded border border-[#1f2125] space-y-1">
                            <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider block font-bold">Sahne Metin Kesiti</span>
                            <div className="text-xs text-zinc-400 font-mono leading-relaxed whitespace-pre-wrap max-h-32 overflow-y-auto pr-1">
                              {scene.content}
                            </div>
                          </div>

                          {isSceneAnalyzed ? (
                            <div className="space-y-4">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="bg-[#131517] border border-[#1f2125] p-3 rounded-lg space-y-2 flex flex-col justify-between">
                                  <div>
                                    <span className="text-[10px] font-bold font-mono uppercase text-zinc-400 block border-b border-[#1f2125] pb-1">Sahne Geçiş Detayları</span>
                                    <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1 mt-1.5">
                                      {sceneGecisler.length === 0 ? (
                                        <p className="text-xs text-zinc-500 italic">Mekan geçiş kaydı bulunmuyor.</p>
                                      ) : (
                                        sceneGecisler.map((g, gi) => {
                                          const isAdded = g.changed === 'added';
                                          const isRemoved = g.changed === 'removed';
                                          return (
                                            <div 
                                              key={g.id || gi} 
                                              className={`p-2 border rounded text-xs transition-all ${
                                                isAdded 
                                                  ? 'bg-emerald-950/20 text-emerald-300 border-emerald-800 border-l-4 border-l-emerald-500' 
                                                  : isRemoved 
                                                  ? 'bg-red-950/25 text-red-400 line-through border-red-900 border-l-4 border-l-red-500 opacity-60' 
                                                  : 'bg-[#16171a] border-[#1f2125] text-zinc-300'
                                              }`}
                                            >
                                              <div className="flex items-center justify-between">
                                                <div className="font-bold">{g.mekanAd}</div>
                                                {isAdded && <span className="text-[8px] bg-emerald-950 text-emerald-400 px-1 py-0.5 rounded uppercase font-bold font-mono">Eklendi</span>}
                                                {isRemoved && <span className="text-[8px] bg-red-950 text-red-400 px-1 py-0.5 rounded uppercase font-bold font-mono">Çıkarıldı</span>}
                                              </div>
                                              {g.not && <p className={`mt-0.5 text-[11px] leading-relaxed font-mono ${isRemoved ? 'text-red-500/70 line-through' : 'text-zinc-500'}`}>{g.not}</p>}
                                            </div>
                                          );
                                        })
                                      )}
                                    </div>
                                  </div>
                                  <div className="mt-3 border-t border-[#1f2125]/60 pt-2">
                                    {renderSceneTableCorrectionBox(scene, 'gecisler')}
                                  </div>
                                </div>

                                <div className="bg-[#131517] border border-[#1f2125] p-3 rounded-lg space-y-2 flex flex-col justify-between">
                                  <div>
                                    <span className="text-[10px] font-bold font-mono uppercase text-zinc-400 block border-b border-[#1f2125] pb-1">Sahne Üstü Hareketler</span>
                                    <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1 mt-1.5">
                                      {sceneOlaylar.length === 0 ? (
                                        <p className="text-xs text-zinc-500 italic">Aksiyon kaydı bulunmuyor.</p>
                                      ) : (
                                        sceneOlaylar.map((o, oi) => {
                                          const isAdded = o.changed === 'added';
                                          const isRemoved = o.changed === 'removed';
                                          return (
                                            <div 
                                              key={o.id || oi} 
                                              className={`p-2 border rounded text-xs space-y-1 transition-all ${
                                                isAdded 
                                                  ? 'bg-emerald-950/20 text-emerald-300 border-emerald-800 border-l-4 border-l-emerald-500' 
                                                  : isRemoved 
                                                  ? 'bg-red-950/25 text-red-400 line-through border-red-900 border-l-4 border-l-red-500 opacity-60' 
                                                  : 'bg-[#16171a] border-[#1f2125] text-zinc-300'
                                              }`}
                                            >
                                              <div className="flex items-center justify-between">
                                                <div className="font-semibold">{o.olay}</div>
                                                {isAdded && <span className="text-[8px] bg-emerald-950 text-emerald-400 px-1 py-0.5 rounded uppercase font-bold font-mono">Eklendi</span>}
                                                {isRemoved && <span className="text-[8px] bg-red-950 text-red-400 px-1 py-0.5 rounded uppercase font-bold font-mono">Çıkarıldı</span>}
                                              </div>
                                              {o.hareketPotansiyeli && (
                                                <p className={`text-[11px] leading-relaxed italic font-mono ${isRemoved ? 'text-red-500/70 line-through' : 'text-zinc-500'}`}>
                                                  Potansiyel: {o.hareketPotansiyeli}
                                                </p>
                                              )}
                                            </div>
                                          );
                                        })
                                      )}
                                    </div>
                                  </div>
                                  <div className="mt-3 border-t border-[#1f2125]/60 pt-2">
                                    {renderSceneTableCorrectionBox(scene, 'olaylar')}
                                  </div>
                                </div>
                              </div>

                              {/* Accessories list of scene */}
                              <div className="bg-[#131517] border border-[#1f2125] p-4 rounded-lg space-y-3">
                                <span className="text-[10px] font-bold font-mono uppercase text-zinc-400 block border-b border-[#1f2125] pb-1">Dekor & Aksesuarlar ({sceneAccessories.length})</span>
                                <div className="overflow-x-auto max-h-56">
                                  <table className="w-full text-left text-xs border-collapse">
                                    <thead className="bg-[#16171a] font-mono text-[9px] uppercase tracking-wider text-zinc-400 border-b border-[#1f2125]">
                                      <tr>
                                        <th className="p-2 border-b border-[#1f2125]">Öğe Adı</th>
                                        <th className="p-2 border-b border-[#1f2125]">Kategori</th>
                                        <th className="p-2 border-b border-[#1f2125]">Açıklama / Kullanım Notu</th>
                                        <th className="p-2 border-b border-[#1f2125] w-[260px]">Durum / Kaynak Kararı</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#1f2125]">
                                      {sceneAccessories.map((item) => {
                                        const isAdded = item.changed === 'added';
                                        const isRemoved = item.changed === 'removed';
                                        return (
                                          <tr 
                                            key={item.id} 
                                            className={`transition-colors ${
                                              isAdded 
                                                ? 'bg-emerald-950/20 text-emerald-300 border-l-4 border-l-emerald-500' 
                                                : isRemoved 
                                                ? 'bg-red-950/25 text-red-400 opacity-60 border-l-4 border-l-red-500' 
                                                : 'hover:bg-[#16171a]/50'
                                            }`}
                                          >
                                            <td className={`p-2 font-bold text-xs ${isRemoved ? 'line-through text-red-400/80' : 'text-white'}`}>
                                              <div className="flex items-center gap-1.5">
                                                <span>{item.ad}</span>
                                                {isAdded && <span className="text-[8px] bg-emerald-950 text-emerald-400 px-1.5 py-0.5 rounded uppercase font-bold font-mono">Eklendi</span>}
                                                {isRemoved && <span className="text-[8px] bg-red-950 text-red-400 px-1.5 py-0.5 rounded uppercase font-bold font-mono">Çıkarıldı</span>}
                                              </div>
                                            </td>
                                            <td className="p-2 font-mono text-[10px]">
                                              <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${
                                                item.kategori === 'dekor' 
                                                  ? 'bg-amber-950/30 text-amber-500 border border-amber-900/40' 
                                                  : 'bg-teal-950/30 text-teal-500 border border-teal-900/40'
                                              }`}>
                                                {item.kategori}
                                              </span>
                                            </td>
                                            <td className={`p-2 text-xs ${isRemoved ? 'line-through text-red-500/60' : 'text-zinc-400'}`}>{item.aciklama}</td>
                                            <td className="p-2">
                                              <div className="flex gap-1.5">
                                                <button
                                                  onClick={() => handleUpdateAksesuarStatus(item.id, item.status === 'Satın Alınacak' ? '' : 'Satın Alınacak')}
                                                  className={`px-2 py-1 text-[9px] font-bold uppercase rounded border transition-colors ${
                                                    item.status === 'Satın Alınacak'
                                                      ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800'
                                                      : 'bg-[#16171a] text-zinc-500 border-zinc-800 hover:text-zinc-300 hover:border-zinc-700'
                                                  }`}
                                                >
                                                  Satın Alınacak
                                                </button>
                                                <button
                                                  onClick={() => handleUpdateAksesuarStatus(item.id, item.status === 'Üretilecek' ? '' : 'Üretilecek')}
                                                  className={`px-2 py-1 text-[9px] font-bold uppercase rounded border transition-colors ${
                                                    item.status === 'Üretilecek'
                                                      ? 'bg-blue-950/40 text-blue-400 border-blue-800'
                                                      : 'bg-[#16171a] text-zinc-500 border-zinc-800 hover:text-zinc-300 hover:border-zinc-700'
                                                  }`}
                                                >
                                                  Atölyede Üretilecek
                                                </button>
                                              </div>
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                                <div className="mt-3 border-t border-[#1f2125]/60 pt-2">
                                  {renderSceneTableCorrectionBox(scene, 'aksesuarlar')}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="py-8 text-center bg-[#0d0e10] border border-[#1f2125] rounded-lg text-zinc-500 italic text-xs">
                              Bu sahne henüz analiz edilmedi. Analizi başlatmak için yukarıdaki "Analiz Et" butonuna tıklayabilirsiniz.
                            </div>
                          )}
                        </div>
                      );
                    })()
                  ) : (
                    <div className="h-full flex items-center justify-center p-12 bg-[#16171a] border border-[#1f2125] rounded-lg text-zinc-500 italic text-xs">
                      Detaylarını ve AI analiz eylemlerini görmek için sol listeden bir sahne seçin.
                    </div>
                  )}
                </div>

              </div>
            )}
          </div>
        )}
      </div>

      {/* DEBUG PANEL */}
      <div className="bg-[#131517] border border-[#1f2125] rounded-lg p-4 shadow-sm space-y-2">
        <button
          onClick={() => setShowDebugRaw(!showDebugRaw)}
          className="w-full flex items-center justify-between text-left text-xs font-mono font-bold uppercase tracking-wider text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <Terminal className="w-4 h-4 text-zinc-500" />
            Debug: Ham Çıktı ve API Yanıtları
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] bg-red-950/20 text-red-400 border border-red-900/40 px-1.5 py-0.5 rounded font-bold font-mono">GELİŞMİŞ VERİ TAKİBİ</span>
            {showDebugRaw ? <ChevronUp className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />}
          </div>
        </button>

        {showDebugRaw && (
          <div className="space-y-4 pt-3 border-t border-[#1f2125] text-xs">
            <p className="text-zinc-400 leading-relaxed font-sans">
              Bu panel, Claude API'sinden ve veri birleştirme adımlarından gelen yapılandırılmış JSON verilerini canlı olarak izlemenizi sağlar.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-[#0d0e10] p-3 rounded border border-[#1f2125] space-y-2">
                <span className="text-[10px] font-bold font-mono uppercase text-zinc-400 block border-b border-[#1f2125]/60 pb-1">Son Global Analiz Çıktısı</span>
                <pre className="text-[10px] font-mono text-zinc-400 overflow-auto max-h-60 leading-tight whitespace-pre">
                  {project.analysis?.debug?.all 
                    ? JSON.stringify(project.analysis.debug.all, null, 2)
                    : 'Henüz global analiz ham çıktısı bulunmuyor.'}
                </pre>
              </div>
              <div className="bg-[#0d0e10] p-3 rounded border border-[#1f2125] space-y-2">
                <span className="text-[10px] font-bold font-mono uppercase text-zinc-400 block border-b border-[#1f2125]/60 pb-1">Aktif Sahne Analiz Verisi ({selectedSceneId ? 'Seçili' : 'Seçilmedi'})</span>
                <pre className="text-[10px] font-mono text-zinc-400 overflow-auto max-h-60 leading-tight whitespace-pre">
                  {selectedSceneId && project.analysis?.debug?.[selectedSceneId]
                    ? JSON.stringify(project.analysis.debug[selectedSceneId], null, 2)
                    : 'Seçili sahneye ait ham analiz verisi bulunmuyor.'}
                </pre>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 2. TEKRAR KULLANILAN DEKOR & AKSESUARLAR CARD */}
      <div className="bg-[#131517] border border-[#1f2125] rounded-lg p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#1f2125] pb-3">
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-red-500" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-red-500">TEKRAR KULLANILAN ÖĞELER (ÇOKLU SAHNE) ({reusedProps.length})</h3>
          </div>
          
          {/* Export dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowExportDropdown(!showExportDropdown)}
              className="px-3 py-1.5 bg-[#16171a] border border-[#1f2125] hover:bg-[#1f2125] text-zinc-300 text-[10px] uppercase tracking-wider font-mono font-bold rounded-lg flex items-center gap-1.5 transition-colors"
              id="btn-export-dropdown-toggle"
            >
              <Download className="w-3.5 h-3.5 text-red-500" />
              <span>Dışa Aktar</span>
              <ChevronDown className="w-3 h-3" />
            </button>
            {showExportDropdown && (
              <div className="absolute right-0 mt-2 w-52 bg-[#131517] border border-[#1f2125] rounded-lg shadow-xl py-1.5 z-20 text-left">
                <button
                  onClick={() => {
                    handleExport('xlsx');
                    setShowExportDropdown(false);
                  }}
                  className="w-full px-3 py-2 text-xs text-zinc-300 hover:bg-[#16171a] transition-colors font-semibold flex items-center gap-2"
                >
                  <File className="w-4 h-4 text-emerald-500" />
                  Excel olarak indir (.xlsx)
                </button>
                <button
                  onClick={() => {
                    handleExport('csv');
                    setShowExportDropdown(false);
                  }}
                  className="w-full px-3 py-2 text-xs text-zinc-300 hover:bg-[#16171a] transition-colors font-semibold flex items-center gap-2"
                >
                  <File className="w-4 h-4 text-zinc-500" />
                  CSV olarak indir (.csv)
                </button>
              </div>
            )}
          </div>
        </div>

        {reusedProps.length === 0 ? (
          <p className="text-xs text-zinc-500 italic leading-relaxed">
            Birden fazla sahnede tekrar kullanılan bir dekor öğesi bulunmuyor.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {reusedProps.map((item) => (
              <div key={item.id} className="bg-[#16171a] border border-[#1f2125] p-3 rounded-lg space-y-1.5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white tracking-wide truncate">{item.ad}</span>
                    <span className="px-1.5 py-0.5 rounded text-[8px] font-mono font-bold uppercase bg-red-950/20 text-red-500 border border-red-900/30">
                      Çoklu Sahne
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 font-mono mt-1 leading-normal max-h-12 overflow-hidden truncate">
                    {item.aciklama || 'Kullanım açıklaması bulunmuyor.'}
                  </p>
                </div>
                <div className="text-[9px] font-mono text-zinc-500 mt-2 flex items-center gap-1 border-t border-[#1f2125]/60 pt-1.5">
                  <span className="font-bold">Sahneler:</span>
                  <span className="text-zinc-300 truncate font-semibold">{(item.kullanildigiSahneler || []).join(', ')}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 3. PERDE TABS SWITCHER MATCHING MOCKUP */}
      <div className="flex border-b border-[#1f2125] gap-6">
        <button
          onClick={() => setActivePerdeTab('Perde 1')}
          className={`pb-2.5 text-xs font-mono font-bold uppercase tracking-wider relative transition-all ${
            activePerdeTab === 'Perde 1'
              ? 'text-red-500'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <span>1. Perde Sahneleri</span>
          {activePerdeTab === 'Perde 1' && (
            <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-red-600 rounded"></span>
          )}
        </button>
        <button
          onClick={() => setActivePerdeTab('Perde 2')}
          className={`pb-2.5 text-xs font-mono font-bold uppercase tracking-wider relative transition-all ${
            activePerdeTab === 'Perde 2'
              ? 'text-red-500'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <span>2. Perde Sahneleri</span>
          {activePerdeTab === 'Perde 2' && (
            <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-red-600 rounded"></span>
          )}
        </button>
      </div>

      {/* 4. MEKANLAR VE ATMOSFER TABLE CARD MATCHING MOCKUP */}
      <div className="bg-[#131517] border border-[#1f2125] rounded-lg p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-[#1f2125] pb-3">
          <div className="flex items-center gap-2">
            <Compass className="w-4 h-4 text-red-500" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-white">MEKANLAR VE ATMOSFER</h3>
          </div>
          <button
            onClick={handleAddMekan}
            className="px-3 py-1.5 bg-[#16171a] border border-[#1f2125] hover:bg-[#1f2125] hover:border-zinc-700 text-white text-[10px] uppercase font-mono font-bold rounded-lg flex items-center gap-1.5 transition-colors"
          >
            <Plus className="w-3.5 h-3.5 text-red-500" />
            <span>Mekan Ekle</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#16171a] font-mono text-[9px] uppercase tracking-wider text-zinc-400 border-b border-[#1f2125]">
                <th className="p-3 w-1/4">MEKAN ADI</th>
                <th className="p-3 w-1/6">İÇ / DIŞ</th>
                <th className="p-3 w-1/6">DÖNEM / ERA</th>
                <th className="p-3 w-1/3">ATMOSFER / NOTLAR</th>
                <th className="p-3 text-right w-16">EYLEMLER</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1f2125]">
              {currentPerdeMekanlar.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-zinc-500 italic text-xs">
                    Bu perdede tanımlanmış bir mekan bulunmuyor. Eklemek için "+ Mekan Ekle" butonunu kullanabilirsiniz.
                  </td>
                </tr>
              ) : (
                currentPerdeMekanlar.map((m) => {
                  const isAdded = m.changed === 'added';
                  const isRemoved = m.changed === 'removed';
                  return (
                    <tr 
                      key={m.id} 
                      className={`transition-colors ${
                        isAdded 
                          ? 'bg-emerald-950/20 border-l-4 border-l-emerald-500 text-emerald-300' 
                          : isRemoved 
                          ? 'bg-red-950/25 border-l-4 border-l-red-500 text-red-400 opacity-60' 
                          : 'hover:bg-[#16171a]/40'
                      }`}
                    >
                      
                      {/* Mekan Adı (Editable Input) */}
                      <td className="p-2 font-bold text-white text-xs">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={m.ad}
                            disabled={isRemoved}
                            onChange={(e) => handleUpdateMekan(m.id, 'ad', e.target.value)}
                            className={`bg-[#16171a] border border-transparent hover:border-[#1f2125] focus:bg-[#0d0e10] focus:border-red-600 rounded px-2.5 py-1.5 text-xs outline-none w-full font-bold transition-all ${
                              isRemoved ? 'line-through text-red-400/80 cursor-not-allowed opacity-50' : 'text-white'
                            }`}
                          />
                          {isAdded && <span className="text-[8px] bg-emerald-950 text-emerald-400 px-1.5 py-0.5 rounded uppercase font-bold font-mono">Eklendi</span>}
                          {isRemoved && <span className="text-[8px] bg-red-950 text-red-400 px-1.5 py-0.5 rounded uppercase font-bold font-mono">Çıkarıldı</span>}
                        </div>
                      </td>

                      {/* İç / Dış Dropdown select */}
                      <td className="p-2">
                        <select
                          value={m.tip}
                          disabled={isRemoved}
                          onChange={(e) => handleUpdateMekan(m.id, 'tip', e.target.value)}
                          className={`bg-[#16171a] border border-[#1f2125] focus:border-red-600 text-white rounded px-2.5 py-1.5 text-xs outline-none w-full font-mono transition-colors ${
                            isRemoved ? 'cursor-not-allowed opacity-50' : ''
                          }`}
                        >
                          <option value="iç">İç</option>
                          <option value="dış">Dış</option>
                          <option value="bilinmiyor">Bilinmiyor</option>
                        </select>
                      </td>

                      {/* Dönem / Era (Editable Input) */}
                      <td className="p-2">
                        <input
                          type="text"
                          value={m.donem}
                          disabled={isRemoved}
                          onChange={(e) => handleUpdateMekan(m.id, 'donem', e.target.value)}
                          className={`bg-[#16171a] border border-transparent hover:border-[#1f2125] focus:bg-[#0d0e10] focus:border-red-600 text-zinc-300 rounded px-2.5 py-1.5 text-xs outline-none w-full font-mono transition-all ${
                            isRemoved ? 'line-through text-red-500/70 cursor-not-allowed opacity-50' : ''
                          }`}
                        />
                      </td>

                      {/* Atmosfer / Notlar (Editable Input) */}
                      <td className="p-2">
                        <input
                          type="text"
                          value={m.atmosfer}
                          disabled={isRemoved}
                          onChange={(e) => handleUpdateMekan(m.id, 'atmosfer', e.target.value)}
                          className={`bg-[#16171a] border border-transparent hover:border-[#1f2125] focus:bg-[#0d0e10] focus:border-red-600 text-zinc-300 rounded px-2.5 py-1.5 text-xs outline-none w-full transition-all ${
                            isRemoved ? 'line-through text-red-500/70 cursor-not-allowed opacity-50' : ''
                          }`}
                        />
                      </td>

                      {/* Delete action */}
                      <td className="p-2 text-right">
                        <button
                          onClick={() => handleDeleteMekan(m.id)}
                          disabled={isRemoved}
                          className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-950/20 rounded transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                          title="Mekanı Sil"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* DEKOR VE AKSESUAR LİSTESİ CARD */}
      <div className="bg-[#131517] border border-[#1f2125] rounded-lg p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-[#1f2125] pb-3">
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-red-500" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-white">DEKOR VE AKSESUAR LİSTESİ ({project.analysis?.aksesuarlar?.length || 0})</h3>
          </div>
        </div>

        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#16171a] font-mono text-[9px] uppercase tracking-wider text-zinc-400 border-b border-[#1f2125]">
                <th className="p-3 w-1/4">AKSESUAR ADI</th>
                <th className="p-3 w-1/6">KATEGORİ</th>
                <th className="p-3 w-1/3">AÇIKLAMA / NOTLAR</th>
                <th className="p-3 w-1/4">KULLANILDIĞI SAHNELER</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1f2125]">
              {(!project.analysis?.aksesuarlar || project.analysis.aksesuarlar.length === 0) ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-zinc-500 italic text-xs">
                    Analiz sonucunda dekor veya aksesuar bulunamadı.
                  </td>
                </tr>
              ) : (
                project.analysis.aksesuarlar.map((a) => (
                  <tr key={a.id} className="hover:bg-[#16171a]/40 transition-colors">
                    <td className="p-3 font-bold text-white text-xs">{a.ad}</td>
                    <td className="p-3">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-red-950/20 text-red-400 border border-red-900/30">
                        {a.kategori}
                      </span>
                    </td>
                    <td className="p-3 text-zinc-300">{a.aciklama || 'Açıklama bulunmuyor.'}</td>
                    <td className="p-3 font-mono text-[11px] text-zinc-400">
                      {(a.kullanildigiSahneler || []).join(', ')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 5. SAHNE GEÇİŞ SIRASI (Chronological Flow) CARD MATCHING MOCKUP */}
      <div className="bg-[#131517] border border-[#1f2125] rounded-lg p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-[#1f2125] pb-3">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-red-500" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-white font-mono">SAHNE GEÇİŞ SIRASI (Kronolojik Akış)</h3>
          </div>
          <button
            onClick={handleAddGecis}
            className="px-3 py-1.5 bg-[#16171a] border border-[#1f2125] hover:bg-[#1f2125] hover:border-zinc-700 text-white text-[10px] uppercase font-mono font-bold rounded-lg flex items-center gap-1.5 transition-colors"
          >
            <Plus className="w-3.5 h-3.5 text-red-500" />
            <span>Geçiş Noktası Ekle</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#16171a] font-mono text-[9px] uppercase tracking-wider text-zinc-400 border-b border-[#1f2125]">
                <th className="p-3 w-1/4">SAHNE NO</th>
                <th className="p-3 w-1/3">MEKAN ADI</th>
                <th className="p-3 w-1/3">GEÇİŞ DETAYI / NOTLAR</th>
                <th className="p-3 text-right w-16">EYLEMLER</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1f2125]">
              {currentPerdeGecisler.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-zinc-500 italic text-xs">
                    Kronolojik geçiş sırası bulunamadı. Eklemek için "+ Geçiş Noktası Ekle" butonunu kullanabilirsiniz.
                  </td>
                </tr>
              ) : (
                currentPerdeGecisler.map((g) => (
                  <tr key={g.id} className="hover:bg-[#16171a]/40 transition-colors">
                    
                    {/* Sahne No (Editable Input) */}
                    <td className="p-2 text-zinc-300 font-bold font-mono">
                      <input
                        type="text"
                        value={g.sahneNo}
                        onChange={(e) => handleUpdateGecis(g.id, 'sahneNo', e.target.value)}
                        className="bg-[#16171a] border border-transparent hover:border-[#1f2125] focus:bg-[#0d0e10] focus:border-red-600 text-white rounded px-2.5 py-1.5 text-xs outline-none w-full font-mono transition-all"
                      />
                    </td>

                    {/* Mekan Seçici Dropdown */}
                    <td className="p-2">
                      <select
                        value={g.mekanAd}
                        onChange={(e) => handleUpdateGecis(g.id, 'mekanAd', e.target.value)}
                        className="bg-[#16171a] border border-[#1f2125] focus:border-red-600 text-white rounded px-2.5 py-1.5 text-xs outline-none w-full transition-colors font-bold"
                      >
                        {(project.analysis?.mekanlar || []).map(m => (
                          <option key={m.id} value={m.ad}>{m.ad}</option>
                        ))}
                        {!(project.analysis?.mekanlar || []).some(m => m.ad === g.mekanAd) && (
                          <option value={g.mekanAd}>{g.mekanAd}</option>
                        )}
                      </select>
                    </td>

                    {/* Geçiş Notu (Editable Input) */}
                    <td className="p-2">
                      <input
                        type="text"
                        value={g.not}
                        onChange={(e) => handleUpdateGecis(g.id, 'not', e.target.value)}
                        className="bg-[#16171a] border border-transparent hover:border-[#1f2125] focus:bg-[#0d0e10] focus:border-red-600 text-zinc-300 rounded px-2.5 py-1.5 text-xs outline-none w-full transition-all"
                      />
                    </td>

                    {/* Delete action */}
                    <td className="p-2 text-right">
                      <button
                        onClick={() => handleDeleteGecis(g.id)}
                        className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-950/20 rounded transition-all"
                        title="Geçiş Noktasını Sil"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      </>
      )}

    </div>
  );
}
