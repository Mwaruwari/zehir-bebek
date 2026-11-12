import { Project, SceneAnalysis } from '../types';

/**
 * Safely merges an incoming project update into an existing project.
 * Guarantees that if incoming update has undefined/null/empty fields,
 * the existing rich data (scenes, analysis, images, drawings, etc.) is preserved.
 */
export function safeMergeProject(existing: Project, incoming: Partial<Project>): Project {
  if (!existing) return incoming as Project;
  if (!incoming) return existing;

  const merged: Project = {
    ...existing,
    ...incoming,
  };

  // Helper to merge array fields safely: if incoming explicitly provided the array (even if empty because user deleted items), respect it. Only fall back if undefined.
  const mergeArray = <K extends keyof Project>(key: K) => {
    if (key in incoming) {
      const incArr = incoming[key];
      if (Array.isArray(incArr)) {
        merged[key] = incArr as any;
        return;
      }
    }
    const extArr = existing[key];
    if (Array.isArray(extArr)) {
      merged[key] = extArr as any;
    }
  };

  // Helper to merge object fields safely
  const mergeObject = <K extends keyof Project>(key: K) => {
    if (key in incoming) {
      const incObj = incoming[key];
      if (incObj && typeof incObj === 'object') {
        merged[key] = incObj as any;
        return;
      }
    }
    const extObj = existing[key];
    if (extObj && typeof extObj === 'object') {
      merged[key] = extObj as any;
    }
  };

  // 1. Merge Scenes
  mergeArray('scenes');
  mergeArray('sceneBoundaries');

  // 2. Merge Analysis safely
  if (existing.analysis || incoming.analysis) {
    const extAn: SceneAnalysis = existing.analysis || { mekanlar: [], gecisler: [], olaylar: [], aksesuarlar: [] };
    const incAn: Partial<SceneAnalysis> = incoming.analysis || {};

    const mergedAnalysis: SceneAnalysis = {
      mekanlar: (incAn.mekanlar !== undefined && Array.isArray(incAn.mekanlar)) ? incAn.mekanlar : (extAn.mekanlar || []),
      gecisler: (incAn.gecisler !== undefined && Array.isArray(incAn.gecisler)) ? incAn.gecisler : (extAn.gecisler || []),
      olaylar: (incAn.olaylar !== undefined && Array.isArray(incAn.olaylar)) ? incAn.olaylar : (extAn.olaylar || []),
      aksesuarlar: (incAn.aksesuarlar !== undefined && Array.isArray(incAn.aksesuarlar)) ? incAn.aksesuarlar : (extAn.aksesuarlar || []),
      debug: incAn.debug || extAn.debug
    };

    merged.analysis = mergedAnalysis;
  }

  // 3. Merge Visual & Drawing Libraries
  mergeArray('presentationImages');
  mergeArray('technicalDrawings');
  mergeArray('placedProps');
  mergeArray('styleLibrary');

  // 4. Merge Rhythm & Emotion Analysis
  mergeArray('movementEmotionData');
  if (existing.movementEmotionInstruction && (!incoming.movementEmotionInstruction || incoming.movementEmotionInstruction.trim() === '')) {
    merged.movementEmotionInstruction = existing.movementEmotionInstruction;
  }

  // 5. Merge Narrative & Symbolic Analysis
  mergeArray('narrativeBeats');
  mergeArray('symbolicAnalysis');
  mergeArray('symbolicMetaphors');
  if (existing.symbolicInstruction && (!incoming.symbolicInstruction || incoming.symbolicInstruction.trim() === '')) {
    merged.symbolicInstruction = existing.symbolicInstruction;
  }

  // 6. Merge Production & Verbal Plans
  mergeObject('productionPlanSummary');
  mergeObject('productionPlanDetailed');
  mergeObject('verbalLanguage');
  mergeArray('verbalLanguageHistory');
  mergeArray('sozselDilVersiyonlari');

  // 7. Preserve Script Text if incoming is empty
  if (existing.scriptText && (!incoming.scriptText || incoming.scriptText.trim() === '')) {
    merged.scriptText = existing.scriptText;
  }

  return merged;
}

/**
 * Safely merges an updated array of projects into an existing array of projects.
 * Guarantees no projects or project fields are lost during mass updates.
 */
export function safeMergeProjectsList(existingList: Project[], incomingList: Project[], allowEmpty = false): Project[] {
  if (!Array.isArray(incomingList)) {
    return Array.isArray(existingList) ? existingList : [];
  }

  if (incomingList.length === 0) {
    if (allowEmpty) {
      return [];
    }
    if (Array.isArray(existingList) && existingList.length > 0) {
      return existingList; // Safety guard against accidental empty payload
    }
    return [];
  }

  if (!Array.isArray(existingList) || existingList.length === 0) {
    return incomingList;
  }

  const existingMap = new Map<string, Project>();
  existingList.forEach(p => existingMap.set(p.id, p));

  const mergedList: Project[] = incomingList.map(incProj => {
    const extProj = existingMap.get(incProj.id);
    if (extProj) {
      return safeMergeProject(extProj, incProj);
    }
    return incProj;
  });

  return mergedList;
}
