import './src/polyfill';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import mammoth from 'mammoth';
import * as pdf from 'pdf-parse';
import { jsonrepair } from 'jsonrepair';
import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = 3000;

// Set up server-side logs
interface AppLog {
  timestamp: string;
  level: 'info' | 'error';
  message: string;
}
const logs: AppLog[] = [];

function addLog(level: 'info' | 'error', message: string) {
  const timestamp = new Date().toISOString();
  logs.push({ timestamp, level, message });
  console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
  if (logs.length > 500) {
    logs.shift();
  }
}

// Gemini Client Lazy Initializer
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error('GEMINI_API_KEY bulunamadı. Lütfen AI Studio Secrets alanından GEMINI_API_KEY girin.');
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

// Gemini call with automatic retry and model fallback (e.g. 503 UNAVAILABLE or 429 RESOURCE_EXHAUSTED)
async function generateContentWithRetry(params: any): Promise<any> {
  const ai = getGeminiClient();
  let originalModel = params.model || 'gemini-3.5-flash';
  if (originalModel === 'gemini-3.1-flash-lite-image') {
    originalModel = 'gemini-3.1-flash-lite';
  }
  
  // Build fallback priority list
  const modelsToTry = [originalModel];
  if (originalModel === 'gemini-3.5-flash') {
    modelsToTry.push('gemini-3.1-flash-lite');
  } else if (originalModel === 'gemini-3.1-flash-lite') {
    modelsToTry.push('gemini-3.5-flash');
  }

  let lastError: any = null;

  for (const model of modelsToTry) {
    let retries = 2;
    let delayMs = 1000;
    while (retries >= 0) {
      try {
        addLog('info', `Attempting Gemini call with model ${model}...`);
        const updatedParams = { ...params, model };
        const response = await ai.models.generateContent(updatedParams);
        return response;
      } catch (err: any) {
        lastError = err;
        const errMsg = err.message || '';
        const is429 = errMsg.includes('429') || errMsg.toLowerCase().includes('rate limit') || errMsg.includes('RESOURCE_EXHAUSTED');
        const isUnavailable = errMsg.includes('503') || errMsg.includes('UNAVAILABLE') || errMsg.includes('high demand') || is429;
        
        if (is429) {
          addLog('info', `Gemini call with model ${model} hit rate limit / quota (${errMsg}). Trying alternate fallback model immediately.`);
          break; // Switch directly to next model in modelsToTry
        }

        if (isUnavailable) {
          if (retries > 0) {
            addLog('info', `Gemini call with model ${model} failed (${errMsg}). Retrying in ${delayMs}ms... (${retries} retries left)`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
            retries--;
            delayMs *= 2;
          } else {
            addLog('info', `Gemini call with model ${model} failed after retries. Trying next fallback model.`);
            break;
          }
        } else {
          addLog('error', `Non-transient error in Gemini call with model ${model}: ${errMsg}`);
          break;
        }
      }
    }
  }
  throw lastError || new Error('Gemini call failed after retries and fallbacks.');
}

// Seamless Claude & Gemini AI wrappers
async function callGeminiText(systemInstruction: string, promptText: string): Promise<string> {
  try {
    addLog('info', 'Calling Gemini text analysis with fallback/retry logic...');
    const response = await generateContentWithRetry({
      model: 'gemini-3.5-flash',
      contents: promptText,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.1,
      }
    });
    const textOutput = response.text || '';
    addLog('info', `Gemini text call succeeded. Output length: ${textOutput.length}`);
    return cleanJsonResponse(textOutput);
  } catch (err: any) {
    addLog('error', `Gemini text call failed completely: ${err.message}`);
    throw err;
  }
}

async function callGeminiDocument(systemInstruction: string, promptText: string, base64Pdf: string): Promise<string> {
  try {
    addLog('info', 'Calling Gemini PDF document extraction with fallback/retry logic...');
    const docPart = {
      inlineData: {
        mimeType: 'application/pdf',
        data: base64Pdf
      }
    };
    const response = await generateContentWithRetry({
      model: 'gemini-3.5-flash',
      contents: [docPart, { text: promptText }],
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.1,
      }
    });
    const textOutput = response.text || '';
    addLog('info', `Gemini document call succeeded. Output length: ${textOutput.length}`);
    return textOutput;
  } catch (err: any) {
    addLog('error', `Gemini document call failed completely: ${err.message}`);
    throw err;
  }
}

async function callAIWithText(systemInstruction: string, promptText: string, apiKey?: string): Promise<string> {
  const hasClaudeKey = apiKey && apiKey !== 'MY_ANTHROPIC_API_KEY' && apiKey.trim() !== '';
  if (!hasClaudeKey) {
    addLog('info', 'Claude API key is not configured or placeholder. Directing query to Gemini 3.5 Flash...');
    return callGeminiText(systemInstruction, promptText);
  }

  try {
    addLog('info', 'Attempting Claude API call...');
    const result = await callClaudeAPI(systemInstruction, promptText, apiKey);
    return result;
  } catch (error: any) {
    addLog('error', `Claude API failed: ${error.message}. Falling back to Gemini 3.5 Flash...`);
    return callGeminiText(systemInstruction, promptText);
  }
}

async function callAIWithDocument(
  systemInstruction: string,
  promptText: string,
  base64Pdf: string,
  apiKey?: string
): Promise<string> {
  const hasClaudeKey = apiKey && apiKey !== 'MY_ANTHROPIC_API_KEY' && apiKey.trim() !== '';
  if (!hasClaudeKey) {
    addLog('info', 'Claude API key is not configured or placeholder. Directing document query to Gemini 3.5 Flash...');
    return callGeminiDocument(systemInstruction, promptText, base64Pdf);
  }

  try {
    addLog('info', 'Attempting Claude API call with Document...');
    const result = await callClaudeAPIWithDocument(systemInstruction, promptText, base64Pdf, apiKey);
    return result;
  } catch (error: any) {
    addLog('error', `Claude API with Document failed: ${error.message}. Falling back to Gemini 3.5 Flash...`);
    return callGeminiDocument(systemInstruction, promptText, base64Pdf);
  }
}

// Helper to dynamically extract keywords from the first few cover/metadata lines of any text
function extractDynamicMetadataKeywords(text: string): string[] {
  if (!text) return [];
  const lines = text.split('\n');
  const keywordsSet = new Set<string>();
  
  // Look at the first 15 lines of the text to find cover-page words
  const limit = Math.min(lines.length, 15);
  for (let i = 0; i < limit; i++) {
    const line = lines[i].trim();
    if (line.length === 0 || line.length > 60) continue;
    
    // Check if the line looks like metadata or cover page title/author
    const lowercaseLine = line.toLowerCase();
    const hasMetadataLabel = 
      lowercaseLine.startsWith('yazar:') || 
      lowercaseLine.startsWith('yazan:') || 
      lowercaseLine.startsWith('çeviren:') || 
      lowercaseLine.startsWith('uyarlayan:') ||
      lowercaseLine.startsWith('eser:') ||
      lowercaseLine.startsWith('roman:') ||
      lowercaseLine.startsWith('kitap:') ||
      lowercaseLine.startsWith('oyun:') ||
      lowercaseLine.includes('yayınevi') ||
      lowercaseLine.includes('yayınları') ||
      lowercaseLine.includes('baskı') ||
      lowercaseLine.includes('isbn') ||
      lowercaseLine.includes('copyright') ||
      lowercaseLine.includes('©');
      
    // Check if the line looks like a cover-page title or author credit:
    // several words, all starting with an uppercase letter.
    //
    // At least TWO words is required on purpose. A single all-caps word on its
    // own line is far more likely to be a character cue in a play ("HANNAY")
    // than an author name — and treating character names as metadata used to
    // strip every one of that character's lines from the script.
    const words = line.split(/\s+/).filter(Boolean);
    const isMainlyProperNouns = words.length >= 2 && words.length < 6 && words.every(w => {
      const firstChar = w.charAt(0);
      return firstChar === firstChar.toUpperCase() && /[A-ZÇĞİÖŞÜ]/.test(firstChar);
    });

    if (hasMetadataLabel || isMainlyProperNouns) {
      words.forEach(w => {
        const cleanWord = w.replace(/[^a-zA-ZçğışöüÇĞİŞÖÜ0-9]/g, '').toLowerCase();
        if (
          cleanWord.length > 2 && 
          cleanWord !== 'yazar' && 
          cleanWord !== 'yazan' && 
          cleanWord !== 'çeviren' && 
          cleanWord !== 'uyarlayan' &&
          cleanWord !== 'yayınları' &&
          cleanWord !== 'yayınevi' &&
          cleanWord !== 'roman' &&
          cleanWord !== 'kitap' &&
          cleanWord !== 'oyun' &&
          cleanWord !== 'bölüm'
        ) {
          keywordsSet.add(cleanWord);
        }
      });
    }
  }
  
  return Array.from(keywordsSet);
}

// Preprocessing helper to remove book titles, authors, publishers, and other identifying cover/metadata from text
function preprocessScriptText(text: string): string {
  if (!text) return '';
  
  const lines = text.split('\n');
  const isMetadataLine = (line: string, index: number): boolean => {
    const clean = line.trim().toLowerCase();
    if (clean === '') return false;
    
    // Check for explicit metadata patterns or keywords
    if (
      clean.startsWith('yazan:') || 
      clean.startsWith('yazar:') || 
      clean.startsWith('çeviren:') || 
      clean.startsWith('uyarlayan:') ||
      clean.startsWith('eser:') ||
      clean.startsWith('romanı:') ||
      clean.startsWith('oyunu:') ||
      clean.includes('isbn') ||
      clean.includes('copyright') ||
      clean.includes('tüm hakları saklıdır') ||
      clean.includes('©') ||
      clean.includes('.pdf') ||
      clean.includes('.docx') ||
      clean.includes('.txt') ||
      (clean.includes('bölüm') && index < 5)
    ) {
      return true;
    }
    
    // In the first 25 lines, filter out explicit lines starting with metadata indicators
    if (index < 25) {
      const metadataLabels = ['yazar:', 'yazan:', 'çeviren:', 'uyarlayan:', 'eser:', 'roman:', 'kitap:', 'oyun:', 'bölüm:'];
      if (metadataLabels.some(label => clean.startsWith(label))) {
        return true;
      }
    }
    
    return false;
  };

  const processedLines: string[] = [];
  let isStrippingLeadingBlankAndMetadata = true;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isMeta = isMetadataLine(line, i);
    
    if (isStrippingLeadingBlankAndMetadata) {
      if (isMeta || line.trim() === '') {
        continue;
      } else {
        isStrippingLeadingBlankAndMetadata = false;
      }
    }
    
    if (isMetadataLine(line, i)) {
      continue;
    }
    
    processedLines.push(line);
  }
  
  return processedLines.join('\n').trim();
}

// Aggressive preprocessing: strips front- and back-matter on retry.
//
// The keyword filter is confined to the first and last few lines of the
// document. Applying it to the whole body — as an earlier version did — meant
// that any word picked up from the cover page (including character names)
// deleted every short line containing it, gutting the script itself.
const AGGRESSIVE_HEAD_LINES = 25;
const AGGRESSIVE_TAIL_LINES = 15;

function aggressivePreprocessScriptText(text: string): string {
  if (!text) return '';
  const clean = preprocessScriptText(text);
  const lines = clean.split('\n');

  // Extract dynamic metadata keywords from the cover lines of the original text
  const dynamicKeywords = extractDynamicMetadataKeywords(text);
  const filterKeywords = [...dynamicKeywords, 'baskı', 'basım', 'yayın'];

  const isCoverNoise = (line: string): boolean => {
    const l = line.trim().toLowerCase();
    if (!l || l.length >= 60) return false;
    return filterKeywords.some(kw => l.includes(kw));
  };

  const headEnd = Math.min(AGGRESSIVE_HEAD_LINES, lines.length);
  const tailStart = Math.max(headEnd, lines.length - AGGRESSIVE_TAIL_LINES);

  const head = lines.slice(0, headEnd).filter(line => !isCoverNoise(line));
  const body = lines.slice(headEnd, tailStart); // never filtered
  const tail = lines.slice(tailStart).filter(line => !isCoverNoise(line));

  const removed = (headEnd - head.length) + ((lines.length - tailStart) - tail.length);
  if (removed > 0) {
    addLog('info', `Agresif ön-temizleme: baş/son bölümden ${removed} kapak satırı çıkarıldı. Gövde metnine dokunulmadı (${body.length} satır korundu).`);
  }

  return [...head, ...body, ...tail].join('\n').trim();
}

// Detect copyright-related refusals or block messages from the model.
//
// Deliberately narrow. The previous version matched single words such as
// "telif", "policy" or "politikası" anywhere in the output — so a novel that
// merely used one of those words, or an extracted script tens of thousands of
// characters long, was mistaken for a refusal and sent through the destructive
// aggressive-cleanup path.
const REFUSAL_MAX_LENGTH = 2000;

