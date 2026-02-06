/**
 * Image Generation Model Configuration
 *
 * Defines available image generation models with pricing,
 * capabilities, and fal.ai endpoint mappings.
 *
 * Also includes:
 * - Text analysis for automatic model selection
 * - Platform-specific design guidelines
 * - Prompt engineering helpers
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

export type TextDensity = 'text-free' | 'minimal' | 'moderate' | 'heavy' | 'complex';

export type Platform = 'linkedin' | 'instagram' | 'twitter' | 'tiktok' | 'facebook' | 'general';

export interface TextAnalysisResult {
  /** Classification of text density */
  density: TextDensity;
  /** Number of words detected that need to be rendered */
  wordCount: number;
  /** Detected text elements (headlines, quotes, CTAs, etc.) */
  textElements: string[];
  /** Recommended model based on text analysis */
  recommendedModel: string;
  /** Warning message if text might not render well */
  warning?: string;
  /** Whether Gemini is required for good text rendering */
  requiresGemini: boolean;
}

export interface PlatformGuidelines {
  /** Platform identifier */
  platform: Platform;
  /** Recommended colors (hex codes) */
  colors: string[];
  /** Design mood/style description */
  mood: string;
  /** Typography guidance */
  typography: string;
  /** Elements to include */
  includeElements: string[];
  /** Elements to avoid */
  avoidElements: string[];
  /** Prompt prefix to add */
  promptPrefix: string;
  /** Prompt suffix to add */
  promptSuffix: string;
  /** Whether minimal/no text is recommended */
  preferTextFree: boolean;
  /** Default aspect ratio */
  defaultAspectRatio: string;
}

/**
 * Image reference capabilities for a model
 */
