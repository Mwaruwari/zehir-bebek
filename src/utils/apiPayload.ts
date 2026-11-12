import { Project } from '../types';

/**
 * Strips heavy binary payloads before sending a project to an AI endpoint.
 *
 * Every analysis endpoint used to receive the entire project object, including
 * base64 data URLs for presentation images, technical drawings and the style
 * library. A handful of phone photos pushes that past express's 50 MB body
 * limit, at which point the request fails with a 413 — and because
 * /api/projects shares the same limit, saving breaks permanently too.
 *
 * None of those endpoints read the image bytes: they work from scene text,
 * the analysis tables, stage dimensions and drawing metadata (title, scale,
 * material notes). So the image data is replaced with an empty string while
 * every other field — including each item's id, title and scene mapping — is
 * preserved, keeping the server contract unchanged.
 */
export function sanitizeProjectForApi(project: Project): Project {
  return {
    ...project,
    presentationImages: project.presentationImages?.map(img => ({
      ...img,
      data: '',
    })),
    technicalDrawings: project.technicalDrawings?.map(drawing => ({
      ...drawing,
      image: '',
    })),
    styleLibrary: project.styleLibrary?.map(style => ({
      ...style,
      image: '',
    })),
  };
}

/** Rough byte size of a JSON payload, for logging and pre-flight checks. */
export function estimatePayloadBytes(value: unknown): number {
  try {
    return new Blob([JSON.stringify(value)]).size;
  } catch {
    try {
      return JSON.stringify(value).length;
    } catch {
      return 0;
    }
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