const REFUSAL_PATTERNS: RegExp[] = [
  // Turkish refusals: an inability verb near a copyright/reproduction noun.
  /telif\s+hak\w*/i,
  /(yayımlanmış|yayınlanmış)\s+bir\s+eser/i,
  /(paylaşamam|aktaramam|çoğaltamam|yeniden\s+üretemem)/i,
  /(yardımcı\s+olamam|bu\s+(isteği|talebi)\s+(yerine\s+getiremem|karşılayamam))/i,
  // English refusals.
  /\bcopyright(ed)?\b/i,
  /\bi\s+(can'?t|cannot|am\s+not\s+able\s+to)\s+(help|assist|analyze|reproduce|provide|share)/i,
  /\breproduc\w+\s+the\s+(full|entire|complete)\s+(text|book|work)/i,
];

function isCopyrightRejection(text: string): boolean {
  if (!text) return false;

  // A real refusal is a short message. Anything longer is actual output —
  // an extracted script or a populated JSON analysis — and must never be
  // treated as a refusal just because of a word it happens to contain.
  const trimmed = text.trim();
  if (trimmed.length > REFUSAL_MAX_LENGTH) return false;

  // Valid JSON payloads are results, not refusals.
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return false;

  return REFUSAL_PATTERNS.some(pattern => pattern.test(trimmed));
}

// Extract script portion from prompt, clean it, and reconstruct prompt with logging metadata
function cleanAndReconstructPrompt(promptText: string, aggressive: boolean = false): { cleanPrompt: string; first100: string } {
  let scriptText = '';
  let prefix = '';
  let suffix = '';
  let usedDelimiter = '';

  if (promptText.includes('METİN İÇERİĞİ:')) {
    usedDelimiter = 'METİN İÇERİĞİ:';
    const parts = promptText.split('METİN İÇERİĞİ:');
    prefix = parts[0] + 'METİN İÇERİĞİ:\n';
    scriptText = parts[1] || '';
  } else if (promptText.includes('ORIGINAL SCRIPT:')) {
    usedDelimiter = 'ORIGINAL SCRIPT:';
    const parts = promptText.split('ORIGINAL SCRIPT:');
    prefix = parts[0] + 'ORIGINAL SCRIPT:\n';
    
    const secondPart = parts[1] || '';
    if (secondPart.includes('CURRENT TABLE DATA (JSON):')) {
      const subParts = secondPart.split('CURRENT TABLE DATA (JSON):');
      scriptText = subParts[0] || '';
      suffix = '\nCURRENT TABLE DATA (JSON):' + subParts[1];
    } else {
      scriptText = secondPart;
    }
  }

  if (usedDelimiter) {
    const cleanedScript = aggressive 
      ? aggressivePreprocessScriptText(scriptText) 
      : preprocessScriptText(scriptText);
    
    const finalPrompt = prefix + cleanedScript + suffix;
    const first100 = cleanedScript.substring(0, 100).replace(/\s+/g, ' ');
    return { cleanPrompt: finalPrompt, first100 };
  }

  const cleanedPrompt = aggressive 
    ? aggressivePreprocessScriptText(promptText) 
    : preprocessScriptText(promptText);
  return { cleanPrompt: cleanedPrompt, first100: cleanedPrompt.substring(0, 100).replace(/\s+/g, ' ') };
}

// Claude-only wrappers (no automatic Gemini fallback) for Metin Analizi and Aksesuar Tespiti
async function callClaudeOnlyText(systemInstruction: string, promptText: string, apiKey?: string): Promise<string> {
  const hasClaudeKey = apiKey && apiKey !== 'MY_ANTHROPIC_API_KEY' && apiKey.trim() !== '';
  if (!hasClaudeKey) {
    throw new Error('Anthropic API anahtarı ayarlanmamış. PDF metin çıkarma ve metin analizi işlemleri için Claude API kullanılması gerekmektedir. Lütfen Yapay Zeka Ayarları panelinden geçerli bir ANTHROPIC_API_KEY girin.');
  }

  // ATTEMPT 1: Clean and pre-process identifying book/author details
  const prep1 = cleanAndReconstructPrompt(promptText, false);
  addLog('info', `[Attempt 1] Modele gönderilen metnin ilk 100 karakteri: "${prep1.first100}"`);
  console.log(`[Attempt 1] Modele gönderilen metnin ilk 100 karakteri: "${prep1.first100}"`);

  try {
    addLog('info', 'Attempting Claude-only API call (Attempt 1)...');
    const result = await callClaudeAPI(systemInstruction, prep1.cleanPrompt, apiKey);
    
    if (isCopyrightRejection(result)) {
      addLog('info', 'Copyright rejection detected in model response. Retrying with aggressive preprocessing...');
      return await handleAggressiveRetry(systemInstruction, promptText, apiKey);
    }
    
    return result;
  } catch (error: any) {
    const errMsg = error.message || '';
    if (isCopyrightRejection(errMsg)) {
      addLog('info', `Copyright exception caught: "${errMsg}". Retrying with aggressive preprocessing...`);
      return await handleAggressiveRetry(systemInstruction, promptText, apiKey);
    }
    
    addLog('error', `Claude-only API call failed: ${error.message}`);
    throw new Error(`Claude API bağlantısında sorun oluştu: ${error.message}, lütfen tekrar deneyin.`);
  }
}

async function handleAggressiveRetry(systemInstruction: string, promptText: string, apiKey: string): Promise<string> {
  // ATTEMPT 2: Aggressive cleaning of beginning/end and identifiers
  const prep2 = cleanAndReconstructPrompt(promptText, true);
  addLog('info', `[Attempt 2 - Retry] Modele gönderilen metnin ilk 100 karakteri: "${prep2.first100}"`);
  console.log(`[Attempt 2 - Retry] Modele gönderilen metnin ilk 100 karakteri: "${prep2.first100}"`);

  try {
    const result = await callClaudeAPI(systemInstruction, prep2.cleanPrompt, apiKey);
    if (isCopyrightRejection(result)) {
      addLog('error', 'Copyright rejection detected even after aggressive preprocessing.');
      throw new Error('Bu metin için otomatik analiz başarısız oldu. Alternatif olarak metni bölüm bölüm yükleyebilir veya farklı bir formatta deneyebilirsiniz.');
    }
    return result;
  } catch (error: any) {
    addLog('error', `Retry attempt failed: ${error.message}`);
    throw new Error('Bu metin için otomatik analiz başarısız oldu. Alternatif olarak metni bölüm bölüm yükleyebilir veya farklı bir formatta deneyebilirsiniz.');
  }
}

async function callClaudeOnlyDocument(
  systemInstruction: string,
  promptText: string,
  base64Pdf: string,
  apiKey?: string
): Promise<string> {
  const hasClaudeKey = apiKey && apiKey !== 'MY_ANTHROPIC_API_KEY' && apiKey.trim() !== '';
  if (!hasClaudeKey) {
    throw new Error('Anthropic API anahtarı ayarlanmamış. PDF metin çıkarma ve metin analizi işlemleri için Claude API kullanılması gerekmektedir. Lütfen Yapay Zeka Ayarları panelinden geçerli bir ANTHROPIC_API_KEY girin.');
  }

  try {
    addLog('info', 'Attempting Claude-only API call with Document...');
    const result = await callClaudeAPIWithDocument(systemInstruction, promptText, base64Pdf, apiKey);
    
    if (isCopyrightRejection(result)) {
      addLog('error', 'Copyright rejection detected in document parsing.');
      throw new Error('Bu metin için otomatik analiz başarısız oldu. Alternatif olarak metni bölüm bölüm yükleyebilir veya farklı bir formatta deneyebilirsiniz.');
    }
    
    return result;
  } catch (error: any) {
    addLog('error', `Claude-only API call with Document failed: ${error.message}`);
    throw new Error('Bu metin için otomatik analiz başarısız oldu. Alternatif olarak metni bölüm bölüm yükleyebilir veya farklı bir formatta deneyebilirsiniz.');
  }
}

function validateModelConfigurations() {
  const allowedClaudeModels = ['claude-sonnet-4-6'];
  const allowedGeminiModels = ['gemini-3.5-flash', 'gemini-3.1-flash-lite'];
  
  const activeClaudeModel = 'claude-sonnet-4-6';
  const activeGeminiModel = 'gemini-3.5-flash';

  if (!allowedClaudeModels.includes(activeClaudeModel)) {
    throw new Error(`CRITICAL: Invalid Claude model configured: "${activeClaudeModel}". Allowed: ${allowedClaudeModels.join(', ')}`);
  }
  if (!allowedGeminiModels.includes(activeGeminiModel)) {
    throw new Error(`CRITICAL: Invalid Gemini model configured: "${activeGeminiModel}". Allowed: ${allowedGeminiModels.join(', ')}`);
  }
  
  console.log('Model configurations validated successfully. Active Claude model:', activeClaudeModel);
  addLog('info', `Model configurations validated successfully. Active Claude model: ${activeClaudeModel}`);
}

addLog('info', 'Zehir Bebek server starting...');
validateModelConfigurations();

// Ensure data and backup directories exist
const DATA_DIR = path.join(process.cwd(), 'src', 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// Server-side Safe Merge Helper: preserves fields that are omitted in partial updates, while respecting explicitly provided empty arrays
function serverSafeMergeProject(existing: any, incoming: any): any {
  if (!existing) return incoming;
  if (!incoming) return existing;

  const merged = { ...existing, ...incoming };

  const mergeArray = (key: string) => {
    if (key in incoming) {
      const incArr = incoming[key];
      if (Array.isArray(incArr)) {
        merged[key] = incArr;
        return;
      }
    }
    const extArr = existing[key];
    if (Array.isArray(extArr)) {
      merged[key] = extArr;
    }
  };

  const mergeObject = (key: string) => {
    if (key in incoming) {
      const incObj = incoming[key];
      if (incObj && typeof incObj === 'object') {
        merged[key] = incObj;
        return;
      }
    }
    const extObj = existing[key];
    if (extObj && typeof extObj === 'object') {
      merged[key] = extObj;
    }
  };

  // Merge Analysis
  if (existing.analysis || incoming.analysis) {
    const extAn = existing.analysis || {};
    const incAn = incoming.analysis || {};
    merged.analysis = {
      mekanlar: (incAn.mekanlar !== undefined && Array.isArray(incAn.mekanlar)) ? incAn.mekanlar : (extAn.mekanlar || []),
      gecisler: (incAn.gecisler !== undefined && Array.isArray(incAn.gecisler)) ? incAn.gecisler : (extAn.gecisler || []),
      olaylar: (incAn.olaylar !== undefined && Array.isArray(incAn.olaylar)) ? incAn.olaylar : (extAn.olaylar || []),
      aksesuarlar: (incAn.aksesuarlar !== undefined && Array.isArray(incAn.aksesuarlar)) ? incAn.aksesuarlar : (extAn.aksesuarlar || []),
      debug: incAn.debug || extAn.debug
    };
  }

  mergeArray('scenes');
  mergeArray('sceneBoundaries');
  mergeArray('presentationImages');
  mergeArray('technicalDrawings');
  mergeArray('placedProps');
  mergeArray('styleLibrary');
  mergeArray('movementEmotionData');
  mergeArray('narrativeBeats');
  mergeArray('symbolicAnalysis');
  mergeArray('symbolicMetaphors');
  mergeArray('sozselDilVersiyonlari');
  mergeArray('verbalLanguageHistory');

  mergeObject('productionPlanSummary');
  mergeObject('productionPlanDetailed');
  mergeObject('verbalLanguage');

  if (existing.scriptText && (!incoming.scriptText || incoming.scriptText.trim() === '')) {
    merged.scriptText = existing.scriptText;
  }
  if (existing.movementEmotionInstruction && (!incoming.movementEmotionInstruction || incoming.movementEmotionInstruction.trim() === '')) {
    merged.movementEmotionInstruction = existing.movementEmotionInstruction;
  }
  if (existing.symbolicInstruction && (!incoming.symbolicInstruction || incoming.symbolicInstruction.trim() === '')) {
    merged.symbolicInstruction = existing.symbolicInstruction;
  }

  return merged;
}

// Function to create timestamped backup
function createProjectsBackup() {
  try {
    if (fs.existsSync(PROJECTS_FILE)) {
      const content = fs.readFileSync(PROJECTS_FILE, 'utf-8');
      if (content.trim().length > 0) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(BACKUP_DIR, `projects_backup_${timestamp}.json`);
        fs.writeFileSync(backupPath, content, 'utf-8');

        // Retain only last 20 backups
        const backupFiles = fs.readdirSync(BACKUP_DIR)
          .filter(f => f.startsWith('projects_backup_') && f.endsWith('.json'))
          .sort()
          .reverse();

        if (backupFiles.length > 20) {
          const filesToDelete = backupFiles.slice(20);
          for (const f of filesToDelete) {
            try {
              fs.unlinkSync(path.join(BACKUP_DIR, f));
            } catch (e) {}
          }
        }
      }
    }
  } catch (err: any) {
    addLog('error', `Backup creation failed: ${err.message}`);
  }
}

// Enable JSON parser with large limit for file uploads
app.use(express.json({ limit: '50mb' }));

// 1. Projects persistence APIs
app.get('/api/projects', (req, res) => {
  try {
    if (fs.existsSync(PROJECTS_FILE)) {
      const data = fs.readFileSync(PROJECTS_FILE, 'utf-8');
      res.json(JSON.parse(data));
    } else {
      res.json([]);
    }
  } catch (error: any) {
    addLog('error', `Projects load error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/projects', (req, res) => {
  try {
    let incomingProjects = req.body;
    if (!Array.isArray(incomingProjects)) {
      return res.status(400).json({ error: 'Payload must be an array of projects' });
    }

    // Read existing file to perform safe merging & safety check
    let existingProjects: any[] = [];
    if (fs.existsSync(PROJECTS_FILE)) {
      try {
        const raw = fs.readFileSync(PROJECTS_FILE, 'utf-8');
        existingProjects = JSON.parse(raw);
      } catch (e) {}
    }

    // Safety guard: If server currently has non-empty projects list, but incoming is empty [], reject unless explicitly permitted
    const allowEmpty = req.query.allowEmpty === 'true';
    if (incomingProjects.length === 0 && existingProjects.length > 0 && !allowEmpty) {
      addLog('error', `[SAVED SAFETY REJECTED] Received empty projects payload while server holds ${existingProjects.length} projects.`);
      return res.status(400).json({ error: 'Boş proje verisi kaydedilemez.' });
    }

    // Perform safe merge for existing projects
    const existingMap = new Map<string, any>();
    existingProjects.forEach(p => existingMap.set(p.id, p));

    const mergedProjects = incomingProjects.map(inc => {
      const ext = existingMap.get(inc.id);
      if (ext) {
        return serverSafeMergeProject(ext, inc);
      }
      return inc;
    });

    // Take backup BEFORE write
    createProjectsBackup();

    // Atomic file write using temporary file
    const tempFile = PROJECTS_FILE + `.tmp_${Date.now()}`;
    const serialized = JSON.stringify(mergedProjects, null, 2);
    fs.writeFileSync(tempFile, serialized, 'utf-8');
    fs.renameSync(tempFile, PROJECTS_FILE);

    // Verification step: Read back written file and verify
    const verifyContent = fs.readFileSync(PROJECTS_FILE, 'utf-8');
    const verifyParsed = JSON.parse(verifyContent);

    if (!Array.isArray(verifyParsed) || verifyParsed.length !== mergedProjects.length) {
      throw new Error('Diske yazılan proje sayısı doğrulanamadı.');
    }

    // Log save details for each project (Requirement 3)
    verifyParsed.forEach((p: any) => {
      const hasAnalysis = p.analysis && (
        (p.analysis.mekanlar && p.analysis.mekanlar.length > 0) ||
        (p.analysis.gecisler && p.analysis.gecisler.length > 0) ||
        (p.analysis.olaylar && p.analysis.olaylar.length > 0) ||
        (p.analysis.aksesuarlar && p.analysis.aksesuarlar.length > 0)
      );
      addLog('info', `Proje kaydedildi: "${p.name}" (ID: ${p.id}), analiz verisi: ${hasAnalysis ? 'var' : 'yok'}, sahne sayısı: ${p.scenes?.length || 0}`);
    });

    res.json({ success: true, count: verifyParsed.length });
  } catch (error: any) {
    addLog('error', `Projects save error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Explicit DELETE single project API to eliminate race conditions & allow deleting the last project cleanly
app.delete('/api/projects/:id', (req, res) => {
  try {
    const projectId = req.params.id;
    let existingProjects: any[] = [];
    if (fs.existsSync(PROJECTS_FILE)) {
      try {
        const raw = fs.readFileSync(PROJECTS_FILE, 'utf-8');
        existingProjects = JSON.parse(raw);
      } catch (e) {}
    }

    const filtered = existingProjects.filter((p: any) => p.id !== projectId);
    
    // Take backup before delete
    createProjectsBackup();

    const tempFile = PROJECTS_FILE + `.tmp_${Date.now()}`;
    fs.writeFileSync(tempFile, JSON.stringify(filtered, null, 2), 'utf-8');
    fs.renameSync(tempFile, PROJECTS_FILE);

    addLog('info', `Proje silindi: ID: ${projectId}. Kalan proje sayısı: ${filtered.length}`);
    res.json({ success: true, count: filtered.length, projects: filtered });
  } catch (error: any) {
    addLog('error', `Project delete error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// GET Backups List API
app.get('/api/projects/backups', (req, res) => {
  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      return res.json([]);
    }

    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('projects_backup_') && f.endsWith('.json'))
      .sort()
      .reverse();

    const backupItems = files.map(file => {
      const fullPath = path.join(BACKUP_DIR, file);
      const stats = fs.statSync(fullPath);
      let projectsCount = 0;
      let projectNames: string[] = [];

      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          projectsCount = parsed.length;
          projectNames = parsed.map((p: any) => p.name || 'İsimsiz');
        }
      } catch (e) {}

      let formattedDate = stats.mtime.toLocaleString('tr-TR');

      return {
        filename: file,
        timestamp: stats.mtime.toISOString(),
        formattedDate,
        projectsCount,
        projectNames,
        sizeKb: (stats.size / 1024).toFixed(1)
      };
    });

    res.json(backupItems);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Restore Backup API
app.post('/api/projects/restore', (req, res) => {
  try {
    const { filename } = req.body;
    if (!filename || typeof filename !== 'string') {
      return res.status(400).json({ error: 'Geçersiz yedek dosya adı' });
    }

    const backupPath = path.join(BACKUP_DIR, path.basename(filename));
    if (!fs.existsSync(backupPath)) {
      return res.status(404).json({ error: 'Yedek dosyası bulunamadı' });
    }

    const backupContent = fs.readFileSync(backupPath, 'utf-8');
    const restoredProjects = JSON.parse(backupContent);

    // Take backup of current before overwriting with restored
    createProjectsBackup();

    // Atomic overwrite
    const tempFile = PROJECTS_FILE + `.tmp_${Date.now()}`;
    fs.writeFileSync(tempFile, backupContent, 'utf-8');
    fs.renameSync(tempFile, PROJECTS_FILE);

    addLog('info', `Yedek versiyon geri yüklendi: ${filename} (${restoredProjects.length} proje)`);
    res.json({ success: true, projects: restoredProjects });
  } catch (error: any) {
    addLog('error', `Backup restore error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 2. Logs API
app.get('/api/logs', (req, res) => {
  res.json(logs);
});

app.post('/api/logs', (req, res) => {
  try {
    const { level, message } = req.body;
    addLog(level || 'info', message || '');
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Clear Logs API
app.post('/api/logs/clear', (req, res) => {
  logs.length = 0;
  addLog('info', 'Logs cleared.');
  res.json({ success: true });
});

/**
 * Minimum characters a genuine text-layer page is expected to contribute.
 * Deliberately conservative — a sparse title page yields far less than a
 * dialogue page, and the only cost of guessing low is an unnecessary fallback.
 */
const MIN_CHARS_PER_PDF_PAGE = 150;

/**
 * Removes the "-- 3 of 77 --" separators pdf-parse emits for every page.
 *
 * On a scanned PDF these markers are nearly the entire output, which both
 * inflates the extracted length past any fixed threshold and pollutes the text
 * handed to the model.
 */
function stripPdfPageMarkers(text: string): string {
  if (!text) return '';
  return text
    .replace(/^[ \t]*--+\s*\d+\s+of\s+\d+\s*--+[ \t]*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getPdfPageCount(buffer: Buffer): number {
  try {
    const str = buffer.toString('binary');
    const pagesMatches = str.match(/\/Type\s*\/Pages[\s\S]*?\/Count\s+(\d+)/g);
    if (pagesMatches) {
      let maxCount = 0;
      for (const match of pagesMatches) {
        const countMatch = match.match(/\/Count\s+(\d+)/);
        if (countMatch) {
          const count = parseInt(countMatch[1], 10);
          if (count > maxCount) maxCount = count;
        }
      }
      if (maxCount > 0) return maxCount;
    }
    const pageMatches = str.match(/\/Type\s*\/Page\b/g);
    if (pageMatches) {
      return pageMatches.length;
    }
  } catch (err) {
    console.error('Error parsing PDF page count:', err);
  }
  return 1;
}

// 4. File Parsing API
app.post('/api/parse-file', async (req, res) => {
  try {
    const { fileName, fileType, fileData } = req.body;
    if (!fileData) {
      return res.status(400).json({ error: 'No file data received' });
    }

    addLog('info', `Received file upload: ${fileName} (${fileType})`);
    const buffer = Buffer.from(fileData, 'base64');
    let text = '';
    let pageCount = 1;

    if (fileName.endsWith('.docx') || fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
      addLog('info', `Word document processed successfully. Length: ${text.length} characters.`);
    } else if (fileName.endsWith('.pdf') || fileType === 'application/pdf') {
      addLog('info', 'Processing PDF document...');
      pageCount = getPdfPageCount(buffer);
      addLog('info', `PDF page count estimated: ${pageCount} pages. Upload size: ${(buffer.length / 1024).toFixed(1)} KB.`);

      // 1. Try local PDF extraction via pdf-parse first
      try {
        addLog('info', 'Attempting local PDF text extraction via pdf-parse...');
        const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        const pdfInstance = new pdf.PDFParse(uint8);
        const parsedPdf = await pdfInstance.getText();
        text = stripPdfPageMarkers(parsedPdf.text || '');
        addLog('info', `Local PDF text extraction completed. Length: ${text.trim().length} characters (page markers removed).`);
      } catch (localErr: any) {
        addLog('error', `Local PDF extraction failed: ${localErr.message}. Fallback to Claude document API will be attempted.`);
      }

      // 2. Decide whether the local extraction actually produced a usable script.
      //
      // A flat 100-character floor is not enough: a scanned 77-page PDF still
      // yields thousands of characters of page-marker boilerplate plus the odd
      // digital page, clearing the floor while containing almost none of the
      // script. Scale the expectation with the page count instead.
      const extractedLength = text ? text.trim().length : 0;
      const minimumExpectedLength = Math.max(100, pageCount * MIN_CHARS_PER_PDF_PAGE);

      if (extractedLength < minimumExpectedLength) {
        addLog(
          'info',
          `Local PDF extraction yielded ${extractedLength} characters for ${pageCount} pages ` +
          `(beklenen en az ${minimumExpectedLength}). Belge taranmış/görüntü tabanlı görünüyor — ` +
          'Claude Document API ile okuma deneniyor...'
        );
        const apiKey = (req.headers['x-anthropic-api-key'] as string) || process.env.ANTHROPIC_API_KEY;
        const systemInstruction = 'You are an expert play script reader and dramaturg. Your job is to extract the complete, raw script text from the uploaded PDF document verbatim, with all dialogue, character names, scene directions, and headers intact. Do not summarize, do not omit any scenes or lines, do not insert any introductory or concluding remarks. Just output the extracted Turkish script text exactly as written.';
        const promptText = 'Please extract the full verbatim text from this play script PDF document.';

        const localFallbackText = text;
        try {
          const claudeText = await callClaudeOnlyDocument(systemInstruction, promptText, fileData, apiKey);
          // Keep whichever extraction actually produced more of the script.
          if (claudeText && claudeText.trim().length >= localFallbackText.trim().length) {
            text = claudeText;
            addLog('info', `PDF document processed via Claude successfully. Extracted length: ${text.length} characters.`);
          } else {
            addLog('info', `Claude çıkarımı (${claudeText.trim().length} karakter) yerel çıkarımdan (${localFallbackText.trim().length} karakter) kısa kaldı; yerel metin korunuyor.`);
          }
        } catch (claudeErr: any) {
          addLog('error', `Claude document API fallback failed: ${claudeErr.message}`);
          // Don't throw away a partial local extraction just because the
          // fallback failed — a short script beats no script at all.
          if (localFallbackText.trim().length === 0) {
            throw new Error('Bu metin için otomatik analiz başarısız oldu. Alternatif olarak metni bölüm bölüm yükleyebilir veya farklı bir formatta deneyebilirsiniz.');
          }
          addLog('error', `Yerel çıkarımdan elde edilen ${localFallbackText.trim().length} karakterlik kısmi metinle devam ediliyor. Bu belge taranmış olabilir; metin eksik olabilir.`);
        }
      }

      const isLikelyIncomplete = text.trim().length < minimumExpectedLength;
      if (isLikelyIncomplete) {
        addLog('error', `UYARI: Çıkarılan metin ${pageCount} sayfalık belge için beklenenden kısa (${text.trim().length} karakter). Metin eksik olabilir.`);
      }

      res.json({
        text,
        pageCount,
        extractionWarning: isLikelyIncomplete
          ? `Bu ${pageCount} sayfalık belgeden yalnızca ${text.trim().length} karakter okunabildi. Belge taranmış (görüntü tabanlı) olabilir ve metin eksik olabilir.`
          : null
      });
      return;
    } else {
      // Fallback plain text
      text = buffer.toString('utf-8');
      addLog('info', `Plain text processed. Length: ${text.length} characters.`);
    }

    if (!text || text.trim().length === 0) {
      addLog('error', 'Extracted text is empty.');
      return res.status(400).json({ error: 'Extracted text is empty. Please upload a valid document.' });
    }

    res.json({ text, pageCount });
  } catch (error: any) {
    addLog('error', `File processing error: ${error.message}`);
    res.status(500).json({ error: `Dosya işleme hatası: ${error.message}` });
  }
});

// Zod schemas for Gemini call double validation
const LocationAnalysisSchema = z.object({
  mekanlar: z.array(z.object({
    ad: z.string(),
    tip: z.enum(['iç', 'dış', 'bilinmiyor']),
    donem: z.string(),
    atmosfer: z.string()
  })),
  gecisler: z.array(z.object({
    sahneNo: z.string(),
    mekanAd: z.string(),
    not: z.string()
  })),
  olaylar: z.array(z.object({
    sahneNo: z.string(),
    olay: z.string(),
    hareketPotansiyeli: z.string()
  }))
});

const AccessoryAnalysisSchema = z.object({
  aksesuarlar: z.array(z.object({
    ad: z.string(),
    kategori: z.enum(['dekor', 'aksesuar']),
    kaynakAlinti: z.string(),
    aciklama: z.string()
  }))
});

const CompleteAnalysisSchema = z.object({
  mekanlar: z.array(z.object({
    ad: z.string().default(''),
    tip: z.enum(['iç', 'dış', 'bilinmiyor']).catch('bilinmiyor'),
    donem: z.string().catch(''),
    atmosfer: z.string().catch(''),
    kaynakAlinti: z.string().catch('')
  })).catch([]),
  gecisler: z.array(z.object({
    sahneNo: z.string().default(''),
    mekanAd: z.string().default(''),
    not: z.string().catch('')
  })).catch([]),
  olaylar: z.array(z.object({
    sahneNo: z.string().default(''),
    olay: z.string().default(''),
    hareketPotansiyeli: z.string().catch(''),
    kaynakAlinti: z.string().catch('')
  })).catch([]),
  aksesuarlar: z.array(z.object({
    ad: z.string().default(''),
    kategori: z.enum(['dekor', 'aksesuar']).catch('aksesuar'),
    kaynakAlinti: z.string().catch(''),
    aciklama: z.string().catch(''),
    kullanildigiSahneler: z.array(z.string()).catch([])
  })).catch([])
});

// 5. Anthropic Claude API calls and Helpers
//
// claude-sonnet-4-6 allows up to 128K output tokens. The previous 8192 cap was
// roughly 6% of that and silently truncated long results: extracted scripts
// stopped mid-sentence and analysis JSON was cut off mid-array, surfacing as
// "Expected ',' or ']'" parse errors. max_tokens is only a ceiling — billing
// follows the tokens actually produced — so a generous limit costs nothing.
const CLAUDE_MAX_TOKENS_JSON = 16000;      // structured analysis responses
const CLAUDE_MAX_TOKENS_DOCUMENT = 64000;  // verbatim script extraction from PDFs

async function callClaudeAPI(
  systemInstruction: string,
  promptText: string,
  apiKey: string,
  maxTokens: number = CLAUDE_MAX_TOKENS_JSON
): Promise<string> {
  const url = 'https://api.anthropic.com/v1/messages';

  let retries = 3;
  let delayMs = 1000;
  let lastError: any = null;

  while (retries >= 0) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: maxTokens,
          system: systemInstruction,
          messages: [
            {
              role: 'user',
              content: promptText
            }
          ],
          temperature: 0.1
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        let parsedErr;
        try {
          parsedErr = JSON.parse(errorText);
        } catch {
          // Ignored
        }
        const errMsg = parsedErr?.error?.message || errorText || `HTTP ${response.status}`;
        
        // If it's a rate limit (429), temporary overload (529/503), or similar retryable error:
        const is429 = response.status === 429 || errMsg.toLowerCase().includes('rate limit');
        const isRetryable = is429 || response.status === 529 || response.status === 503 || errMsg.toLowerCase().includes('overloaded');
        if (isRetryable && retries > 0) {
          const currentDelay = is429 ? 30000 : delayMs;
          addLog('info', `Claude API call failed with retryable error (${errMsg}). Retrying in ${currentDelay}ms... (${retries} retries left)`);
          await new Promise(resolve => setTimeout(resolve, currentDelay));
          retries--;
          if (!is429) delayMs *= 2;
          continue;
        }
        throw new Error(`Claude API Error: ${errMsg}`);
      }

      const result = await response.json();
      if (!result.content || !result.content[0] || !result.content[0].text) {
        throw new Error('Claude API response structure is missing content text.');
      }

      const rawOutput = result.content[0].text;
      if (rawOutput && rawOutput.length > 3 * 1024 * 1024) { // 3MB limit
        addLog('error', `Claude response too large: ${rawOutput.length} characters.`);
        throw new Error('Analiz sonucu çok büyük, işlenemedi.');
      }

      if (result.stop_reason === 'max_tokens') {
        addLog('error', `UYARI: Claude yanıtı token sınırına takıldı (max_tokens=${maxTokens}, ${rawOutput.length} karakter). Çıktı eksik olabilir — JSON ayrıştırma hatası alırsanız sebebi budur.`);
      }

      console.log(`Claude çıktı uzunluğu: ${rawOutput.length} karakter (stop_reason: ${result.stop_reason})`);
      addLog('info', `Claude çıktı uzunluğu: ${rawOutput.length} karakter`);

      return cleanJsonResponse(rawOutput);
    } catch (err: any) {
      lastError = err;
      const errMsg = err.message || '';
      const isNetworkOrTimeout = errMsg.toLowerCase().includes('fetch') || errMsg.toLowerCase().includes('network') || errMsg.toLowerCase().includes('timeout');
      if (isNetworkOrTimeout && retries > 0) {
        addLog('info', `Claude API call failed with network/timeout error (${errMsg}). Retrying in ${delayMs}ms... (${retries} retries left)`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        retries--;
        delayMs *= 2;
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error('Claude API call failed after retries.');
}

async function callClaudeAPIWithDocument(
  systemInstruction: string,
  promptText: string,
  base64Pdf: string,
  apiKey: string
): Promise<string> {
  const url = 'https://api.anthropic.com/v1/messages';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'pdfs-2024-09-25'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: CLAUDE_MAX_TOKENS_DOCUMENT,
      system: systemInstruction,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: base64Pdf
              }
            },
            {
              type: 'text',
              text: promptText
            }
          ]
        }
      ],
      temperature: 0.1
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    let parsedErr;
    try {
      parsedErr = JSON.parse(errorText);
    } catch {
      // Ignored
    }
    const errMsg = parsedErr?.error?.message || errorText || `HTTP ${response.status}`;
    throw new Error(`Claude API Error: ${errMsg}`);
  }

  const result = await response.json();
  if (!result.content || !result.content[0] || !result.content[0].text) {
    throw new Error('Claude API response structure is missing content text.');
  }

  const rawOutput = result.content[0].text;
  if (rawOutput && rawOutput.length > 3 * 1024 * 1024) { // 3MB limit
    addLog('error', `Claude response too large: ${rawOutput.length} characters.`);
    throw new Error('Analiz sonucu çok büyük, işlenemedi.');
  }

  if (result.stop_reason === 'max_tokens') {
    addLog('error', `PDF metin çıkarma token sınırına takıldı (${rawOutput.length} karakter). Metnin sonu eksik olabilir.`);
  }

  console.log(`PDF metin çıkarma uzunluğu: ${rawOutput.length} karakter`);
  addLog('info', `PDF metin çıkarma uzunluğu: ${rawOutput.length} karakter`);

  // Deliberately NOT passing this through cleanJsonResponse(): this call
  // returns the raw script text, and that helper slices everything outside
  // the first '{' … last '}' and then runs jsonrepair over it — which
  // silently truncates or mangles ordinary prose.
  return rawOutput;
}

function escapeUnescapedQuotes(jsonStr: string): string {
  let result = '';
  let inString = false;
  let escapeNext = false;
  
  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];
    
    if (escapeNext) {
      result += char;
      escapeNext = false;
      continue;
    }
    
    if (char === '\\') {
      result += char;
      if (inString) {
        escapeNext = true;
      }
      continue;
    }
    
    if (char === '"') {
      if (!inString) {
        inString = true;
        result += char;
      } else {
        // We are in a string. Is this '"' the closing quote?
        // Look ahead to the next non-whitespace character.
        let nextNonWhitespace = '';
        let nextIdx = i + 1;
        while (nextIdx < jsonStr.length) {
          const nextChar = jsonStr[nextIdx];
          if (!/\s/.test(nextChar)) {
            nextNonWhitespace = nextChar;
            break;
          }
          nextIdx++;
        }
        
        // If the next non-whitespace char is one of: ':', ',', '}', ']'
        // then this is a valid closing quote.
        if ([':', ',', '}', ']'].includes(nextNonWhitespace)) {
          inString = false;
          result += char;
        } else {
          // It's an unescaped double quote inside the string!
          // Escape it as \"
          result += '\\"';
        }
      }
    } else {
      result += char;
    }
  }
  
  return result;
}

function cleanJsonResponse(text: string): string {
  let cleaned = text.trim();
  
  // Find first '{' and last '}' to extract raw JSON safely
  const startIdx = cleaned.indexOf('{');
  const endIdx = cleaned.lastIndexOf('}');
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    cleaned = cleaned.substring(startIdx, endIdx + 1);
  } else {
    // Fallback to strip markdown if present
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, '');
      if (cleaned.endsWith('```')) {
        cleaned = cleaned.slice(0, -3);
      }
    }
  }

  // Escape any unescaped quotes first
  cleaned = escapeUnescapedQuotes(cleaned);

  try {
    cleaned = jsonrepair(cleaned);
  } catch (repairErr: any) {
    console.warn('jsonrepair in cleanJsonResponse failed:', repairErr.message);
  }

  return cleaned.trim();
}

function robustJsonParse<T>(raw: string): T {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch (err1) {
    console.warn('Initial JSON parsing failed. Attempting repair with jsonrepair...', err1);
    addLog('info', 'Initial JSON parsing failed. Attempting repair with jsonrepair...');
    try {
      const repaired = jsonrepair(trimmed);
      return JSON.parse(repaired) as T;
    } catch (err2: any) {
      console.error('JSON repair failed too:', err2);
      addLog('error', `JSON repair failed: ${err2.message}`);
      throw new Error(`JSON ayrıştırma hatası: ${err2.message}`);
    }
  }
}

async function analyzeChunkOfScript(scriptText: string, scenes: any[], apiKey: string, previousSummary: string = '', analysisType?: string) {
  const scenesContext = scenes.length > 0 
    ? `\nMETİNDEKİ MEVCUT SAHNELER (Lütfen çıktıda sahneNo ve kullanildigiSahneler alanlarını bu listedeki sahne isimleriyle birebir doldurun): ${scenes.map(s => s.name).join(', ')}` 
    : '';

  const isMekanOlay = analysisType === 'mekan-olay';
  const isAksesuar = analysisType === 'aksesuar';

  let selectionInstruction = '';
  if (isMekanOlay) {
    selectionInstruction = `
GÖREV KAPSAMI: Sadece MEKANLAR, GEÇİŞLER ve OLAYLAR (mekanlar, gecisler, olaylar) tespiti yapın. 
'aksesuarlar' dizisini kesinlikle boş bırakın (yani "aksesuarlar": []).`;
  } else if (isAksesuar) {
    selectionInstruction = `
GÖREV KAPSAMI: Sadece DEKOR/AKSESUARLAR (aksesuarlar) tespiti yapın. 
'mekanlar', 'gecisler' ve 'olaylar' dizilerini kesinlikle boş bırakın (yani "mekanlar": [], "gecisler": [], "olaylar": []).`;
  }

  const systemInstruction = `You are an expert theater set designer, prop master and dramaturg.
Analyze the provided Turkish text (play, novel, story, etc.) as a whole.
Extract locations (mekanlar), location transitions (gecisler), narrative movement events (olaylar), and props/decor (aksesuarlar) as a unified JSON.
Respond in Turkish.
${selectionInstruction}

Bu analiz, kullanıcının sahiplik/lisans hakkına sahip olduğu bir eseri SAHNE UYARLAMASI için yapısal olarak incelemek amacıyla yapılıyor. Metni uzun alıntılarla yeniden üretme, sadece yapısal bilgiyi (mekan, obje, olay) kendi cümlelerinle çıkar.

Kullanıcı, bu edebi eserin YETKİLİ/RESMİ bir sahne uyarlaması projesi üzerinde çalışan bir sahne tasarımcısıdır. Uyarlama süreci devam etmektedir ve kullanıcı, dekor/sahne tasarımı hazırlığını önceden yapabilmek için eserin yapısal unsurlarını (mekan, obje, olay) analiz etmek istemektedir. Bu, yayımlanmış eseri çoğaltmak veya dağıtmak amacı taşımayan, mesleki/profesyonel bir dramaturji/tasarım analizi görevidir. Görevin SADECE yapısal metaveri (mekan listesi, obje listesi, olay listesi) üretmek, metnin kendisini hiçbir şekilde alıntılamamak veya yeniden üretmemektir.

Sana gönderilen metnin kim tarafından yazıldığı, yayımlanıp yayımlanmadığı seninle İLGİLİ DEĞİLDİR ve bu konuda hiçbir çıkarım yapmamalısın. Sadece istenen yapısal veri çıkarma görevini yap. Bu metnin kaynağını, yazarını veya yayın durumunu ASLA sorgulama, tanımaya çalışma, yorumlama.

CRITICAL GROUNDING & ACCURACY RULES:
1. Every single detected location ("mekanlar"), event ("olaylar"), and accessory ("aksesuarlar") MUST contain a mandatory "kaynakAlinti" field to verify the item is not fabricated.
2. "kaynakAlinti" is NOT required to be a long verbatim copy from the source text. Instead, for each item, provide either a short quote (less than 15 words) OR a brief "context summary / paraphrase" in your own words explaining where or how this item appears in the text (e.g., "3. bölümde, karakterin masasında duran bir objeden bahsediliyor" or "Giriş kısmında karakterlerin buluştuğu salon olarak geçiyor").
3. Do not make up items. Every element must be grounded in the text via this short reference or paraphrased context.
4. Apply this change consistently to both theater plays (tiyatro oyunları) and prose works (roman, hikaye, vb.) — treat all source types with this same logic.
5. "kullanildigiSahneler" must contain a list of scene names where the accessory is explicitly used, mentioned, or adapted.

Response MUST strictly match the following JSON structure and nothing else. DO NOT wrap response in markdown code blocks. Start with '{' and end with '}'.

JSON Schema structure:
{
  "mekanlar": [
    {
      "ad": "string",
      "tip": "iç" | "dış" | "bilinmiyor",
      "donem": "string",
      "atmosfer": "string",
      "kaynakAlinti": "string"
    }
  ],
  "gecisler": [
    {
      "sahneNo": "string",
      "mekanAd": "string",
      "not": "string"
    }
  ],
  "olaylar": [
    {
      "sahneNo": "string",
      "olay": "string",
      "hareketPotansiyeli": "string",
      "kaynakAlinti": "string"
    }
  ],
  "aksesuarlar": [
    {
      "ad": "string",
      "kategori": "dekor" | "aksesuar",
      "kaynakAlinti": "string",
      "aciklama": "string",
      "kullanildigiSahneler": ["string"]
    }
  ]
}`;

  const promptText = `Lütfen aşağıdaki metni (tiyatro oyunu, roman veya hikaye) analiz et.
${scenesContext}
${previousSummary}

METİN İÇERİĞİ:
${scriptText}

Lütfen yukarıdaki şablona göre JSON çıktısı üret.`;

  const rawOutput = await callClaudeOnlyText(systemInstruction, promptText, apiKey);
  
  let parsed;
  try {
    parsed = robustJsonParse<any>(rawOutput);
    parsed = CompleteAnalysisSchema.parse(parsed);
  } catch (err: any) {
    addLog('error', `Unified script analysis validation failure: ${err.message}. Raw output preview: ${rawOutput.substring(0, 500)}`);
    throw new Error(`Yapısal doğrulama hatası (Zod): ${err.message}`);
  }

  // GROUNDING: Ensure "kaynakAlinti" has context or reference; provide fallback if missing
  const verifiedMekanlar = (parsed.mekanlar || []).map((m: any) => ({
    ...m,
    id: Math.random().toString(36).substring(2, 9),
    kaynakAlinti: (m.kaynakAlinti && m.kaynakAlinti.trim()) ? m.kaynakAlinti.trim() : (m.atmosfer || m.donem || 'Metin bağlamından tespit edildi')
  }));

  const verifiedOlaylar = (parsed.olaylar || []).map((o: any) => ({
    ...o,
    id: Math.random().toString(36).substring(2, 9),
    kaynakAlinti: (o.kaynakAlinti && o.kaynakAlinti.trim()) ? o.kaynakAlinti.trim() : (o.hareketPotansiyeli || 'Metin akışından tespit edildi')
  }));

  const verifiedAksesuarlar = (parsed.aksesuarlar || []).map((a: any) => ({
    ...a,
    id: Math.random().toString(36).substring(2, 9),
    status: '',
    kullanildigiSahneler: a.kullanildigiSahneler || [],
    kaynakAlinti: (a.kaynakAlinti && a.kaynakAlinti.trim()) ? a.kaynakAlinti.trim() : (a.aciklama || 'Metin bağlamından tespit edildi')
  }));

  const mappedGecisler = (parsed.gecisler || []).map((g: any) => ({
    ...g,
    id: Math.random().toString(36).substring(2, 9)
  }));

  return {
    mekanlar: verifiedMekanlar,
    gecisler: mappedGecisler,
    olaylar: verifiedOlaylar,
    aksesuarlar: verifiedAksesuarlar,
    debug: {
      timestamp: new Date().toISOString(),
      rawCall: parsed
    }
  };
}

app.post('/api/detect-narrative-beats', async (req, res) => {
  try {
    const { scriptText } = req.body;
    if (!scriptText) {
      return res.status(400).json({ error: 'Script text is required' });
    }

    const apiKey = (req.headers['x-anthropic-api-key'] as string) || process.env.ANTHROPIC_API_KEY;
    const hasClaudeKey = apiKey && apiKey !== 'MY_ANTHROPIC_API_KEY' && apiKey.trim() !== '';

    const promptText = `Aşağıdaki metin bir düzyazı (roman/hikaye) örneğidir ve fiziksel sahne/bölüm başlıkları içermemektedir.
Sen bir dramaturg gibi davranarak, metni doğal dramatik/anlatısal birimlere ayır. En az 5, en fazla 15 birim olacak şekilde mantıklı bir bölünme yap — çok az birim (2-3) grafik/analiz için yetersiz kalır, çok fazla birim (30+) gereksiz parçalanmaya yol açar.

Bir "birim", mekan değişimi, zaman atlaması, duygusal/dramatik bir dönüm noktası veya yeni bir karakterin/olayın girişiyle başlayan doğal bir kesit olsun — fiziksel bir başlık değil, İÇERİĞE dayalı bir bölünme.

Her anlatı birimi için:
1. Kısa, açıklayıcı bir Türkçe başlık (örn. "Karakterin eve dönüşü", "Geçmişe dönüş anısı", "Beklenmedik karşılaşma")
2. Kısa bir açıklama (description)
3. Bu birimin metnin kabaca neresine denk geldiğini belirten başlangıç yüzdesi (startPercentage, 0-100 arası tamsayı) ve bitiş yüzdesi (endPercentage, 0-100 arası tamsayı).
Yüzdeler ardışık olmalıdır (yani bir sonrakinin startPercentage değeri bir öncekinin endPercentage değerine eşit olmalıdır. İlk birim 0 ile başlamalı, son birim 100 ile bitmelidir).

Lütfen sonucu şu JSON formatında döndür. Çıktı sadece bu geçerli JSON olmalı, markdown kod bloğuna ALMA.
{
  "beats": [
    {
      "name": "Birim Başlığı",
      "description": "Açıklama...",
      "startPercentage": 0,
      "endPercentage": 15
    }
  ]
}

ANALİZ EDİLECEK METİN:
${scriptText.substring(0, 150000)}
`;

    let responseText = '';
    if (hasClaudeKey) {
      addLog('info', 'Analyzing prose narrative beats via Claude...');
      const systemInstruction = 'You are an expert play script reader, dramaturg and novel analyzer. You must analyze the text and partition it into narrative beats. Output ONLY valid JSON.';
      responseText = await callClaudeAPI(systemInstruction, promptText, apiKey);
    } else {
      addLog('info', 'Analyzing prose narrative beats via Gemini...');
      const response = await generateContentWithRetry({
        model: 'gemini-3.5-flash',
        contents: promptText,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              beats: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    description: { type: Type.STRING },
                    startPercentage: { type: Type.INTEGER },
                    endPercentage: { type: Type.INTEGER }
                  },
                  required: ["name", "description", "startPercentage", "endPercentage"]
                }
              }
            },
            required: ["beats"]
          }
        }
      });
      responseText = response.text || '{}';
    }

    const parsed = robustJsonParse<any>(responseText.trim());
    if (parsed && Array.isArray(parsed.beats)) {
      res.json({ beats: parsed.beats });
    } else {
      throw new Error('Geçerli anlatı birimleri listesi alınamadı.');
    }
  } catch (error: any) {
    console.error('Narrative beat detection error:', error);
    res.status(500).json({ error: `Anlatı birimleri çıkartılırken hata oluştu: ${error.message}` });
  }
});

