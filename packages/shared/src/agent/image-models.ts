/**
 * Image Generation Model Configuration
 *
 * Defines available image generation models with pricing,
 * capabilities, and fal.ai endpoint mappings.
 */

// ============================================================
// Types
// ============================================================

export type ImageModelProvider = 'fal' | 'google';

export type ContentType =
  | 'text-heavy'
  | 'visual'
  | 'quick-draft'
  | 'complex-scene'
  | 'premium-text';

export interface ImageModel {
  /** Unique model identifier (used in tool parameters) */
  id: string;
  /** Display name for UI */
  name: string;
  /** Provider: 'fal' for fal.ai, 'google' for direct Google API */
  provider: ImageModelProvider;
  /** fal.ai endpoint (e.g., 'fal-ai/ideogram/v3') */
  falEndpoint?: string;
  /** Additional parameters to send to fal.ai */
  falParams?: Record<string, unknown>;
  /** Cost per image in USD */
  cost: number;
  /** Model strengths for display */
  strengths: string[];
  /** Content types this model is best for */
  bestFor: ContentType[];
  /** Supported aspect ratios */
  aspectRatios: string[];
}

// ============================================================
// Model Registry
// ============================================================

export const IMAGE_MODELS: Record<string, ImageModel> = {
  // ----------------------------------------
  // Direct Google API (existing)
  // ----------------------------------------
  'gemini-direct': {
    id: 'gemini-direct',
    name: 'Gemini 3 Pro (Direct)',
    provider: 'google',
    cost: 0.134,
    strengths: ['High quality', 'Complex compositions', 'Good text rendering'],
    bestFor: ['complex-scene', 'premium-text'],
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
  },

  // ----------------------------------------
  // Ideogram V3 (fal.ai) - Best for text
  // ----------------------------------------
  'ideogram-v3-turbo': {
    id: 'ideogram-v3-turbo',
    name: 'Ideogram V3 Turbo',
    provider: 'fal',
    falEndpoint: 'fal-ai/ideogram/v3',
    falParams: { rendering_speed: 'TURBO' },
    cost: 0.03,
    strengths: ['Fast', 'Good text in images', 'Budget-friendly'],
    bestFor: ['text-heavy', 'quick-draft'],
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
  },
  'ideogram-v3-balanced': {
    id: 'ideogram-v3-balanced',
    name: 'Ideogram V3 Balanced',
    provider: 'fal',
    falEndpoint: 'fal-ai/ideogram/v3',
    falParams: { rendering_speed: 'BALANCED' },
    cost: 0.06,
    strengths: ['Great text rendering', 'Good quality/cost balance'],
    bestFor: ['text-heavy'],
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
  },
  'ideogram-v3-quality': {
    id: 'ideogram-v3-quality',
    name: 'Ideogram V3 Quality',
    provider: 'fal',
    falEndpoint: 'fal-ai/ideogram/v3',
    falParams: { rendering_speed: 'QUALITY' },
    cost: 0.09,
    strengths: ['Excellent text rendering', 'High quality output'],
    bestFor: ['premium-text'],
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
  },

  // ----------------------------------------
  // Imagen 4 (fal.ai) - Best for visuals
  // ----------------------------------------
  'imagen-4-standard': {
    id: 'imagen-4-standard',
    name: 'Imagen 4 Standard',
    provider: 'fal',
    falEndpoint: 'fal-ai/imagen4/preview',
    cost: 0.04,
    strengths: ['Photorealistic', 'Good for products', 'Fast'],
    bestFor: ['visual', 'quick-draft'],
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
  },
  'imagen-4-ultra': {
    id: 'imagen-4-ultra',
    name: 'Imagen 4 Ultra',
    provider: 'fal',
    falEndpoint: 'fal-ai/imagen4/preview/ultra',
    cost: 0.06,
    strengths: ['Best photorealism', 'Premium visual quality'],
    bestFor: ['visual'],
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
  },

  // ----------------------------------------
  // Reve (fal.ai) - Budget option
  // ----------------------------------------
  'reve': {
    id: 'reve',
    name: 'Reve',
    provider: 'fal',
    falEndpoint: 'fal-ai/reve/text-to-image',
    cost: 0.04,
    strengths: ['Budget option', 'Good for iteration', 'Fast'],
    bestFor: ['quick-draft'],
    aspectRatios: ['1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4'],
  },

  // ----------------------------------------
  // Gemini 3 Pro via fal.ai (alternative billing)
  // ----------------------------------------
  'gemini-fal': {
    id: 'gemini-fal',
    name: 'Gemini 3 Pro (fal.ai)',
    provider: 'fal',
    falEndpoint: 'fal-ai/gemini-3-pro-image-preview',
    cost: 0.15,
    strengths: ['Complex scenes', 'Good text', 'Alternative billing'],
    bestFor: ['complex-scene'],
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
  },
};

// ============================================================
// Default Model
// ============================================================

