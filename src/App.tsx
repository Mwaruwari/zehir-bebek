import { useState, useEffect, useRef, FormEvent } from 'react';
import { Project, ServerLog } from './types';
import ProjectList from './components/ProjectList';
import MetinAnalizi from './components/MetinAnalizi';
import LogViewer from './components/LogViewer';
import { SunumDosyasiView } from './components/SunumDosyasi';
import { TeknikCizimView } from './components/TeknikCizim';
import { UretimPlanıView } from './components/UretimPlani';
import { HareketDuyguView } from './components/HareketDuygu';
import { SembolikAnlatimView } from './components/SembolikAnlatim';
import { BackupManagerModal } from './components/BackupManagerModal';
import { safeMergeProject, safeMergeProjectsList } from './utils/safeMerge';
import { 
  Drama, 
  Sparkles, 
  FileText, 
  Layers, 
  TrendingUp, 
  Compass, 
  ClipboardList, 
  LogOut, 
  Terminal, 
  ChevronDown, 
  ChevronUp, 
  Settings,
  MapPin,
  Lock,
  Maximize2,
  History,
  AlertTriangle,
  RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [activeTab, setActiveTab] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [logs, setLogs] = useState<ServerLog[]>([]);
  const [showLogs, setShowLogs] = useState(false);

  // Backup manager state
  const [showBackupModal, setShowBackupModal] = useState(false);

  // Save & Queue state
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingProjectsRef = useRef<Project[] | null>(null);
  const isSavingAsyncRef = useRef(false);
  const hasLoadedRef = useRef(false);

  // Settings modal states
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsName, setSettingsName] = useState('');
  const [settingsWidth, setSettingsWidth] = useState(12);
  const [settingsLength, setSettingsLength] = useState(8);
  const [settingsHeight, setSettingsHeight] = useState(6);
  const [settingsSahne, setSettingsSahne] = useState('');
  const [settingsKurum, setSettingsKurum] = useState('');

  // 1. Fetch Projects from Express Shared JSON State on mount
  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const res = await fetch('/api/projects');
        if (res.ok) {
          const data = await res.json();
          setProjects(data);
          hasLoadedRef.current = true;

          // Restore last selected project from localStorage if applicable
          const lastId = localStorage.getItem('activeProjectId');
          if (lastId) {
            const found = data.find((p: Project) => p.id === lastId);
            if (found) {
              setSelectedProject(found);
            }
          }
        }
      } catch (err) {
        console.error('Failed to load projects from shared backend:', err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchProjects();
  }, []);

  // 2. Fetch system logs to display in indicator
  const fetchRecentLogs = async () => {
    try {
      const res = await fetch('/api/logs');
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchRecentLogs();
    const interval = setInterval(fetchRecentLogs, 4000);
    return () => clearInterval(interval);
  }, []);

  // Log logger helper
  const addClientLog = async (level: 'info' | 'error', message: string) => {
    console.log(`[CLIENT ${level.toUpperCase()}] ${message}`);
    try {
      await fetch('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level, message })
      });
    } catch (err) {
      console.error('Failed to post client log:', err);
    }
    fetchRecentLogs();
  };

  // Sequential Save Queue to prevent race conditions and payload loss
  const processSaveQueue = async () => {
    if (isSavingAsyncRef.current) return;
    if (!pendingProjectsRef.current) return;

    isSavingAsyncRef.current = true;
    setIsSaving(true);

    while (pendingProjectsRef.current !== null) {
      const projectsToSave = pendingProjectsRef.current;
      pendingProjectsRef.current = null;

      try {
        const url = projectsToSave.length === 0 ? '/api/projects?allowEmpty=true' : '/api/projects';
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(projectsToSave)
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || errData.reason || `HTTP ${res.status}`);
        }

        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || 'Kaydetme doğrulaması başarısız');
        }

        setSaveError(null);
      } catch (err: any) {
        console.error('Failed to save projects to shared backend:', err);
        const errMsg = err.message || 'Sunucuya erişilemedi';
        setSaveError(errMsg);
        addClientLog('error', `KRİTİK HATA: Proje verileri kaydedilemedi: ${errMsg}`);
      }
    }

    isSavingAsyncRef.current = false;
    setIsSaving(false);
  };

  // 3. Auto-save projects array to express backend on change (with safe merge & debounce)
  const persistProjects = (updated: Project[], immediate = false, allowEmpty = false) => {
    setProjects(prevProjects => {
      const mergedList = safeMergeProjectsList(prevProjects, updated, allowEmpty);
      pendingProjectsRef.current = mergedList;
      return mergedList;
    });

    if (!hasLoadedRef.current) return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    if (immediate) {
      processSaveQueue();
    } else {
      saveTimeoutRef.current = setTimeout(() => {
        processSaveQueue();
      }, 1200);
    }
  };

  // 4. Project Actions
  const handleCreateProject = (name: string, width: number, length: number, height: number, sahne: string, kurum: string) => {
    const newProj: Project = {
      id: Math.random().toString(36).substring(2, 9),
      name,
      width,
      length,
      height,
      sahne,
      kurum,
      createdAt: new Date().toISOString(),
      scenes: []
    };

    const updated = [newProj, ...projects];
    persistProjects(updated, true);
    setSelectedProject(newProj);
    localStorage.setItem('activeProjectId', newProj.id);
    addClientLog('info', `Yeni proje oluşturuldu: "${name}" (${width}mx${length}mx${height}m)`);
  };

  const handleDeleteProject = async (id: string) => {
    const updated = projects.filter(p => p.id !== id);
    setProjects(updated);
    if (selectedProject?.id === id) {
      setSelectedProject(null);
      localStorage.removeItem('activeProjectId');
    }

    try {
      const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
      if (res.ok) {
        addClientLog('info', `Proje silindi. ID: ${id}`);
        return;
      }
    } catch (e) {
      // Fallback to persist
    }
    persistProjects(updated, true, true);
    addClientLog('info', `Proje silindi. ID: ${id}`);
  };

  const handleRenameProject = (id: string, newName: string) => {
    const updated = projects.map(p => {
      if (p.id === id) {
        return { ...p, name: newName };
      }
      return p;
    });
    persistProjects(updated);
    if (selectedProject?.id === id) {
      setSelectedProject(prev => prev ? { ...prev, name: newName } : null);
    }
    addClientLog('info', `Proje adı güncellendi: "${newName}"`);
  };

  const handleUpdateProject = (updatedProj: Project) => {
    const updated = projects.map(p => {
      if (p.id === updatedProj.id) {
        return safeMergeProject(p, updatedProj);
      }
      return p;
    });
    persistProjects(updated);
    setSelectedProject(prev => prev?.id === updatedProj.id ? safeMergeProject(prev, updatedProj) : updatedProj);
    addClientLog('info', `"${updatedProj.name}" projesi güncellendi (otomatik kayıt).`);
  };

  const handleSaveSettings = (e: FormEvent) => {
    e.preventDefault();
    if (!selectedProject) return;
    const updated: Project = {
      ...selectedProject,
      name: settingsName.trim(),
      width: settingsWidth,
      length: settingsLength,
      height: settingsHeight,
      sahne: settingsSahne.trim(),
      kurum: settingsKurum.trim()
    };
    handleUpdateProject(updated);
    setShowSettingsModal(false);
    addClientLog('info', `Proje ayarları güncellendi: "${settingsName.trim()}"`);
  };

  const handleSelectProject = (p: Project) => {
    setSelectedProject(p);
    localStorage.setItem('activeProjectId', p.id);
    setActiveTab(0); // reset to script analysis
  };

  const handleExitProject = () => {
    setSelectedProject(null);
    localStorage.removeItem('activeProjectId');
  };

  // Tabs structure metadata matching the mockup exactly
  const tabs = [
    { label: 'Metin Analizi', subtitle: 'Senaryo & Dekor Analizi', icon: FileText, desc: 'Oyun metni analizi ve mekan tespiti' },
    { label: 'Sunum Dosyası', subtitle: 'Görsel Dil & Slogan', icon: FileText, desc: 'Reji ekibi sunum dökümanı taslağı' },
    { label: 'Teknik Çizim', subtitle: 'Ölçeklendirme & Grid', icon: Layers, desc: 'Ölçekli sahne yerleşim planı ve ızgara' },
    { label: 'Üretim Planı', subtitle: 'Bütçe & Atölye Kartları', icon: ClipboardList, desc: 'Konsolide dekor ve aksesuar tedarik tablosu' },
    { label: 'Duygu Grafiği', subtitle: 'Hareket & Duygu Eğrisi', icon: TrendingUp, desc: 'Duygusal zirveler ve reji ritim eğrisi' },
    { label: 'Sembolik Anlatım', subtitle: 'Alt Metin & Semboller', icon: Compass, desc: 'Tematik referanslar ve sembol moodboard' }
  ];

  const recentError = logs.filter(l => l.level === 'error').slice(-1)[0];

  return (
    <div className="min-h-screen min-h-[100dvh] bg-[#0b0c0e] text-[#f3f4f6] flex flex-col font-sans selection:bg-red-600 selection:text-white">
      
      {/* GLOBAL BRANDING HEADER MATCHING MOCKUP */}
       <header 
         className="sticky top-0 z-50 border-b border-[#1f2125] bg-[#0d0e10]/95 backdrop-blur-md flex items-center justify-between px-3 sm:px-6 transition-all"
         style={{
           paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)',
           paddingBottom: '0.75rem',
           paddingLeft: 'max(env(safe-area-inset-left, 0px), 0.75rem)',
           paddingRight: 'max(env(safe-area-inset-right, 0px), 0.75rem)',
         }}
       >
         <div className="flex items-center gap-2 sm:gap-3 shrink-0">
           <img 
             src="/logo.jpg" 
             alt="Zehir Bebek Logo" 
             className="h-9 sm:h-11 w-auto object-contain shrink-0" 
             referrerPolicy="no-referrer"
           />
           <div>
             <h1 className="text-xs sm:text-sm font-bold text-white tracking-wide leading-tight flex items-center gap-1.5 sm:gap-2 uppercase">
               ZEHİR BEBEK
               <span className="text-[8px] sm:text-[9px] font-mono bg-red-950/20 text-red-500 px-1.5 py-0.5 rounded tracking-wider border border-red-900/30 font-bold uppercase">ADHD-PROOF</span>
             </h1>
             <p className="text-[9px] sm:text-[10px] text-zinc-500 tracking-normal font-sans truncate max-w-[130px] sm:max-w-none">Eto'nun ADHD'ye Yenik Düşmemiş Asistanı</p>
           </div>
         </div>

        {/* Global indicators */}
        <div className="flex items-center gap-1.5 sm:gap-4 shrink-0">

          {/* Auto save message matching mockup */}
          <div className={`hidden md:flex items-center gap-1.5 text-[10px] font-mono px-2.5 py-1.5 rounded-lg ${
            isSaving 
              ? 'text-amber-400 bg-amber-950/10 border border-amber-900/20' 
              : 'text-emerald-400 bg-emerald-950/10 border border-emerald-900/20'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isSaving ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500 animate-pulse'}`}></span>
            <span>{isSaving ? 'Değişiklikler Kaydediliyor...' : 'Değişiklikler Kaydedildi'}</span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              onClick={() => setShowBackupModal(true)}
              className="flex items-center gap-1 sm:gap-1.5 bg-[#16171a] border border-[#1f2125] hover:bg-[#1f2125] text-zinc-300 px-2 sm:px-3 py-1.5 rounded-lg text-[10px] uppercase tracking-wider font-mono font-semibold transition-colors shrink-0"
              title="Otomatik alınan yedek versiyonlara ulaşın ve geri yükleyin"
            >
              <History className="w-3.5 h-3.5 text-red-500 shrink-0" />
              <span className="hidden md:inline">Versiyon Geçmişi</span>
              <span className="inline md:hidden text-[9px]">Yedek</span>
            </button>

            {selectedProject && (
              <button 
                onClick={() => {
                  setSettingsName(selectedProject.name);
                  setSettingsWidth(selectedProject.width);
                  setSettingsLength(selectedProject.length);
                  setSettingsHeight(selectedProject.height);
                  setSettingsSahne(selectedProject.sahne || 'Belirtilmedi');
                  setSettingsKurum(selectedProject.kurum || 'Belirtilmedi');
                  setShowSettingsModal(true);
                }}
                className="flex items-center gap-1 sm:gap-1.5 bg-[#16171a] border border-[#1f2125] hover:bg-[#1f2125] text-zinc-300 px-2 sm:px-3 py-1.5 rounded-lg text-[10px] uppercase tracking-wider font-mono font-semibold transition-colors shrink-0"
                title="Proje Sahne Ayarları"
              >
                <Settings className="w-3.5 h-3.5 text-red-500 shrink-0" />
                <span className="hidden md:inline">Sahne Ayarları</span>
                <span className="inline md:hidden text-[9px]">Ayarlar</span>
              </button>
            )}

            <button
              onClick={() => setShowLogs(!showLogs)}
              className="flex items-center gap-1 sm:gap-1.5 text-[10px] uppercase tracking-widest font-mono bg-[#16171a] border border-[#1f2125] hover:bg-[#1f2125] px-2 sm:px-3 py-1.5 text-zinc-300 transition-all rounded-lg shrink-0"
              id="btn-toggle-global-logs"
              title="Sistem Logları"
            >
              <Terminal className="w-3.5 h-3.5 text-red-500 shrink-0" />
              <span className="hidden sm:inline">Loglar ({logs.length})</span>
              <span className="inline sm:hidden text-[9px]">({logs.length})</span>
            </button>
          </div>
        </div>
      </header>

      {/* STICKY SAVE ERROR WARNING BANNER */}
      {saveError && (
        <div className="bg-red-950/90 border-b border-red-500/50 text-red-200 px-6 py-2.5 flex items-center justify-between z-40 shadow-lg">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 animate-pulse" />
            <div>
              <p className="font-semibold text-xs text-red-100">KRİTİK KAYIT HATASI: Proje verileriniz sunucuya kaydedilemedi!</p>
              <p className="text-[11px] text-red-300 font-mono">{saveError}</p>
            </div>
          </div>
          <button
            onClick={() => {
              if (pendingProjectsRef.current === null) {
                pendingProjectsRef.current = projects;
              }
              processSaveQueue();
            }}
            className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded text-xs font-semibold flex items-center gap-1.5 transition-colors shadow"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Yeniden Dene
          </button>
        </div>
      )}

      {/* CORE CONTENT ROUTING */}
      <main 
        className="flex-1 w-full mx-auto p-3 sm:p-6 flex flex-col justify-between overflow-x-hidden overflow-y-visible"
        style={{
          paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 1.5rem)',
          paddingLeft: 'max(env(safe-area-inset-left, 0px), 0.75rem)',
          paddingRight: 'max(env(safe-area-inset-right, 0px), 0.75rem)',
        }}
      >
        <AnimatePresence mode="wait">
          {!selectedProject ? (
            /* PROJECT MANAGEMENT ROOT */
            <motion.div
              key="project-list"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.3 }}
            >
              {isLoading ? (
                <div className="flex flex-col items-center justify-center py-24 gap-3 text-zinc-500">
                  <div className="w-8 h-8 border-4 border-red-600 border-t-transparent animate-spin rounded-full"></div>
                  <span className="text-xs font-mono">Projeler yükleniyor...</span>
                </div>
              ) : (
                <ProjectList
                  projects={projects}
                  onSelectProject={handleSelectProject}
                  onCreateProject={handleCreateProject}
                  onDeleteProject={handleDeleteProject}
                  onRenameProject={handleRenameProject}
                />
              )}
            </motion.div>
          ) : (
            /* ACTIVE WORKSPACE WITH 3-COLUMN LAYOUT MATCHING MOCKUP */
            <motion.div
              key="active-workspace"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.3 }}
              className="grid grid-cols-1 lg:grid-cols-5 gap-6"
            >
              
              {/* COLUMN 1: LEFT SIDEBAR NAVIGATION (col-span-1) */}
              <div className="lg:col-span-1 space-y-4">
                <div className="space-y-1">
                  <span className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider block font-mono">AŞAMA AKIŞI</span>
                  
                  {/* Breadcrumb card with left chevron back arrow */}
                  <div className="flex items-center gap-2 bg-[#131517] border border-[#1f2125] p-3 rounded-lg shadow-sm">
                    <button 
                      onClick={handleExitProject}
                      className="p-1.5 bg-[#16171a] border border-[#1f2125] hover:bg-[#25272c] hover:border-zinc-700 text-zinc-300 rounded transition-colors"
                      title="Proje Seçimine Geri Dön"
                    >
                      <ChevronDown className="w-3.5 h-3.5 rotate-90" />
                    </button>
                    <span className="text-xs font-bold text-white tracking-wide truncate">{selectedProject.name}</span>
                  </div>
                </div>

                {/* Vertical Sidebar Tab List */}
                <div className="flex flex-col gap-1.5">
                  {(() => {
                    const hasApprovedDrawing = selectedProject?.technicalDrawings?.some(d => d.approved || d.isOnayli) || false;
                    
                    return tabs.map((tab, idx) => {
                      const isTabActive = activeTab === idx;
                      const TabIcon = tab.icon;
                      const isLocked = idx === 3 && !hasApprovedDrawing;
                      
                      return (
                        <button
                          key={idx}
                          disabled={isLocked}
                          onClick={() => setActiveTab(idx)}
                          className={`text-left p-3 rounded-lg border transition-all flex items-start gap-3 relative ${
                            isLocked
                              ? 'opacity-35 cursor-not-allowed bg-transparent border-transparent text-zinc-600'
                              : isTabActive
                              ? 'bg-red-950/10 border-red-800 text-white border-l-[4px] border-l-red-600'
                              : 'bg-transparent border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-[#131517]'
                          }`}
                          id={`tab-nav-${idx}`}
                          title={isLocked ? 'En az bir teknik çizimi onaylamalısınız (Üretim Planı kilitli)' : undefined}
                        >
                          <div className="relative shrink-0 mt-0.5">
                            <TabIcon className={`w-4 h-4 ${isLocked ? 'text-zinc-700' : isTabActive ? 'text-red-500' : 'text-zinc-500'}`} />
                            {isLocked && (
                              <div className="absolute -bottom-1 -right-1 bg-black rounded-full p-0.5 border border-zinc-800">
                                <Lock className="w-2 h-2 text-zinc-500" />
                              </div>
                            )}
                          </div>
                          <div className="truncate flex-1">
                            <div className={`text-[11px] font-bold tracking-wide flex items-center justify-between ${isLocked ? 'text-zinc-600' : isTabActive ? 'text-white' : 'text-zinc-300'}`}>
                              <span>{idx + 1}. {tab.label}</span>
                              {isLocked && <span className="text-[8px] font-mono bg-zinc-950 border border-zinc-800 text-zinc-500 px-1 rounded">KİLİTLİ</span>}
                            </div>
                            <div className="text-[9px] text-zinc-500 mt-0.5 truncate">{tab.subtitle}</div>
                          </div>
                        </button>
                      );
                    });
                  })()}
                </div>
              </div>

              {/* COLUMN 2: CENTRAL WORKSPACE (col-span-3) */}
              <div className="lg:col-span-3 space-y-6">
                <div className="min-h-[450px]">
                  {activeTab === 0 && (
                    <MetinAnalizi
                      project={selectedProject}
                      onUpdateProject={handleUpdateProject}
                      addLog={addClientLog}
                    />
                  )}
                  {activeTab === 1 && (
                    <SunumDosyasiView
                      project={selectedProject}
                      onUpdateProject={handleUpdateProject}
                      addLog={addClientLog}
                    />
                  )}
                  {activeTab === 2 && (
                    <TeknikCizimView
                      project={selectedProject}
                      onUpdateProject={handleUpdateProject}
                    />
                  )}
                  {activeTab === 3 && (
                    <UretimPlanıView
                      project={selectedProject}
                      onUpdateProject={handleUpdateProject}
                    />
                  )}
                  {activeTab === 4 && (
                    <HareketDuyguView
                      project={selectedProject}
                      onUpdateProject={handleUpdateProject}
                      addLog={addClientLog}
                    />
                  )}
                  {activeTab === 5 && (
                    <SembolikAnlatimView
                      project={selectedProject}
                      onUpdateProject={handleUpdateProject}
                    />
                  )}
                </div>
              </div>

              {/* COLUMN 3: RIGHT CONTEXT SIDEBAR PANEL (col-span-1) */}
              <div className="lg:col-span-1 space-y-4">
                <div className="bg-[#131517] border border-[#1f2125] p-4 rounded-lg shadow-sm space-y-4">
                  
                  {/* Header */}
                  <div className="flex items-center gap-2 border-b border-[#1f2125] pb-2.5">
                    <Layers className="w-4 h-4 text-red-500 shrink-0" />
                    <span className="text-[11px] font-bold uppercase tracking-wider text-white">Aktif Proje Bağlamı</span>
                  </div>

                  {/* Section 1: Sahne Boyutları */}
                  <div className="space-y-1.5">
                    <span className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider block font-mono">SAHNE BOYUTLARI</span>
                    <div className="grid grid-cols-3 gap-1.5">
                      <div className="bg-[#16171a] border border-[#1f2125] p-2 rounded text-center">
                        <div className="text-[9px] text-zinc-500 font-mono">En</div>
                        <div className="text-sm font-black text-red-500 font-mono mt-0.5">{selectedProject.width}<span className="text-[10px] text-zinc-400 font-normal ml-0.5">m</span></div>
                      </div>
                      <div className="bg-[#16171a] border border-[#1f2125] p-2 rounded text-center">
                        <div className="text-[9px] text-zinc-500 font-mono">Boy</div>
                        <div className="text-sm font-black text-red-500 font-mono mt-0.5">{selectedProject.length}<span className="text-[10px] text-zinc-400 font-normal ml-0.5">m</span></div>
                      </div>
                      <div className="bg-[#16171a] border border-[#1f2125] p-2 rounded text-center">
                        <div className="text-[9px] text-zinc-500 font-mono">Yük.</div>
                        <div className="text-sm font-black text-red-500 font-mono mt-0.5">{selectedProject.height}<span className="text-[10px] text-zinc-400 font-normal ml-0.5">m</span></div>
                      </div>
                    </div>
                  </div>

                  {/* Section 1.5: Sahne & Kurum Bilgileri */}
                  <div className="space-y-1.5 border-t border-[#1f2125]/60 pt-3">
                    <span className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider block font-mono">SAHNE & YAPIM</span>
                    <div className="bg-[#16171a] border border-[#1f2125] p-2.5 rounded space-y-2 text-xs">
                      <div className="flex flex-col">
                        <span className="text-[9px] text-zinc-500 font-mono uppercase">Hedef Sahne</span>
                        <span className="font-semibold text-zinc-100 truncate" title={selectedProject.sahne || 'Belirtilmedi'}>{selectedProject.sahne || 'Belirtilmedi'}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[9px] text-zinc-500 font-mono uppercase">Kurum / Yapım</span>
                        <span className="font-semibold text-zinc-100 truncate" title={selectedProject.kurum || 'Belirtilmedi'}>{selectedProject.kurum || 'Belirtilmedi'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Section 2: Adım 1 Metin Analizi */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-emerald-400">
                      <MapPin className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
                      <span className="text-[10px] font-bold uppercase tracking-wider font-mono">ADIM 1: METİN ANALİZİ</span>
                    </div>
                    <div className="bg-[#16171a] border border-[#1f2125] rounded p-2.5 space-y-1.5 text-xs text-zinc-400 font-mono">
                      <div className="flex justify-between">
                        <span>Bölümler / Perdeler:</span>
                        <span className="text-white font-bold">2</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Toplam Mekan:</span>
                        <span className="text-white font-bold">{selectedProject.analysis?.mekanlar?.length || 16}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Fiziksel Olaylar:</span>
                        <span className="text-white font-bold">{selectedProject.analysis?.olaylar?.length || 13}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Dekor/Aksesuar:</span>
                        <span className="text-white font-bold">{selectedProject.analysis?.aksesuarlar?.length || 20}</span>
                      </div>
                    </div>
                  </div>

                  {/* Section 3: Adım 2 Görsel Dil */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-purple-400">
                      <Sparkles className="w-3.5 h-3.5 shrink-0 text-purple-500" />
                      <span className="text-[10px] font-bold uppercase tracking-wider font-mono">ADIM 2: GÖRSEL & SÖZSEL DİL</span>
                    </div>
                    <div className="bg-[#16171a]/40 border border-[#1f2125]/60 rounded p-2.5 text-[11px] text-zinc-500 italic font-mono">
                      Bu aşamaya henüz geçilmedi.
                    </div>
                  </div>

                  {/* Section 4: Adım 3 Teknik Çizim */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-blue-400">
                      <Layers className="w-3.5 h-3.5 shrink-0 text-blue-500" />
                      <span className="text-[10px] font-bold uppercase tracking-wider font-mono">ADIM 3: TEKNİK ÇİZİM</span>
                    </div>
                    <div className="bg-[#16171a]/40 border border-[#1f2125]/60 rounded p-2.5 text-[11px] text-zinc-500 italic font-mono">
                      Bu aşamaya henüz geçilmedi.
                    </div>
                  </div>

                </div>
              </div>

            </motion.div>
          )}
        </AnimatePresence>

        {/* PERSISTENT REAL-TIME LOG FOOTER ACCORDION */}
        <AnimatePresence>
          {showLogs && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="mt-8 pt-4 border-t border-[#2a2a2a]"
            >
              <LogViewer />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* COMPACT STYLISH FOOTER */}
      <footer 
        className="min-h-10 border-t border-[#2a2a2a] bg-[#0a0a0a] flex flex-wrap items-center justify-between px-4 sm:px-6 py-2 shrink-0 text-[10px] tracking-widest text-zinc-500 font-mono gap-2"
        style={{
          paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 0.5rem)',
        }}
      >
        <div className="flex gap-4">
          <button onClick={() => setShowLogs(!showLogs)} className="hover:text-[#c5a059] transition-colors uppercase">SİSTEM LOGLARI ({logs.length})</button>
          {recentError && <span className="text-red-400 font-bold">● HATA TESPİT EDİLDİ</span>}
        </div>
        <div className="opacity-40 uppercase text-[9px] sm:text-[10px]">
          ZEHİR BEBEK ADHD-PROOF // SİSTEM: HAZIR | AUTO-SAVE: AKTİF
        </div>
      </footer>

      {/* Settings Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-[#111] border border-[#2a2a2a] rounded-lg w-full max-w-md max-h-[90dvh] flex flex-col overflow-hidden shadow-2xl">
            <div className="px-6 py-4 border-b border-[#2a2a2a] bg-[#0a0a0a] flex items-center justify-between shrink-0">
              <h3 className="font-serif italic text-base text-gold tracking-wide">Proje Ayarlarını Düzenle</h3>
              <button
                onClick={() => setShowSettingsModal(false)}
                className="text-zinc-500 hover:text-gold text-xl font-bold transition-colors"
              >
                ×
              </button>
            </div>
            <form onSubmit={handleSaveSettings} className="p-6 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-[10px] font-semibold text-zinc-400 mb-1.5 uppercase font-mono tracking-widest">Proje Adı</label>
                <input
                  type="text"
                  required
                  placeholder="Örn: Hamlet - Modern Sahneleme"
                  value={settingsName}
                  onChange={(e) => setSettingsName(e.target.value)}
                  className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-[#e0e0e0] outline-none focus:border-gold"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-zinc-400 mb-1.5 uppercase font-mono tracking-widest">Sahne</label>
                <input
                  type="text"
                  required
                  placeholder="Örn: Büyük Sahne, Stüdyo Sahne veya AKM"
                  value={settingsSahne}
                  onChange={(e) => setSettingsSahne(e.target.value)}
                  className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-[#e0e0e0] outline-none focus:border-gold"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-zinc-400 mb-1.5 uppercase font-mono tracking-widest">Kurum / Yapım</label>
                <input
                  type="text"
                  required
                  placeholder="Örn: Devlet Tiyatroları, Şehir Tiyatroları"
                  value={settingsKurum}
                  onChange={(e) => setSettingsKurum(e.target.value)}
                  className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-[#e0e0e0] outline-none focus:border-gold"
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
                        value={settingsWidth}
                        onChange={(e) => setSettingsWidth(parseFloat(e.target.value) || 0)}
                        className="w-full bg-[#161616] border border-[#2a2a2a] rounded px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-gold font-mono pr-6"
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
                        value={settingsLength}
                        onChange={(e) => setSettingsLength(parseFloat(e.target.value) || 0)}
                        className="w-full bg-[#161616] border border-[#2a2a2a] rounded px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-gold font-mono pr-6"
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
                        value={settingsHeight}
                        onChange={(e) => setSettingsHeight(parseFloat(e.target.value) || 0)}
                        className="w-full bg-[#161616] border border-[#2a2a2a] rounded px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-gold font-mono pr-6"
                      />
                      <span className="absolute right-2 top-2 text-[9px] text-zinc-600 font-mono">m</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-between items-center border-t border-[#2a2a2a] pt-4 mt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowSettingsModal(false);
                    setShowBackupModal(true);
                  }}
                  className="px-3 py-2 bg-red-950/40 hover:bg-red-900/50 border border-red-500/30 text-red-300 rounded text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <History className="w-3.5 h-3.5" />
                  Önceki Versiyona Dön
                </button>
                
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowSettingsModal(false)}
                    className="px-4 py-2 bg-[#2a2a2a] hover:bg-[#333] border border-[#3d3d3d] text-zinc-300 rounded text-xs font-bold uppercase tracking-widest transition-colors"
                  >
                    Vazgeç
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-[#c5a059] hover:bg-[#d9b87a] text-black rounded text-xs font-bold uppercase tracking-widest transition-colors"
                  >
                    Kaydet
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* BACKUP MANAGER MODAL */}
      <BackupManagerModal
        isOpen={showBackupModal}
        onClose={() => setShowBackupModal(false)}
        onRestoreSuccess={(restoredProjects) => {
          setProjects(restoredProjects);
          if (selectedProject) {
            const current = restoredProjects.find(p => p.id === selectedProject.id);
            if (current) {
              setSelectedProject(current);
            } else if (restoredProjects.length > 0) {
              setSelectedProject(restoredProjects[0]);
            } else {
              setSelectedProject(null);
            }
          }
        }}
        addLog={(level, msg) => addClientLog(level, msg)}
      />
    </div>
  );
}