app.post('/api/analyze-script', async (req, res) => {
  try {
    const { scriptText, scenes, analysisType } = req.body;
    if (!scriptText) {
      return res.status(400).json({ error: 'Script text is required' });
    }

    const apiKey = (req.headers['x-anthropic-api-key'] as string) || process.env.ANTHROPIC_API_KEY;

    const charCount = scriptText.length;
    console.log(`[Script Analysis] Character count: ${charCount}, analysisType: ${analysisType}`);
    addLog('info', `Starting script analysis. Character count: ${charCount}, analysisType: ${analysisType}`);

    let finalMekanlar: any[] = [];
    let finalGecisler: any[] = [];
    let finalOlaylar: any[] = [];
    let finalAksesuarlar: any[] = [];

    if (charCount <= 30000) {
      addLog('info', 'Character count is <= 30000. Analyzing as a single text block.');
      const result = await analyzeChunkOfScript(scriptText, scenes || [], apiKey, '', analysisType);
      finalMekanlar = result.mekanlar;
      finalGecisler = result.gecisler;
      finalOlaylar = result.olaylar;
      finalAksesuarlar = result.aksesuarlar;
    } else {
      addLog('info', 'Character count > 30000. Partitioning dynamically by Perde (Acts) or safe character limits.');
      const scList = scenes || [];
      const perdeGroups: { name: string; scenes: any[] }[] = [];

      if (scList.length === 0) {
        // Fallback: If no scenes list, split text into chunks of 25,000 characters
        let startIdx = 0;
        let chunkIdx = 1;
        while (startIdx < scriptText.length) {
          const chunkText = scriptText.substring(startIdx, startIdx + 25000);
          perdeGroups.push({
            name: `Bölüm ${chunkIdx}`,
            scenes: [{ name: `Kısım ${chunkIdx}`, content: chunkText }]
          });
          startIdx += 25000;
          chunkIdx++;
        }
        addLog('info', `No scenes list provided. Split script text into ${perdeGroups.length} static chunks.`);
      } else {
        // Group scenes dynamically by acts (explicit perde keywords or safe length limit)
        let currentGroup = { name: 'Perde 1', scenes: [] as any[] };
        let currentLength = 0;
        let groupCounter = 1;

        scList.forEach((sc: any, idx: number) => {
          const nameLower = (sc.name || '').toLowerCase();
          const contentLen = (sc.content || '').length;

          // Check if this scene explicitly starts a new Perde/Act/Bölüm/Tablo (after the first scene)
          const isExplicitNewAct = idx > 0 && (
            nameLower.includes('perde') || 
            nameLower.includes('bölüm') || 
            nameLower.includes('tablo') || 
            nameLower.includes('act')
          );

          // Or if adding this scene would make the current chunk exceed 25,000 characters
          const isTooLarge = currentLength + contentLen > 25000 && currentGroup.scenes.length > 0;

          if (isExplicitNewAct || isTooLarge) {
            perdeGroups.push(currentGroup);
            groupCounter++;
            currentGroup = { name: `Perde ${groupCounter}`, scenes: [sc] };
            currentLength = contentLen;
          } else {
            currentGroup.scenes.push(sc);
            currentLength += contentLen;
          }
        });
        if (currentGroup.scenes.length > 0) {
          perdeGroups.push(currentGroup);
        }
        addLog('info', `Grouped ${scList.length} scenes into ${perdeGroups.length} acts/chunks.`);
      }

      // Analyze each act/group in parallel to stay well within 5-minute timeout
      addLog('info', `Starting parallel analysis for ${perdeGroups.length} acts/chunks...`);
      const chunkPromises = perdeGroups.map(async (group, idx) => {
        const groupText = group.scenes.map(s => `\n--- ${s.name} ---\n${s.content}`).join('\n');
        addLog('info', `Queueing chunk ${idx + 1}/${perdeGroups.length}: ${group.name} (${group.scenes.length} scenes, ${groupText.length} chars)`);
        
        // Pass a context note about other acts
        const otherGroupsNames = perdeGroups.filter((_, gIdx) => gIdx !== idx).map(g => g.name).join(', ');
        const parallelContext = otherGroupsNames 
          ? `\nNot: Bu metin büyük bir eserin parçasıdır. Diğer bölümler/perdeler: ${otherGroupsNames}. Lütfen bu bölümdeki mekan, olay ve aksesuarları kendi özgün adlarıyla tespit edin. Diğer bölümlerle tutarlı ve uyumlu isimler kullanmaya özen gösterin.`
          : '';

        const resChunk = await analyzeChunkOfScript(groupText, group.scenes, apiKey, parallelContext, analysisType);
        return resChunk;
      });

      const chunkResults = await Promise.all(chunkPromises);

      for (const resChunk of chunkResults) {
        finalMekanlar.push(...resChunk.mekanlar);
        finalGecisler.push(...resChunk.gecisler);
        finalOlaylar.push(...resChunk.olaylar);
        finalAksesuarlar.push(...resChunk.aksesuarlar);
      }
    }

    // De-duplicate Mekanlar
    const deDuplicatedMekanlar: any[] = [];
    const seenMekanNames = new Set<string>();
    for (const m of finalMekanlar) {
      const norm = m.ad.trim().toLowerCase();
      if (!seenMekanNames.has(norm)) {
        seenMekanNames.add(norm);
        deDuplicatedMekanlar.push(m);
      }
    }

    // De-duplicate Aksesuarlar
    const deDuplicatedAksesuarlar: any[] = [];
    const seenAksNames = new Map<string, any>();
    for (const a of finalAksesuarlar) {
      const norm = a.ad.trim().toLowerCase();
      if (seenAksNames.has(norm)) {
        const existing = seenAksNames.get(norm);
        const mergedScenes = Array.from(new Set([...(existing.kullanildigiSahneler || []), ...(a.kullanildigiSahneler || [])]));
        existing.kullanildigiSahneler = mergedScenes;
      } else {
        seenAksNames.set(norm, a);
        deDuplicatedAksesuarlar.push(a);
      }
    }

    const responsePayload = {
      mekanlar: deDuplicatedMekanlar,
      gecisler: finalGecisler,
      olaylar: finalOlaylar,
      aksesuarlar: deDuplicatedAksesuarlar,
    };

    const responsePayloadString = JSON.stringify(responsePayload);
    if (responsePayloadString.length > 10 * 1024 * 1024) { // 10MB limit
      addLog('error', `Aggregated script analysis response too large: ${responsePayloadString.length} bytes.`);
      throw new Error('Analiz sonucu çok büyük, işlenemedi.');
    }

    res.json(responsePayload);
  } catch (error: any) {
    console.error('Script analysis error:', error);
    addLog('error', `Script analysis error: ${error.message}\nStack trace: ${error.stack}`);
    res.status(500).json({ error: `Metin analizi sırasında hata oluştu: ${error.message}` });
  }
});