export const DEFAULT_MODEL = 'ideogram-v3-balanced';

// ============================================================
// Model IDs (for type safety)
// ============================================================

export type ImageModelId = keyof typeof IMAGE_MODELS;

export const IMAGE_MODEL_IDS = Object.keys(IMAGE_MODELS) as ImageModelId[];

// ============================================================
// Helper Functions
// ============================================================

/**
 * Get a model by ID.
 * Returns undefined if model not found.
 */
export function getImageModel(modelId: string): ImageModel | undefined {
  return IMAGE_MODELS[modelId];
}

/**
 * Get the recommended model for a content type.
 * Falls back to DEFAULT_MODEL if no match.
 */
export function getRecommendedModel(contentType: string): string {
  const typeMap: Record<string, string> = {
    // Text-heavy content
    'text-heavy': 'ideogram-v3-balanced',
    'quote': 'ideogram-v3-balanced',
    'announcement': 'ideogram-v3-balanced',
    'cta': 'ideogram-v3-balanced',
    'tips': 'ideogram-v3-balanced',
    'infographic': 'ideogram-v3-quality',

    // Visual content
    'product': 'imagen-4-ultra',
    'lifestyle': 'imagen-4-ultra',
    'visual': 'imagen-4-ultra',
    'photo': 'imagen-4-ultra',

    // Quick/draft content
    'draft': 'reve',
    'iteration': 'reve',
    'quick': 'reve',
    'test': 'reve',

    // Complex/premium content
    'complex': 'gemini-direct',
    'scene': 'gemini-direct',
    'illustration': 'gemini-direct',
    'premium': 'ideogram-v3-quality',
    'premium-text': 'ideogram-v3-quality',
  };

  return typeMap[contentType.toLowerCase()] || DEFAULT_MODEL;
}

/**
 * Analyze handoff data to recommend a model.
 * Uses visualSuggestions, format, and other hints.
 */
export function getRecommendedModelFromHandoff(handoff: {
  visualSuggestions?: string[];
  format?: string;
  platform?: string;
}): string {
  const suggestions = handoff.visualSuggestions?.join(' ').toLowerCase() || '';
  const format = handoff.format?.toLowerCase() || '';

  // Check visual suggestions for hints
  if (suggestions.includes('text') || suggestions.includes('typography') || suggestions.includes('quote')) {
    return 'ideogram-v3-balanced';
  }
  if (suggestions.includes('photo') || suggestions.includes('product') || suggestions.includes('lifestyle')) {
    return 'imagen-4-ultra';
  }
  if (suggestions.includes('illustration') || suggestions.includes('complex') || suggestions.includes('scene')) {
    return 'gemini-direct';
  }

  // Check format
  if (format === 'carousel') {
    return 'ideogram-v3-balanced'; // Carousels often have text
  }
  if (format === 'single-image' || format === 'reel' || format === 'story') {
    return 'imagen-4-ultra'; // Visual-focused formats
  }

  return DEFAULT_MODEL;
}

/**
 * Format a single model for display.
 */
export function formatModel(model: ImageModel): string {
  return `${model.id}: ${model.name} ($${model.cost.toFixed(2)}) - ${model.strengths.join(', ')}`;
}

/**
 * Format all models as a list for tool descriptions.
 */
export function formatModelList(): string {
  return Object.values(IMAGE_MODELS)
    .map(formatModel)
    .join('\n');
}

/**
 * Format models grouped by best use case.
 */
export function formatModelsByUseCase(): string {
  const groups: Record<string, ImageModel[]> = {
    'Text-heavy posts': [],
    'Visual posts': [],
    'Quick drafts': [],
    'Complex scenes': [],
  };

  for (const model of Object.values(IMAGE_MODELS)) {
    if (model.bestFor.includes('text-heavy') || model.bestFor.includes('premium-text')) {
      groups['Text-heavy posts']!.push(model);
    }
    if (model.bestFor.includes('visual')) {
      groups['Visual posts']!.push(model);
    }
    if (model.bestFor.includes('quick-draft')) {
      groups['Quick drafts']!.push(model);
    }
    if (model.bestFor.includes('complex-scene')) {
      groups['Complex scenes']!.push(model);
    }
  }

  return Object.entries(groups)
    .map(([category, models]) => {
      const modelList = models
        .map(m => `  - ${m.id} ($${m.cost.toFixed(2)})`)
        .join('\n');
      return `${category}:\n${modelList}`;
    })
    .join('\n\n');
}

/**
 * Map standard aspect ratio to Ideogram's image_size parameter.
 */
export function mapAspectRatioToIdeogram(aspectRatio: string): string {
  const mapping: Record<string, string> = {
    '1:1': 'square_hd',
    '16:9': 'landscape_16_9',
    '9:16': 'portrait_16_9',
    '4:3': 'landscape_4_3',
    '3:4': 'portrait_4_3',
  };
  return mapping[aspectRatio] || 'square_hd';
}