export interface ImageReferenceCapabilities {
  /** Supports style reference (generate new image matching a reference style) */
  styleReference: boolean;
  /** Supports image remix/transformation (modify existing image) */
  remix: boolean;
  /** Supports inpainting/editing with mask */
  edit: boolean;
  /** Endpoint for remix operations (if different from main endpoint) */
  remixEndpoint?: string;
  /** Endpoint for edit/inpainting operations */
  editEndpoint?: string;
  /** Parameter name for style reference images */
  styleRefParam?: string;
  /** Maximum number of reference images supported */
  maxReferenceImages?: number;
  /** Supports strength parameter for remix */
  supportsStrength?: boolean;
}

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
  /** Image reference capabilities (style ref, remix, edit) */
  referenceCapabilities?: ImageReferenceCapabilities;
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
    // Gemini direct API supports image input for editing
    referenceCapabilities: {
      styleReference: true,
      remix: false,
      edit: true,
      styleRefParam: 'image_urls',
      maxReferenceImages: 1,
    },
  },

  // ----------------------------------------
  // Ideogram V3 (fal.ai) - Best for text + full reference support
  // ----------------------------------------
  'ideogram-v3-turbo': {
    id: 'ideogram-v3-turbo',
    name: 'Ideogram V3 Turbo',
    provider: 'fal',
    falEndpoint: 'fal-ai/ideogram/v3',
    falParams: { rendering_speed: 'TURBO' },
    cost: 0.03,
    strengths: ['Fast', 'Good text in images', 'Budget-friendly', 'Style reference'],
    bestFor: ['text-heavy', 'quick-draft'],
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    referenceCapabilities: {
      styleReference: true,
      remix: true,
      edit: true,
      remixEndpoint: 'fal-ai/ideogram/character/remix',
      editEndpoint: 'fal-ai/ideogram/v3/edit',
      styleRefParam: 'image_urls',
      maxReferenceImages: 5,
      supportsStrength: true,
    },
  },
  'ideogram-v3-balanced': {
    id: 'ideogram-v3-balanced',
    name: 'Ideogram V3 Balanced',
    provider: 'fal',
    falEndpoint: 'fal-ai/ideogram/v3',
    falParams: { rendering_speed: 'BALANCED' },
    cost: 0.06,
    strengths: ['Great text rendering', 'Good quality/cost balance', 'Style reference'],
    bestFor: ['text-heavy'],
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    referenceCapabilities: {
      styleReference: true,
      remix: true,
      edit: true,
      remixEndpoint: 'fal-ai/ideogram/character/remix',
      editEndpoint: 'fal-ai/ideogram/v3/edit',
      styleRefParam: 'image_urls',
      maxReferenceImages: 5,
      supportsStrength: true,
    },
  },
  'ideogram-v3-quality': {
    id: 'ideogram-v3-quality',
    name: 'Ideogram V3 Quality',
    provider: 'fal',
    falEndpoint: 'fal-ai/ideogram/v3',
    falParams: { rendering_speed: 'QUALITY' },
    cost: 0.09,
    strengths: ['Excellent text rendering', 'High quality output', 'Style reference'],
    bestFor: ['premium-text'],
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    referenceCapabilities: {
      styleReference: true,
      remix: true,
      edit: true,
      remixEndpoint: 'fal-ai/ideogram/character/remix',
      editEndpoint: 'fal-ai/ideogram/v3/edit',
      styleRefParam: 'image_urls',
      maxReferenceImages: 5,
      supportsStrength: true,
    },
  },

  // ----------------------------------------
  // Imagen 4 (fal.ai) - Best for visuals, NO reference support
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
    // Imagen 4 does NOT support any image reference
    referenceCapabilities: {
      styleReference: false,
      remix: false,
      edit: false,
    },
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
    // Imagen 4 does NOT support any image reference
    referenceCapabilities: {
      styleReference: false,
      remix: false,
      edit: false,
    },
  },

  // ----------------------------------------
  // Reve (fal.ai) - Budget option with GREAT reference support (up to 6 images!)
  // ----------------------------------------
  'reve': {
    id: 'reve',
    name: 'Reve',
    provider: 'fal',
    falEndpoint: 'fal-ai/reve/text-to-image',
    cost: 0.04,
    strengths: ['Budget option', 'Good for iteration', 'Fast', 'Multi-image reference (up to 6!)'],
    bestFor: ['quick-draft'],
    aspectRatios: ['1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4'],
    referenceCapabilities: {
      styleReference: true,
      remix: true,
      edit: false,
      remixEndpoint: 'fal-ai/reve/remix',
      styleRefParam: 'image_urls',
      maxReferenceImages: 6, // Reve supports up to 6 reference images!
      supportsStrength: false,
    },
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
    strengths: ['Complex scenes', 'Good text', 'Alternative billing', 'Image editing'],
    bestFor: ['complex-scene'],
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    referenceCapabilities: {
      styleReference: true,
      remix: false,
      edit: true,
      editEndpoint: 'fal-ai/gemini-3-pro-image-preview/edit',
      styleRefParam: 'image_urls',
      maxReferenceImages: 1,
    },
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

// ============================================================
// Platform Design Guidelines
// ============================================================

export const PLATFORM_GUIDELINES: Record<Platform, PlatformGuidelines> = {
  linkedin: {
    platform: 'linkedin',
    colors: ['#0077B5', '#F3F2EF', '#1A1A1A', '#666666', '#FFFFFF'],
    mood: 'professional, trustworthy, editorial, thought leadership',
    typography: 'clean sans-serif, minimal text overlay, professional fonts',
    includeElements: [
      'data visualizations',
      'clean lines',
      'whitespace',
      'professional imagery',
      'subtle gradients',
    ],
    avoidElements: [
      'bright neon colors',
      'Instagram-style carousels',
      'cluttered designs',
      'playful fonts',
      'excessive text overlay',
    ],
    promptPrefix: 'Professional LinkedIn post design. Clean, minimal corporate aesthetic. Muted professional colors (navy, slate gray, cream).',
    promptSuffix: 'Editorial quality, thought leadership style. The color palette is exclusively muted professional tones. The design has intentional whitespace and clean composition. Professional and trustworthy.',
    preferTextFree: true,
    defaultAspectRatio: '1:1',
  },
  instagram: {
    platform: 'instagram',
    colors: ['#E1306C', '#F77737', '#FCAF45', '#833AB4', '#C13584'],
    mood: 'vibrant, eye-catching, trendy, scroll-stopping, engaging',
    typography: 'bold headlines, creative fonts, max 20 words per slide',
    includeElements: [
      'bold colors',
      'high contrast',
      'trendy elements',
      'swipe indicators',
      'brand colors',
    ],
    avoidElements: [
      'corporate designs',
      'too much text',
      'small fonts',
      'muted colors',
      'boring layouts',
    ],
    promptPrefix: 'Eye-catching Instagram post. Bold, vibrant design with high visual impact. Trendy social media aesthetic.',
    promptSuffix: 'Scroll-stopping design. Mobile-optimized composition. High contrast and engaging visuals.',
    preferTextFree: false,
    defaultAspectRatio: '1:1',
  },
  twitter: {
    platform: 'twitter',
    colors: ['#1DA1F2', '#14171A', '#657786', '#AAB8C2', '#FFFFFF'],
    mood: 'high-impact, minimal, punchy, direct, conversation-starting',
    typography: 'minimal text (under 20% of image), bold and readable',
    includeElements: [
      'high contrast',
      'center-focused composition',
      'clean design',
      'strong visual focus',
    ],
    avoidElements: [
      'cluttered designs',
      'important content at edges',
      'excessive text',
      'complex layouts',
    ],
    promptPrefix: 'High-impact Twitter/X post image. Clean, minimal design with strong visual focus. High contrast.',
    promptSuffix: 'Center-focused composition (edges may crop on mobile). Minimal text area. Punchy and direct.',
    preferTextFree: true,
    defaultAspectRatio: '16:9',
  },
  tiktok: {
    platform: 'tiktok',
    colors: ['#FF0050', '#00F2EA', '#000000', '#FFFFFF', '#FE2C55'],
    mood: 'energetic, fun, authentic, curiosity-inducing, trending',
    typography: 'large, bold, readable at small sizes',
    includeElements: [
      'bright colors',
      'vertical composition',
      'face-forward elements',
      'trending aesthetics',
    ],
    avoidElements: [
      'corporate look',
      'horizontal layouts',
      'small text',
      'overly polished',
    ],
    promptPrefix: 'TikTok thumbnail design. Bright, bold, trending aesthetic. Vertical portrait format optimized for mobile.',
    promptSuffix: 'Energetic and curiosity-inducing. Authentic feel. Large, readable elements.',
    preferTextFree: false,
    defaultAspectRatio: '9:16',
  },
  facebook: {
    platform: 'facebook',
    colors: ['#1877F2', '#42B72A', '#F7F7F7', '#1C1E21', '#FFFFFF'],
    mood: 'friendly, community-focused, shareable, relatable, trustworthy',
    typography: 'clear, readable, moderate text',
    includeElements: [
      'warm colors',
      'community feel',
      'shareable content',
      'relatable imagery',
    ],
    avoidElements: [
      'overly corporate',
      'cold designs',
      'complex graphics',
    ],
    promptPrefix: 'Facebook post design. Friendly, community-focused aesthetic. Warm and inviting.',
    promptSuffix: 'Shareable and relatable. Works well in feed and groups. Trustworthy appearance.',
    preferTextFree: false,
    defaultAspectRatio: '1:1',
  },
  general: {
    platform: 'general',
    colors: ['#2563EB', '#10B981', '#F59E0B', '#EF4444', '#6366F1'],
    mood: 'versatile, professional, modern',
    typography: 'clean, readable, flexible',
    includeElements: [
      'clean design',
      'modern aesthetics',
      'balanced composition',
    ],
    avoidElements: [
      'cluttered layouts',
      'hard to read text',
    ],
    promptPrefix: 'Professional social media post design. Modern, clean aesthetic.',
    promptSuffix: 'Balanced composition. Clear visual hierarchy.',
    preferTextFree: false,
    defaultAspectRatio: '1:1',
  },
};

/**
 * Get platform guidelines by platform name.
 */
export function getPlatformGuidelines(platform: string): PlatformGuidelines {
  const normalizedPlatform = platform.toLowerCase().replace(/[^a-z]/g, '') as Platform;

  // Handle common variations
  const platformMap: Record<string, Platform> = {
    'linkedin': 'linkedin',
    'instagram': 'instagram',
    'ig': 'instagram',
    'twitter': 'twitter',
    'x': 'twitter',
    'twitterx': 'twitter',
    'tiktok': 'tiktok',
    'facebook': 'facebook',
    'fb': 'facebook',
  };

  const mappedPlatform = platformMap[normalizedPlatform] || 'general';
  return PLATFORM_GUIDELINES[mappedPlatform];
}

// ============================================================
// Text Analysis Functions
// ============================================================

/**
 * Common text indicators that suggest text needs to be rendered in the image.
 */
const TEXT_INDICATORS = [
  // Direct text requests
  'text:', 'text overlay', 'headline:', 'title:', 'caption:',
  'quote:', 'saying:', 'slogan:', 'tagline:', 'cta:',
  // Text content patterns
  '"', "'", // Quoted text
  'write', 'says', 'reading', 'showing text',
  // Specific text types
  'statistics', 'data point', 'percentage', 'number',
  'bullet point', 'list item', 'step',
];

/**
 * Patterns that indicate complex text (requires Gemini).
 */
const COMPLEX_TEXT_PATTERNS = [
  // Multiple text elements
  /headline.*subheadline/i,
  /title.*subtitle/i,
  /multiple.*text/i,
  /several.*line/i,
  // Long text
  /quote.*"[^"]{50,}"/i,
  // Special formatting
  /small.*font/i,
  /fine.*print/i,
  // Multiple languages
  /arabic|chinese|japanese|korean|hindi|russian/i,
];