app.post('/api/analyze-scene', async (req, res) => {
  try {
    const { sceneText, sceneName } = req.body;
    if (!sceneText) {
      return res.status(400).json({ error: 'Scene text is required' });
    }

    const apiKey = (req.headers['x-anthropic-api-key'] as string) || process.env.ANTHROPIC_API_KEY;

    addLog('info', `Starting focused analysis for scene: "${sceneName}"`);

    const result = await analyzeChunkOfScript(sceneText, [{ name: sceneName, content: sceneText }], apiKey);

    // Adapt accessory scene names to ensure it has sceneName
    const processedAccessories = result.aksesuarlar.map((a: any) => ({
      ...a,
      kullanildigiSahneler: a.kullanildigiSahneler && a.kullanildigiSahneler.length > 0 ? a.kullanildigiSahneler : [sceneName]
    }));

    res.json({
      mekanlar: result.mekanlar,
      gecisler: result.gecisler,
      olaylar: result.olaylar,
      aksesuarlar: processedAccessories,
      debug: {
        [sceneName]: {
          timestamp: new Date().toISOString(),
          sceneName,
          analyzedByUnified: false
        }
      }
    });
  } catch (error: any) {
    console.error('Scene analysis error:', error);
    addLog('error', `Scene analysis error: ${error.message}\nStack trace: ${error.stack}`);
    res.status(500).json({ error: `Analiz sırasında hata oluştu: ${error.message}` });
  }
});

