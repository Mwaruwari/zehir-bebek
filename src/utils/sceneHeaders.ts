/**
 * Scene-header detection shared by the whole app.
 *
 * A header is recognised only when the structural keyword is paired with a
 * NUMBER (arabic or roman). That single constraint is what separates a real
 * header ("2. SAHNE", "SAHNE 1", "PERDE II") from ordinary prose that merely
 * contains the word ("sahne ışıkları söner", "perde alçalmasından sonra").
 * Callers must additionally require the match to sit on its own short line —
 * `detectSceneHeaderLines` below does both.
 */

/** Headers are short labels, never full paragraphs. */
export const MAX_SCENE_HEADER_LENGTH = 90;

const SCENE_KEYWORD = '(?:SAHNE|PERDE|TABLO|BÖLÜM)';
const SCENE_NUMBER = '(?:[0-9]{1,3}|[IVXLC]{1,6})';
// \b is ASCII-only in JavaScript, so it reports a false boundary between a
// roman numeral and a Turkish letter — which made "SAHNE IŞIKLARI" parse as
// "SAHNE I". Require explicitly that no letter or digit follows instead.
const NOT_WORD_CHAR = '(?![\\p{L}\\p{N}])';

export const SCENE_HEADER_LINE_REGEX = new RegExp(
  '^(?:' +
    // "2. SAHNE", "II - PERDE", "3) BÖLÜM"
    `${SCENE_NUMBER}\\s*[.)\\-–—:]?\\s*${SCENE_KEYWORD}${NOT_WORD_CHAR}` +
    '|' +
    // "SAHNE 1", "PERDE II", "BÖLÜM 3"
    `${SCENE_KEYWORD}\\s*[.)\\-–—:]?\\s*${SCENE_NUMBER}${NOT_WORD_CHAR}` +
    '|' +
    // "İÇ MEKAN" / "DIŞ MEKAN" screenplay sluglines
    `(?:İÇ|DIŞ)\\s*[.\\-–—/]?\\s*MEKAN${NOT_WORD_CHAR}` +
  ')',
  'iu'
);

/** True when a single trimmed line looks like a scene/act header. */
export function isSceneHeaderLine(trimmedLine: string): boolean {
  if (!trimmedLine || trimmedLine.length > MAX_SCENE_HEADER_LENGTH) return false;
  return SCENE_HEADER_LINE_REGEX.test(trimmedLine);
}

export interface DetectedSceneHeader {
  /** Header text, upper-cased and capped for display. */
  name: string;
  /** Character offset of the header within the source text. */
  startIdx: number;
}

/**
 * Scans text line by line and returns every line that is a scene header.
 *
 * Line-scoped on purpose: matching anywhere in the text would turn ordinary
 * prose such as "...sahne yorgunluğunu hissetti..." into a bogus boundary.
 */
export function detectSceneHeaderLines(text: string): DetectedSceneHeader[] {
  const found: DetectedSceneHeader[] = [];
  if (!text) return found;

  let offset = 0;
  for (const line of text.split('\n')) {
    const lineStart = offset;
    offset += line.length + 1; // +1 for the consumed '\n'

    const trimmed = line.trim();
    if (!isSceneHeaderLine(trimmed)) continue;

    found.push({
      name: trimmed.toUpperCase().slice(0, 60),
      startIdx: lineStart + (line.length - line.trimStart().length),
    });
  }

  return found;
}

/** Number of genuine scene-header lines; used to tell a play apart from prose. */
export function countSceneHeaderLines(text: string): number {
  return detectSceneHeaderLines(text).length;
}