/**
 * Extract quoted text and text indicators from a prompt.
 */
function extractTextElements(prompt: string): string[] {
  const elements: string[] = [];

  // Extract quoted strings
  const doubleQuoted = prompt.match(/"([^"]+)"/g) || [];
  const singleQuoted = prompt.match(/'([^']+)'/g) || [];
  elements.push(...doubleQuoted.map(s => s.replace(/['"]/g, '')));
  elements.push(...singleQuoted.map(s => s.replace(/['"]/g, '')));

  // Extract text after indicators
  for (const indicator of ['text:', 'headline:', 'title:', 'quote:', 'cta:', 'slogan:']) {
    const regex = new RegExp(`${indicator}\\s*([^.!?\\n]+)`, 'gi');
    const matches = prompt.match(regex) || [];
    elements.push(...matches.map(m => m.replace(new RegExp(`^${indicator}\\s*`, 'i'), '')));
  }

  return elements.filter(e => e.length > 0);
}

/**
 * Count words in text that need to be rendered.
 */
function countRenderableWords(textElements: string[]): number {
  return textElements.reduce((total, element) => {
    const words = element.trim().split(/\s+/).filter(w => w.length > 0);
    return total + words.length;
  }, 0);
}

/**
 * Analyze a prompt for text content and recommend the appropriate model.
 */
export function analyzePromptForText(prompt: string): TextAnalysisResult {
  const lowerPrompt = prompt.toLowerCase();

  // Check for explicit "no text" or "text-free" indicators
  if (
    lowerPrompt.includes('no text') ||
    lowerPrompt.includes('text-free') ||
    lowerPrompt.includes('without text') ||
    lowerPrompt.includes('visual only') ||
    lowerPrompt.includes('i\'ll add text')
  ) {
    return {
      density: 'text-free',
      wordCount: 0,
      textElements: [],
      recommendedModel: 'imagen-4-ultra',
      requiresGemini: false,
    };
  }

  // Extract text elements
  const textElements = extractTextElements(prompt);
  const wordCount = countRenderableWords(textElements);

  // Check for complex text patterns
  const hasComplexText = COMPLEX_TEXT_PATTERNS.some(pattern => pattern.test(prompt));

  // Check for text indicators in prompt
  const hasTextIndicators = TEXT_INDICATORS.some(indicator =>
    lowerPrompt.includes(indicator.toLowerCase())
  );

  // Determine density and model
  let density: TextDensity;
  let recommendedModel: string;
  let warning: string | undefined;
  let requiresGemini = false;

  if (wordCount === 0 && !hasTextIndicators) {
    density = 'text-free';
    recommendedModel = 'imagen-4-ultra';
  } else if (wordCount <= 5) {
    density = 'minimal';
    recommendedModel = 'ideogram-v3-balanced';
  } else if (wordCount <= 15) {
    density = 'moderate';
    recommendedModel = 'ideogram-v3-quality';
    if (wordCount > 10) {
      warning = 'Moderate text detected. Consider using Gemini for better text rendering.';
    }
  } else if (hasComplexText) {
    density = 'complex';
    recommendedModel = 'gemini-direct';
    requiresGemini = true;
    warning = 'Complex text layout detected. Gemini is strongly recommended for accurate text rendering.';
  } else {
    density = 'heavy';
    recommendedModel = 'gemini-fal';
    requiresGemini = true;
    warning = `Heavy text detected (${wordCount} words). Gemini is recommended to avoid text rendering issues.`;
  }

  return {
    density,
    wordCount,
    textElements,
    recommendedModel,
    warning,
    requiresGemini,
  };
}

/**
 * Check if the selected model is appropriate for the text content.
 * Returns a warning if a better model should be used.
 */
export function checkModelForText(
  selectedModel: string,
  textAnalysis: TextAnalysisResult
): { isAppropriate: boolean; warning?: string; suggestedModel?: string } {
  // If text-free, any model is fine
  if (textAnalysis.density === 'text-free') {
    return { isAppropriate: true };
  }

  // If Gemini is required but not selected
  if (textAnalysis.requiresGemini) {
    const isGemini = selectedModel.includes('gemini');
    if (!isGemini) {
      return {
        isAppropriate: false,
        warning: `This prompt has ${textAnalysis.density} text (${textAnalysis.wordCount} words). ` +
          `${selectedModel} may struggle with text rendering. Gemini is strongly recommended.`,
        suggestedModel: 'gemini-direct',
      };
    }
  }

  // If moderate text but using visual-focused model
  if (textAnalysis.density === 'moderate' || textAnalysis.density === 'minimal') {
    const isVisualModel = selectedModel.includes('imagen') || selectedModel === 'reve';
    if (isVisualModel && textAnalysis.wordCount > 3) {
      return {
        isAppropriate: false,
        warning: `${selectedModel} is optimized for visuals, not text. ` +
          `Consider using Ideogram for better text rendering.`,
        suggestedModel: 'ideogram-v3-balanced',
      };
    }
  }

  return { isAppropriate: true };
}

// ============================================================
// Enhanced Handoff Analysis
// ============================================================

/**
 * Analyze handoff data to recommend a model with text-aware logic.
 * Uses visualSuggestions, format, platform, and text analysis.
 */
export function getRecommendedModelFromHandoffEnhanced(handoff: {
  visualSuggestions?: string[];
  format?: string;
  platform?: string;
  postContent?: {
    hook?: string;
    fullText?: string;
    cta?: string;
  };
}): { model: string; textAnalysis: TextAnalysisResult; platformGuidelines: PlatformGuidelines } {
  const suggestions = handoff.visualSuggestions?.join(' ') || '';
  const platform = handoff.platform || 'general';
  const platformGuidelines = getPlatformGuidelines(platform);

  // Build a pseudo-prompt from handoff for text analysis
  let textContent = suggestions;
  if (handoff.postContent) {
    // Check if visual suggestions include specific text to render
    const textToRender = handoff.visualSuggestions?.filter(s =>
      s.includes('text:') || s.includes('"') || s.includes("'")
    ).join(' ') || '';
    textContent = textToRender;
  }

  const textAnalysis = analyzePromptForText(textContent);

  // If platform prefers text-free and no explicit text requested
  if (platformGuidelines.preferTextFree && textAnalysis.density === 'text-free') {
    return {
      model: 'imagen-4-ultra',
      textAnalysis,
      platformGuidelines,
    };
  }

  // Use text analysis recommendation
  return {
    model: textAnalysis.recommendedModel,
    textAnalysis,
    platformGuidelines,
  };
}

// ============================================================
// Prompt Enhancement Functions
// ============================================================

/**
 * Enhance a prompt with platform-specific guidelines.
 */
export function enhancePromptForPlatform(
  prompt: string,
  platform: Platform | string,
  options: {
    includePrefix?: boolean;
    includeSuffix?: boolean;
    aspectRatio?: string;
  } = {}
): string {
  const { includePrefix = true, includeSuffix = true, aspectRatio } = options;
  const guidelines = getPlatformGuidelines(platform);

  let enhancedPrompt = prompt;

  // Add aspect ratio prefix
  if (aspectRatio) {
    const arPrefix = getAspectRatioPrefix(aspectRatio);
    if (!prompt.toLowerCase().includes('aspect ratio') && !prompt.toLowerCase().includes('format')) {
      enhancedPrompt = `${arPrefix} ${enhancedPrompt}`;
    }
  }

  // Add platform prefix
  if (includePrefix && !prompt.toLowerCase().includes(guidelines.platform)) {
    enhancedPrompt = `${guidelines.promptPrefix} ${enhancedPrompt}`;
  }

  // Add platform suffix with positive-only framing instruction
  if (includeSuffix) {
    // Positive-only: describe what it IS, not what it ISN'T
    const positiveFraming = 'This is the actual social media post image itself, ready to upload. The image fills the entire canvas edge-to-edge. This is the final design, not a preview or mockup.';
    enhancedPrompt = `${enhancedPrompt} ${guidelines.promptSuffix} ${positiveFraming}`;
  }

  return enhancedPrompt;
}

/**
 * Get aspect ratio prefix for prompts.
 */
export function getAspectRatioPrefix(aspectRatio: string): string {
  const defaultPrefix = 'Square format (1:1 aspect ratio, equal width and height).';
  const prefixes: Record<string, string> = {
    '1:1': defaultPrefix,
    '16:9': 'Landscape format (16:9 aspect ratio, wide screen).',
    '9:16': 'Portrait format (9:16 aspect ratio, vertical/mobile).',
    '4:3': 'Landscape format (4:3 aspect ratio).',
    '3:4': 'Portrait format (3:4 aspect ratio).',
  };
  return prefixes[aspectRatio] || defaultPrefix;
}

/**
 * Add text-specific instructions to prompt based on analysis.
 *
 * KEY INSIGHT: We must distinguish between:
 * - VISUAL DESIGN elements (shapes, gradients, patterns) = WANTED
 * - Additional TEXT elements (labels, captions, small text) = NOT WANTED
 *
 * Previous approach said "text is the only element" which removed ALL design.
 * New approach: "text is the only TEXT element" + encourage visual design.
 */
export function addTextInstructions(
  prompt: string,
  textAnalysis: TextAnalysisResult
): string {
  if (textAnalysis.density === 'text-free') {
    // No text at all - encourage rich visual design
    return `${prompt}

VISUAL DESIGN:
Create a visually engaging design with professional elements - geometric shapes, gradients, abstract patterns, layered backgrounds.
The design should have depth and visual interest.

TEXT REQUIREMENT:
This image contains zero text - no letters, no words, no typography anywhere.
The entire canvas is pure visual design with no text characters.`;
  }

  if (textAnalysis.textElements.length > 0) {
    const textList = textAnalysis.textElements.map(t => `"${t}"`).join(' ');

    // KEY FIX: Encourage visual design elements while restricting only TEXT
    const textInstructions = `
VISUAL DESIGN (ENCOURAGED):
Include professional visual elements - geometric shapes, gradients, abstract patterns, layered backgrounds.
The design should have depth and visual interest - not just plain text on solid color.
Use modern corporate aesthetics: diagonal lines, overlapping shapes, color gradients, subtle shadows.
The background should be visually engaging with professional design elements.

TEXT SPECIFICATION:
The phrase ${textList} is the ONLY TEXT in this image.
Display this text in large, bold, professional typography.
The text should be prominently positioned and well-integrated with the visual design.
The text contrasts well with the background for readability.

CRITICAL DISTINCTION:
- Visual design elements (shapes, colors, gradients, patterns) = INCLUDE THESE
- Additional text elements (labels, captions, small text, watermarks) = DO NOT INCLUDE
- The image has rich visual design but contains only ONE text phrase: ${textList}
- Every word in the image is part of the phrase ${textList} - nothing else`;

    if (textAnalysis.requiresGemini) {
      return `${prompt}

${textInstructions}

TYPOGRAPHY:
Ensure perfect text rendering - every letter is crisp and readable.
The text is the hero element integrated with the visual design.`;
    }

    return `${prompt}

${textInstructions}`;
  }

  return prompt;
}

// ============================================================
// Image Reference Capability Helpers
// ============================================================

/**
 * Get models that support style reference
 */
export function getModelsWithStyleReference(): ImageModel[] {
  return Object.values(IMAGE_MODELS).filter(
    m => m.referenceCapabilities?.styleReference
  );
}

/**
 * Get models that support image remix/transformation
 */
export function getModelsWithRemix(): ImageModel[] {
  return Object.values(IMAGE_MODELS).filter(
    m => m.referenceCapabilities?.remix
  );
}

/**
 * Get models that support image editing/inpainting
 */
export function getModelsWithEdit(): ImageModel[] {
  return Object.values(IMAGE_MODELS).filter(
    m => m.referenceCapabilities?.edit
  );
}

/**
 * Check if a model supports a specific reference capability
 */
export function modelSupportsReference(
  modelId: string,
  capability: 'styleReference' | 'remix' | 'edit'
): boolean {
  const model = IMAGE_MODELS[modelId];
  if (!model?.referenceCapabilities) return false;
  return model.referenceCapabilities[capability] ?? false;
}

/**
 * Get the best model for a reference operation
 */
export function getRecommendedModelForReference(
  capability: 'styleReference' | 'remix' | 'edit'
): string {
  // Ideogram is generally best for reference operations due to style_codes support
  switch (capability) {
    case 'styleReference':
      return 'ideogram-v3-balanced'; // Good balance of quality and cost
    case 'remix':
      return 'ideogram-v3-balanced'; // Has strength control
    case 'edit':
      return 'ideogram-v3-balanced'; // Has mask support
    default:
      return DEFAULT_MODEL;
  }
}

/**
 * Format reference capabilities for display
 */
export function formatReferenceCapabilities(): string {
  const lines: string[] = [];

  lines.push('**Models with Style Reference** (generate new image matching a style):');
  for (const model of getModelsWithStyleReference()) {
    const maxRef = model.referenceCapabilities?.maxReferenceImages ?? 1;
    lines.push(`  - ${model.name} (up to ${maxRef} reference image${maxRef > 1 ? 's' : ''})`);
  }

  lines.push('\n**Models with Remix** (transform existing image):');
  for (const model of getModelsWithRemix()) {
    const hasStrength = model.referenceCapabilities?.supportsStrength ? ' + strength control' : '';
    lines.push(`  - ${model.name}${hasStrength}`);
  }

  lines.push('\n**Models with Edit/Inpaint** (modify specific regions):');
  for (const model of getModelsWithEdit()) {
    lines.push(`  - ${model.name}`);
  }

  lines.push('\n**Models WITHOUT reference support:**');
  const noRef = Object.values(IMAGE_MODELS).filter(
    m => !m.referenceCapabilities?.styleReference &&
         !m.referenceCapabilities?.remix &&
         !m.referenceCapabilities?.edit
  );
  for (const model of noRef) {
    lines.push(`  - ${model.name} (text-to-image only)`);
  }

  return lines.join('\n');
}