// 6. Correction Instruction API (updates existing tables)
app.post('/api/correct-table', async (req, res) => {
  try {
    const { tableType, currentData, instruction, sceneText } = req.body;
    if (!instruction || !tableType) {
      return res.status(400).json({ error: 'tableType and instruction are required' });
    }

    const apiKey = (req.headers['x-anthropic-api-key'] as string) || process.env.ANTHROPIC_API_KEY;

    addLog('info', `Applying AI correction instruction for table "${tableType}": "${instruction}"`);

    let systemInstruction = '';

    if (tableType === 'mekanlar') {
      systemInstruction = `You are a theater design and dramaturg expert.
You are given the original script, the current JSON list of locations, and a correction instruction from the director.
Update the list of locations according to the instruction.
Ensure each item contains: "ad", "tip" ("iç", "dış", "bilinmiyor"), "donem", "atmosfer".
Respond in Turkish.
The output must strictly match the following JSON structure and nothing else.
DO NOT wrap the output in markdown, do not write prefaces or explanations. Start with '{' and end with '}'.

JSON Schema structure:
{
  "data": [
    {
      "ad": "string",
      "tip": "iç" | "dış" | "bilinmiyor",
      "donem": "string",
      "atmosfer": "string"
    }
  ]
}`;
    } else if (tableType === 'gecisler') {
      systemInstruction = `You are a theater design and dramaturg expert.
You are given the original script, the current JSON list of scene transitions, and a correction instruction.
Update the transition list according to the instruction.
Ensure each item contains: "sahneNo", "mekanAd", "not".
Respond in Turkish.
The output must strictly match the following JSON structure and nothing else.
DO NOT wrap the output in markdown, do not write prefaces or explanations. Start with '{' and end with '}'.

JSON Schema structure:
{
  "data": [
    {
      "sahneNo": "string",
      "mekanAd": "string",
      "not": "string"
    }
  ]
}`;
    } else if (tableType === 'olaylar') {
      systemInstruction = `You are a theater design and dramaturg expert.
You are given the original script, the current JSON list of narrative movement events, and a correction instruction.
Update the list of events according to the instruction.
Ensure each item contains: "sahneNo", "olay", "hareketPotansiyeli".
Respond in Turkish.
The output must strictly match the following JSON structure and nothing else.
DO NOT wrap the output in markdown, do not write prefaces or explanations. Start with '{' and end with '}'.

JSON Schema structure:
{
  "data": [
    {
      "sahneNo": "string",
      "olay": "string",
      "hareketPotansiyeli": "string"
    }
  ]
}`;
    } else if (tableType === 'aksesuarlar') {
      systemInstruction = `You are a theater prop master and dramaturg expert.
You are given the original script or prose text, the current JSON list of props/decorations, and a correction instruction.
Update the prop list according to the instruction.

Bu analiz, kullanıcının sahiplik/lisans hakkına sahip olduğu bir eseri SAHNE UYARLAMASI için yapısal olarak incelemek amacıyla yapılıyor. Metni uzun alıntılarla yeniden üretme, sadece yapısal bilgiyi (mekan, obje, olay) kendi cümlelerinle çıkar.

Kullanıcı, bu edebi eserin YETKİLİ/RESMİ bir sahne uyarlaması projesi üzerinde çalışan bir sahne tasarımcısıdır. Uyarlama süreci devam etmektedir ve kullanıcı, dekor/sahne tasarımı hazırlığını önceden yapabilmek için eserin yapısal unsurlarını (mekan, obje, olay) analiz etmek istemektedir. Bu, yayımlanmış eseri çoğaltmak veya dağıtmak amacı taşımayan, mesleki/profesyonel bir dramaturji/tasarım analizi görevidir. Görevin SADECE yapısal metaveri (mekan listesi, obje listesi, olay listesi) üretmek, metnin kendisini hiçbir şekilde alıntılamamak veya yeniden üretmemektir.

Sana gönderilen metnin kim tarafından yazıldığı, yayımlanıp yayımlanmadığı seninle İLGİLİ DEĞİLDİR ve bu konuda hiçbir çıkarım yapmamalısın. Sadece istenen yapısal veri çıkarma görevini yap. Bu metnin kaynağını, yazarını veya yayın durumunu ASLA sorgulama, tanımaya çalışma, yorumlama.

Ensure each item contains: "ad", "kategori" ("dekor", "aksesuar"), "kaynakAlinti", "aciklama".
"kaynakAlinti" is NOT required to be a long verbatim copy from the source text. Instead, for each item, provide either a short quote (less than 15 words) OR a brief "context summary / paraphrase" in your own words explaining where or how this item appears in the text (e.g., "3. bölümde, karakterin masasında duran bir objeden bahsediliyor" or "Giriş kısmında karakterlerin buluştuğu salon olarak geçiyor").
Only add props grounded in the text or correction, and keep references/context summaries in "kaynakAlinti".
Respond in Turkish.
The output must strictly match the following JSON structure and nothing else.
DO NOT wrap the output in markdown, do not write prefaces or explanations. Start with '{' and end with '}'.

JSON Schema structure:
{
  "data": [
    {
      "ad": "string",
      "kategori": "dekor" | "aksesuar",
      "kaynakAlinti": "string",
      "aciklama": "string"
    }
  ]
}`;
    }

    const promptText = `
ORIGINAL SCRIPT:
${sceneText || 'No script text provided'}

CURRENT TABLE DATA (JSON):
${JSON.stringify(currentData, null, 2)}

CORRECTION INSTRUCTION:
${instruction}

Please output the updated list. Maintain existing elements and fields unless instructed to remove/change them.`;

    const rawOutput = await callClaudeOnlyText(systemInstruction, promptText, apiKey);
    const outputJson = robustJsonParse<any>(rawOutput);
    const updatedList = outputJson.data;

    // Perform list diffing to identify eklendi (green) and çıkarıldı (red)
    let finalDiffed: any[] = [];

    if (tableType === 'mekanlar') {
      finalDiffed = diffLists(currentData, updatedList, 'ad');
    } else if (tableType === 'olaylar') {
      finalDiffed = diffLists(currentData, updatedList, 'olay');
    } else if (tableType === 'gecisler') {
      finalDiffed = diffLists(currentData, updatedList, 'not');
    } else if (tableType === 'aksesuarlar') {
      const sanitizedAks = updatedList.map((item: any) => ({
        ...item,
        kaynakAlinti: (item.kaynakAlinti && item.kaynakAlinti.trim()) ? item.kaynakAlinti.trim() : (item.aciklama || 'Düzeltme ile eklendi')
      }));
      finalDiffed = diffLists(currentData, sanitizedAks, 'ad');
    }

    addLog('info', `Correction applied successfully using Claude. Items in diff: ${finalDiffed.length}`);
    res.json({ data: finalDiffed, rawOutput: updatedList });
  } catch (error: any) {
    console.error('Table correction error:', error);
    addLog('error', `Table correction error: ${error.message}\nStack trace: ${error.stack}`);
    res.status(500).json({ error: `Düzeltme uygulanırken hata oluştu: ${error.message}` });
  }
});

// Helper for list diffing
function diffLists(oldList: any[], newList: any[], keyField: string): any[] {
  const result: any[] = [];
  const processedNewKeys = new Set<string>();

  // Find kept or added items
  for (const newItem of newList) {
    const keyVal = newItem[keyField]?.trim().toLowerCase();
    const oldItem = oldList.find(o => o[keyField]?.trim().toLowerCase() === keyVal);

    if (oldItem) {
      // Item kept. Retain its existing id, and preserve user selections
      result.push({
        ...oldItem,
        ...newItem, // take updated descriptions
        changed: null // normal state
      });
      processedNewKeys.add(keyVal);
    } else {
      // Item is brand new
      result.push({
        ...newItem,
        id: Math.random().toString(36).substring(2, 9),
        changed: 'added',
        status: newItem.status || '', // default empty status
        kullanildigiSahneler: newItem.kullanildigiSahneler || []
      });
    }
  }

  // Find removed items
  for (const oldItem of oldList) {
    const keyVal = oldItem[keyField]?.trim().toLowerCase();
    const isPresentInNew = newList.some(n => n[keyField]?.trim().toLowerCase() === keyVal);
    if (!isPresentInNew) {
      result.push({
        ...oldItem,
        changed: 'removed'
      });
    }
  }

  return result;
}

// 7. Presentation & Technical Drawing Generation APIs
app.post('/api/generate-verbal', async (req, res) => {
  try {
    const { project, instruction } = req.body;
    const ai = getGeminiClient();
    
    const analysis = project?.analysis;
    const symbolicCtx = project?.symbolicAnalysis 
      ? `\nSembolik/Alt Metin Analizi: ${JSON.stringify(project.symbolicAnalysis)}
Tekrar Eden Benzetmeler: ${JSON.stringify(project.symbolicMetaphors || [])}`
      : '';
    const projectSummary = `Proje: ${project?.name || ''}, Ölçüler: ${project?.width || 0}mx${project?.length || 0}mx${project?.height || 0}m.${symbolicCtx}
Mekanlar: ${JSON.stringify(analysis?.mekanlar || [])}
Aksesuarlar/Dekor: ${JSON.stringify(analysis?.aksesuarlar || [])}`;

    addLog('info', `Generating Verbal Language with Gemini. Instruction: "${instruction || 'None'}"`);
    
    const systemInstruction = `You are a professional theater copywriter and director, expert in scenic design and dramaturgy.
Your job is to write a striking conceptual headline (sentence or phrase) and a 2-3 sentence deep artistic narrative explaining the stage design philosophy, dramatic conflict, and atmosphere.
Always respond in Turkish.
If a director correction instruction is provided, strictly follow its requested tones and preferences (e.g., "darker tone", "more minimalist") to generate the updated version.
Your entire output must be a clean, valid JSON matching the specified schema. Do not enclose it in markdown code blocks, do not include any preface or explanation. Only return raw JSON.`;

    const promptText = `PROJE DETAYLARI:
${projectSummary}

YÖNETMEN DÜZELTME TALİMATI:
${instruction || 'Düzeltme talimatı yok. Genel tasarım felsefesine uygun en vurucu başlığı ve anlatımı üretin.'}`;

    const response = await generateContentWithRetry({
      model: 'gemini-3.5-flash',
      contents: promptText,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.7,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            headline: { type: Type.STRING },
            narrative: { type: Type.STRING }
          },
          required: ["headline", "narrative"]
        }
      }
    });

    const parsed = robustJsonParse<any>(response.text || '{}');
    res.json(parsed);
  } catch (error: any) {
    console.error('Verbal generation error:', error);
    addLog('error', `Verbal generation error: ${error.message}\nStack trace: ${error.stack}`);
    res.status(500).json({ error: `Sözsel dil üretilirken hata oluştu: ${error.message}` });
  }
});

app.post('/api/generate-rationale', async (req, res) => {
  try {
    const { imageTitle, sceneId, itemDescription, project } = req.body;
    const ai = getGeminiClient();

    addLog('info', `Generating Rationale with Gemini for image: "${imageTitle}"`);
    
    const systemInstruction = `You are a professional theater set designer and art director.
Write a 2-sentence professional rationale/artistic justification explaining how this decor image contributes to the play's dramaturgical structure, atmosphere, and stage setup.
Your sentences must use theatrical art and scenic design terms, be highly convincing, and persuade the director's team.
Always respond in Turkish.
Your output must be a clean, valid JSON matching the specified schema. Do not include markdown blocks or prefaces.`;

    const promptText = `PROJE: ${project?.name || ''}
GÖRSEL BAŞLIĞI: ${imageTitle}
MEKAN / SAHNE BİLGİSİ: ${sceneId || 'Genel Sahneleme'}
ÖĞE DETAYLARI: ${itemDescription || ''}`;

    const response = await generateContentWithRetry({
      model: 'gemini-3.5-flash',
      contents: promptText,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.7,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            description: { type: Type.STRING }
          },
          required: ["description"]
        }
      }
    });

    const parsed = robustJsonParse<any>(response.text || '{}');
    res.json(parsed);
  } catch (error: any) {
    console.error('Rationale generation error:', error);
    addLog('error', `Rationale generation error: ${error.message}\nStack trace: ${error.stack}`);
    res.status(500).json({ error: `Açıklama üretilirken hata oluştu: ${error.message}` });
  }
});

app.post('/api/analyze-image', async (req, res) => {
  try {
    const { image, imageName, project } = req.body;
    
    if (!image) {
      throw new Error('Analiz edilecek görsel verisi bulunamadı.');
    }

    addLog('info', `Görsel analiz çağrısı başlatıldı: Endpoint = "/api/analyze-image", Model = "gemini-3.1-flash-lite"`);

    let rawBase64 = image;
    let mimeType = 'image/png';

    if (image.includes('base64,')) {
      rawBase64 = image.split('base64,')[1];
      mimeType = image.split(';')[0].split(':')[1] || 'image/png';
    }

    const systemInstruction = `You are an expert theater set designer, stage director, and art historian.
Analyze this uploaded stage/decor reference image and suggest:
1. A descriptive artistic title (e.g., "Neo-noir Sokak Lambası", "Endüstriyel Paslı Metal Kiriş") in Turkish.
2. A professional artistic rationale (2 sentences) in Turkish explaining how this scenery/prop contributes to the play's dramaturgical structure, atmosphere, and mood. Use rich stage design terminology.
3. If possible, associate this image with one of the scenes/boundaries or locations of the play, or default to general staging.

Always respond in Turkish. Your output must be a clean, valid JSON matching the specified schema. Do not include markdown blocks or prefaces.`;

    const sceneOptions = Array.from(new Set([
      ...(project?.scenes || []).map((s: any) => s.name),
      ...(project?.sceneBoundaries || []).map((b: any) => b.name),
      ...(project?.analysis?.mekanlar || []).map((m: any) => m.ad)
    ]));

    const promptText = `PROJE ADI: ${project?.name || ''}
DOSYA ADI: ${imageName || ''}
MEVCUT SAHNE SEÇENEKLERİ: ${sceneOptions.join(', ')}`;

    const imagePart = {
      inlineData: {
        mimeType: mimeType,
        data: rawBase64
      }
    };

    const textPart = {
      text: promptText
    };

    const response = await generateContentWithRetry({
      model: 'gemini-3.1-flash-lite',
      contents: { parts: [imagePart, textPart] },
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.7,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            sceneId: { type: Type.STRING }
          },
          required: ["title", "description", "sceneId"]
        }
      }
    });

    const parsed = robustJsonParse<any>(response.text || '{}');
    addLog('info', `Görsel analiz çağrısı başarıyla tamamlandı: "${imageName}" için başlık ve gerekçe üretildi.`);
    res.json(parsed);
  } catch (error: any) {
    console.error('Görsel analiz hatası:', error);
    addLog('error', `Görsel analiz hatası: ${error.message}\nStack trace: ${error.stack}`);
    res.status(500).json({ error: `Görsel analiz edilirken hata oluştu: ${error.message}` });
  }
});

app.post('/api/enhance-technical', async (req, res) => {
  try {
    const { style, project, drawingTitle, image } = req.body;

    const width = project?.width || 10;
    const length = project?.length || 8;
    const height = project?.height || 4;

    let enhancedImageBase64 = image;

    if (image && image.includes('base64,')) {
      try {
        const rawBase64 = image.split('base64,')[1];
        const mimeType = image.split(';')[0].split(':')[1] || 'image/png';

        addLog('info', `Attempting image enhancement via gemini-3.1-flash-lite. Style: ${style}`);

        const promptText = `This is a hand-drawn theatrical set sketch. Redraw and refine this sketch into a highly professional, sharp technical set design drawing.
Style requirement: ${style === 'simple' ? 'clean monochrome contour line-art CAD mockup' : style === 'scaled' ? 'blue grid blueprint schematic section' : style === 'labeled' ? 'labeled CAD blueprint layout' : 'style reference matched design'}.
The stage dimensions are: Width: ${width}m, Length: ${length}m, Height: ${height}m.
Crucial directive: Automatically overlay precise metric dimension labels (e.g., "${width}m", "${length}m", "${height}m") onto the drawing boundaries as metric notation. Make all lines straight, crisp and precise.`;

        const imagePart = {
          inlineData: {
            mimeType: mimeType,
            data: rawBase64
          }
        };

        const textPart = {
          text: promptText
        };

        const imageResponse = await generateContentWithRetry({
          model: 'gemini-3.1-flash-lite',
          contents: { parts: [imagePart, textPart] }
        });

        if (imageResponse?.candidates?.[0]?.content?.parts) {
          for (const part of imageResponse.candidates[0].content.parts) {
            if (part.inlineData) {
              enhancedImageBase64 = `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
              addLog('info', `Successfully enhanced drawing image with Gemini.`);
              break;
            }
          }
        }
      } catch (imageErr: any) {
        addLog('error', `Gemini image edit failed: ${imageErr.message}. Falling back to original image with enhanced styling.`);
      }
    }

    addLog('info', `Enhancing technical notes with Gemini for style: "${style}"`);
    const systemInstruction = `You are a professional theatrical stage draftsman and set manufacturing chef.
Your job is to generate highly realistic, professional 4-5 bulleted material and construction notes for manufacturing, based on the overall play atmosphere and physical stage dimensions (width, length, height).
Focus areas should shift based on the selected "style" parameter:
- "reference": Material and manufacturing notes tailored to match global style references.
- "simple": Clean line draft; clean assembly, demountable structure, and basic construction notes.
- "scaled": Scaled plan-section; precise dimensions, elevation heights, and material labels.
- "labeled": Labeled-notation; detailed manufacturing materials, coating types, and fire-rating details.
Always respond in Turkish.
Your output must be a clean, valid JSON matching the specified schema. Do not enclose in markdown code blocks, do not include prefaces or explanations.`;

    const promptText = `PROJE: ${project?.name || ''}
SAHNE ÖLÇÜLERİ: En: ${width}m, Boy: ${length}m, Yükseklik: ${height}m
ÇİZİM BAŞLIĞI: ${drawingTitle || 'Tasarım Taslağı'}
STİL SEÇENEĞİ: ${style}`;

    const textResponse = await generateContentWithRetry({
      model: 'gemini-3.5-flash',
      contents: promptText,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            materialNotes: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            scale: { type: Type.STRING }
          },
          required: ["title", "materialNotes", "scale"]
        }
      }
    });

    const parsedText = robustJsonParse<any>(textResponse.text || '{}');
    res.json({
      title: parsedText.title || drawingTitle || 'Teknik Pafta',
      materialNotes: parsedText.materialNotes || [],
      scale: parsedText.scale || 'Şematik',
      image: enhancedImageBase64
    });
  } catch (error: any) {
    console.error('Technical enhancement error:', error);
    addLog('error', `Technical enhancement error: ${error.message}\nStack trace: ${error.stack}`);
    res.status(500).json({ error: `Teknik pafta detaylandırılırken hata oluştu: ${error.message}` });
  }
});

// 8. New Gemini-Powered Endpoints

// A. Generate Production Plan
app.post('/api/generate-production-plan', async (req, res) => {
  try {
    const { project } = req.body;
    const ai = getGeminiClient();
    
    addLog('info', `Generating production plan via Gemini for project: ${project.name}`);

    const propsList = project.analysis?.aksesuarlar || [];
    const approvedDrawings = project.technicalDrawings?.filter((d: any) => d.approved) || [];
    
    const propsSummary = propsList.map((p: any) => `* AD: ${p.ad}, KATEGORİ: ${p.kategori}, DURUM: ${p.status || 'Belirlenmedi'}, SAHNELER: ${(p.kullanildigiSahneler || []).join(', ')}`).join('\n');
    const drawingsSummary = approvedDrawings.map((d: any) => `* PAFTA: ${d.title}, ÖLÇEK: ${d.scale}, MALZEME NOTLARI: ${(d.materialNotes || []).join('; ')}`).join('\n');

    const promptText = `Sen profesyonel bir tiyatro dekor ve sahne imalat şefisin.
Sana verilen oyun analizindeki aksesuarlar ve teknik çizim verilerini kullanarak bir imalat ve üretim planı oluşturacaksın.

ONAYLANMIŞ TEKNİK ÇİZİMLER (PAFTALAR):
${drawingsSummary || 'Onaylanmış teknik çizim bulunmuyor. Sahne genel ölçülerine göre genel tasarım yapın.'}

SAHNE DEKOR VE AKSESUAR LİSTESİ:
${propsSummary || 'Henüz eklenmiş aksesuar yok.'}

Senden aşağıdaki JSON yapısına tam olarak uyan bir üretim planı üretmeni rica ediyorum.
- "summary": Özet plan. "materialList": [ { "item": "malzeme adı", "qty": "miktar", "notes": "açıklama/not" } ], "jobSequence": [ "temel iş sırası adımları (sırasıyla)" ]
- "detailed": Detaylı plan. "materialList": [ { "item": "malzeme adı", "spec": "özellikleri", "qty": "miktar", "costEstimate": "tahmini maliyet (örn: 1500 TL)" } ], "durationEstimate": "Tahmini toplam süre (gün/saat)", "jobSequence": [ { "step": "aşama başlığı", "phase": "evre (örn: Hazırlık, Montaj, Boyama)", "duration": "süre", "team": "gerekli ekip", "steps": [ "detaylı alt adım 1", "detaylı alt adım 2" ] } ], "teamRequirements": [ "Gerekli atölye ekibi listesi ve rolleri" ]

Çıktı sadece bu JSON olmalı, markdown kod bloğuna ALMA. Doğrudan geçerli bir JSON döndür.`;

    const response = await generateContentWithRetry({
      model: 'gemini-3.5-flash',
      contents: promptText,
      config: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: {
              type: Type.OBJECT,
              properties: {
                materialList: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      item: { type: Type.STRING },
                      qty: { type: Type.STRING },
                      notes: { type: Type.STRING }
                    },
                    required: ["item", "qty", "notes"]
                  }
                },
                jobSequence: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING }
                }
              },
              required: ["materialList", "jobSequence"]
            },
            detailed: {
              type: Type.OBJECT,
              properties: {
                materialList: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      item: { type: Type.STRING },
                      spec: { type: Type.STRING },
                      qty: { type: Type.STRING },
                      costEstimate: { type: Type.STRING }
                    },
                    required: ["item", "spec", "qty", "costEstimate"]
                  }
                },
                durationEstimate: { type: Type.STRING },
                jobSequence: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      step: { type: Type.STRING },
                      phase: { type: Type.STRING },
                      duration: { type: Type.STRING },
                      team: { type: Type.STRING },
                      steps: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING }
                      }
                    },
                    required: ["step", "phase", "duration", "team", "steps"]
                  }
                },
                teamRequirements: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING }
                }
              },
              required: ["materialList", "durationEstimate", "jobSequence", "teamRequirements"]
            }
          },
          required: ["summary", "detailed"]
        }
      }
    });

    const parsed = robustJsonParse<any>(response.text || '{}');
    res.json(parsed);
  } catch (error: any) {
    console.error('Production plan generation error:', error);
    addLog('error', `Production plan generation error: ${error.message}\nStack trace: ${error.stack}`);
    res.status(500).json({ error: `Üretim planı üretilirken hata oluştu: ${error.message}` });
  }
});

// B. Generate Movement and Emotion Graph Data
const analysisProgresses: Record<string, { current: number, total: number, startTime: number }> = {};

app.get('/api/generate-movement-emotion/progress/:projectId', (req, res) => {
  const { projectId } = req.params;
  const progress = analysisProgresses[projectId];
  if (!progress) {
    return res.json({ current: 0, total: 0, eta: 'Hesaplanıyor...' });
  }

  let eta = 'Hesaplanıyor...';
  if (progress.current > 0 && progress.total > 0) {
    const elapsed = (Date.now() - progress.startTime) / 1000;
    const avgTimePerBatch = elapsed / progress.current;
    const remainingBatches = progress.total - progress.current;
    const remainingSeconds = remainingBatches * avgTimePerBatch;

    if (remainingSeconds <= 0) {
      eta = 'Tamamlanıyor...';
    } else {
      const minutes = Math.floor(remainingSeconds / 60);
      const seconds = Math.floor(remainingSeconds % 60);
      if (minutes > 0) {
        eta = `${minutes} dakika ${seconds} saniye`;
      } else {
        eta = `${seconds} saniye`;
      }
    }
  }

  res.json({
    current: progress.current,
    total: progress.total,
    eta
  });
});

app.post('/api/generate-movement-emotion', async (req, res) => {
  try {
    const { project, instruction } = req.body;
    const apiKey = (req.headers['x-anthropic-api-key'] as string) || process.env.ANTHROPIC_API_KEY;
    const hasClaudeKey = apiKey && apiKey !== 'MY_ANTHROPIC_API_KEY' && apiKey.trim() !== '';

    const scenesList = project.scenes || [];
    const olaylarList = project.analysis?.olaylar || [];

    if (scenesList.length === 0) {
      addLog('info', 'No scenes found in project. Returning empty list.');
      return res.json({ data: [] });
    }

    addLog('info', `Generating Movement-Emotion graph values for project: ${project.name}. Total scenes: ${scenesList.length}`);

    const batchSize = 6;
    const totalBatches = Math.ceil(scenesList.length / batchSize);

    // Initialize progress
    analysisProgresses[project.id] = {
      current: 0,
      total: totalBatches,
      startTime: Date.now()
    };

    const finalData: any[] = [];

    // Sequential batching for live updating progress & 429 rate limit prevention
    for (let i = 0; i < scenesList.length; i += batchSize) {
      const batchScenes = scenesList.slice(i, i + batchSize);
      const startIdx = i + 1;
      const endIdx = Math.min(i + batchSize, scenesList.length);
      const batchNum = Math.floor(i / batchSize) + 1;

      // Update progress
      const currentProgress = analysisProgresses[project.id];
      if (currentProgress) {
        currentProgress.current = batchNum - 1;
      }

      let etaStr = "Hesaplanıyor...";
      if (batchNum > 1 && currentProgress) {
        const elapsed = (Date.now() - currentProgress.startTime) / 1000;
        const avgTimePerBatch = elapsed / (batchNum - 1);
        const remainingBatches = totalBatches - (batchNum - 1);
        const remainingSeconds = remainingBatches * avgTimePerBatch;
        
        const minutes = Math.floor(remainingSeconds / 60);
        const seconds = Math.floor(remainingSeconds % 60);
        if (minutes > 0) {
          etaStr = `${minutes} dakika ${seconds} saniye`;
        } else {
          etaStr = `${seconds} saniye`;
        }
      }

      const progressMessage = `${batchNum - 1}/${totalBatches} sahne grubu işlendi, tahmini kalan süre: ${etaStr}`;
      addLog('info', progressMessage);

      const batchSceneNames = batchScenes.map((s: any) => s.name.toLowerCase());
      const relevantOlaylar = olaylarList.filter((o: any) => {
        if (!o.kullanildigiSahneler) return false;
        return o.kullanildigiSahneler.some((sName: string) => batchSceneNames.includes(sName.toLowerCase()));
      });

      // Send the FULL REAL TEXT (including dialogues and directions) for accurate analysis
      const scenesSummary = batchScenes.map((s: any) => `ID: ${s.id}\nBAŞLIK: ${s.name}\nGERÇEK METİN:\n${s.content || 'Metin yok.'}`).join('\n\n---\n\n');
      const olaylarSummary = relevantOlaylar.map((o: any) => `Sahnede olan olay: ${o.olay} (Hareket Potansiyeli: ${o.hareketPotansiyeli})`).join('\n');

      const promptText = `Sen tiyatro sahne ritmi, hareket analizi ve dramaturji konularında uzman bir yardımcı yönetmensin.
Aşağıda verilen tiyatro oyununun bir grup sahnesini (ve bu sahnelere ait tespit edilmiş olayları) inceleyerek her bir sahne için:
1. Fiziksel Hareket Yoğunluğu (0 ile 10 arasında bir tam sayı puanı)
2. Duygusal/Dramatik Yoğunluk (0 ile 10 arasında bir tam sayı puanı)
puanlarını üretecek ve her puanlama için Türkçe dilinde kısa, öz bir gerekçe/açıklama yazacaksın.

ÖNEMLİ DEĞERLENDİRME KRİTERİ:
Her sahnenin hareket ve duygu yoğunluğunu DİĞER SAHNELERLE KARŞILAŞTIRARAK, göreceli olarak puanla. Bir oyunda tüm sahneler aynı yoğunlukta olamaz — en durgun sahne ile en yoğun sahne arasında belirgin bir fark olmalı. Sahnenin gerçek içeriğini (diyalog, aksiyon, duygu ifadeleri) dikkatlice oku ve buna göre puanla. Tekdüze (örneğin hep 5 veya 6 gibi) puanlar vermekten kesinlikle kaçın. Sahneler arasındaki duygusal ve fiziksel kontrastı (aksiyon ve durağanlık farklarını) grafikte belirgin bir iniş-çıkış oluşturacak şekilde vurgula.

YÖNETMEN TALİMATI (Eğer varsa dikkate al, yoksa standart akış çıkar):
${instruction || 'Talimat yok.'}

OYUN SAHNELERİ (Bu grup, sahne listesi):
${scenesSummary}

İLGİLİ OLAYLAR VE HAREKET POTANSİYELİ:
${olaylarSummary || 'Deklare edilmiş olay yok.'}

Senden aşağıdaki JSON yapısında bir çıktı üretmeni rica ediyorum:
{
  "data": [
    {
      "sceneId": "sahne id (scenes listesindeki id'yi birebir eşleştir)",
      "sceneName": "sahne adı",
      "movement": 5,
      "emotion": 8,
      "justification": "Açıklama"
    }
  ]
}

X ekseni kronolojik akış olacaktır, bu yüzden sahneleri doğru sırada listelediğinden emin ol.
Çıktı sadece bu JSON olmalı, markdown kod bloğuna ALMA. Doğrudan geçerli bir JSON döndür.`;

      let batchSuccess = false;
      let retriesLeft = 5;
      let parsedBatchData: any[] = [];

      while (!batchSuccess && retriesLeft > 0) {
        try {
          addLog('info', `Processing scene batch ${startIdx} to ${endIdx} of ${scenesList.length}...`);
          let responseText = '';
          if (hasClaudeKey) {
            addLog('info', `Claude API key present. Routing Movement-Emotion graph generation to Claude for batch ${startIdx}-${endIdx}...`);
            const systemInstruction = 'You are an expert director, drama theorist, and assistant director. You must analyze the text and output a valid JSON containing physical movement and emotional/dramatic intensity values for each scene. Output ONLY valid JSON.';
            responseText = await callClaudeAPI(systemInstruction, promptText, apiKey);
          } else {
            addLog('info', `No Claude API key. Routing to Gemini for batch ${startIdx}-${endIdx}...`);
            const response = await generateContentWithRetry({
              model: 'gemini-3.5-flash',
              contents: promptText,
              config: {
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    data: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          sceneId: { type: Type.STRING },
                          sceneName: { type: Type.STRING },
                          movement: { type: Type.INTEGER },
                          emotion: { type: Type.INTEGER },
                          justification: { type: Type.STRING }
                        },
                        required: ["sceneId", "sceneName", "movement", "emotion", "justification"]
                      }
                    }
                  },
                  required: ["data"]
                }
              }
            });
            responseText = response.text || '{}';
          }

          const parsed = robustJsonParse<any>(responseText.trim());
          if (parsed && Array.isArray(parsed.data)) {
            parsedBatchData = parsed.data;
            batchSuccess = true;
          } else {
            addLog('error', `Parsed data for batch ${startIdx}-${endIdx} is not an array or missing. Retrying without delay...`);
            retriesLeft--;
          }
        } catch (batchErr: any) {
          const errMsg = batchErr.message || '';
          const is429 = errMsg.includes('429') || errMsg.toLowerCase().includes('rate limit');
          if (is429 && retriesLeft > 1) {
            addLog('info', `Hız Sınırı (429 Rate Limit) hatası alındı. 30 saniye bekleniyor ve tekrar deneniyor... (Kalan deneme: ${retriesLeft - 1})`);
            await new Promise(resolve => setTimeout(resolve, 30000));
            retriesLeft--;
          } else {
            addLog('error', `Batch ${startIdx}-${endIdx} generation or parsing failed: ${errMsg}`);
            console.error(`Batch ${startIdx}-${endIdx} error:`, batchErr);
            break; // Move to next batch to avoid blocking the whole process
          }
        }
      }

      if (batchSuccess) {
        finalData.push(...parsedBatchData);
      }
    }

    // Mark as completed
    if (analysisProgresses[project.id]) {
      analysisProgresses[project.id].current = totalBatches;
    }

    // Align results with the exact scenesList to ensure total count and order matches perfectly
    const alignedData = scenesList.map((scene: any) => {
      // Find by sceneId first
      let found = finalData.find((item: any) => item.sceneId === scene.id);
      if (!found) {
        // Find by sceneName case-insensitive
        found = finalData.find((item: any) => 
          item.sceneName?.toLowerCase() === scene.name?.toLowerCase() || 
          item.sceneId?.toLowerCase() === scene.name?.toLowerCase()
        );
      }

      const isMissing = !found || typeof found.movement !== 'number' || typeof found.emotion !== 'number';

      return {
        sceneId: scene.id,
        sceneName: scene.name,
        movement: isMissing ? null : Math.max(0, Math.min(10, found.movement)),
        emotion: isMissing ? null : Math.max(0, Math.min(10, found.emotion)),
        isMissing,
        justification: isMissing ? 'Veri Eksik: Yapay zeka analizinden bu sahne için puan üretilemedi veya hata oluştu.' : found.justification
      };
    });

    // 1. Server-side debug console logging exactly in the requested format
    console.log("=== SERVER HAREKET-DUYGU HAM PUANLARI ===");
    alignedData.forEach((item: any) => {
      const mVal = item.isMissing ? 'VERİ EKSİK' : item.movement;
      const eVal = item.isMissing ? 'VERİ EKSİK' : item.emotion;
      console.log(`Sahne ${item.sceneName}: Hareket=${mVal}, Duygu=${eVal}`);
    });
    console.log("=========================================");

    addLog('info', `Hareket-Duygu analizi tamamlandı: ${alignedData.length} sahne işlendi.`);
    res.json({ data: alignedData });
  } catch (error: any) {
    console.error('Movement-Emotion generation error:', error);
    addLog('error', `Movement-Emotion generation error: ${error.message}\nStack trace: ${error.stack}`);
    res.status(500).json({ error: `Ritim puanları üretilirken hata oluştu: ${error.message}` });
  }
});

// C. Generate Symbolic Subtext Analysis
app.post('/api/generate-symbolic-analysis', async (req, res) => {
  try {
    const { project, instruction } = req.body;
    const apiKey = (req.headers['x-anthropic-api-key'] as string) || process.env.ANTHROPIC_API_KEY;
    const hasClaudeKey = apiKey && apiKey !== 'MY_ANTHROPIC_API_KEY' && apiKey.trim() !== '';

    addLog('info', `Generating Symbolic Subtext analysis for project: ${project.name}`);

    const scriptText = project.scriptText || '';
    const textPreview = scriptText.substring(0, 15000);

    const promptText = `Sen tiyatro dramaturgu ve sembolik göstergebilim (semiotics) uzmanısın.
Aşağıda verilen tiyatro metni kesitini sembolik ve alt metin katmanları açısından derinlemesine analiz et.
Özellikle sembolik potansiyeli olan nesneler, imgeler, mekanlar ve bunların görsel sahne diline nasıl aktarılabileceğini araştır.

DÜZELTME TALİMATI (Eğer varsa dikkate al):
${instruction || 'Talimat yok.'}

METİN KESİTİ:
${textPreview || 'Metin yüklenmemiş. Genel tiyatro sembolik kurguları üzerinden zengin örnekler çıkar.'}

Senden aşağıdaki JSON yapısında bir sembol tablosu ve metafor listesi üretmeni rica ediyorum:
- "symbolicAnalysis": [ { "object": "sembolik obje veya imge", "occurrence": "nerede geçtiği/hangi sahnede", "meaning": "ifade ettiği derin anlam", "visualLanguage": "sahne tasarımında görsel olarak nasıl yansıtabileceği (ışık, konum, ölçek vb.)" } ]
- "symbolicMetaphors": [ "metinde tekrar eden benzetme veya metafor örneği 1", "örnek 2", "örnek 3" ]

Çıktı sadece bu JSON olmalı, markdown kod bloğuna ALMA. Doğrudan geçerli bir JSON döndür.`;

    let responseText = '';
    if (hasClaudeKey) {
      addLog('info', 'Claude API key present. Routing Symbolic Subtext analysis to Claude...');
      const systemInstruction = 'You are an expert theater semiotics scholar and dramaturg. Output ONLY a valid JSON with "symbolicAnalysis" and "symbolicMetaphors" fields.';
      responseText = await callClaudeAPI(systemInstruction, promptText, apiKey);
    } else {
      addLog('info', 'No Claude API key. Routing to Gemini...');
      const response = await generateContentWithRetry({
        model: 'gemini-3.5-flash',
        contents: promptText,
        config: {
          temperature: 0.1,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              symbolicAnalysis: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    object: { type: Type.STRING },
                    occurrence: { type: Type.STRING },
                    meaning: { type: Type.STRING },
                    visualLanguage: { type: Type.STRING }
                  },
                  required: ["object", "occurrence", "meaning", "visualLanguage"]
                }
              },
              symbolicMetaphors: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              }
            },
            required: ["symbolicAnalysis", "symbolicMetaphors"]
          }
        }
      });
      responseText = response.text || '{}';
    }

    const parsed = robustJsonParse<any>(responseText.trim());
    res.json(parsed);
  } catch (error: any) {
    console.error('Symbolic analysis generation error:', error);
    addLog('error', `Symbolic analysis generation error: ${error.message}\nStack trace: ${error.stack}`);
    res.status(500).json({ error: `Sembolik analiz üretilirken hata oluştu: ${error.message}` });
  }
});

// Vite integration
async function startServer() {
  const publicPath = path.join(process.cwd(), 'public');
  app.use(express.static(publicPath));

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    addLog('info', `Zehir Bebek server running on port ${PORT}`);
  });
}

startServer();
