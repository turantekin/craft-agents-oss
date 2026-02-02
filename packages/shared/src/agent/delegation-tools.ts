/**
 * Delegation Tools
 *
 * Global MCP tools that allow Claude to delegate specific tasks to other AI models:
 * - Perplexity: Real-time web search with citations
 * - Gemini: Large context analysis (1M+ tokens)
 * - OpenAI: Advanced reasoning and analysis (o3, o4-mini, gpt-4.1)
 *
 * These tools are "global" (not session-scoped) because they:
 * 1. Don't need session-specific callbacks
 * 2. Access global API keys from CredentialManager
 * 3. Don't require user interaction during execution
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { getCredentialManager } from '../credentials/index.ts';
import { debug } from '../utils/debug.ts';

// ============================================================
// Perplexity Search Tool
// ============================================================

/**
 * Perplexity API response structure
 */
interface PerplexityResponse {
  id: string;
  model: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  citations?: string[];
}

const perplexitySearchTool = tool(
  'perplexity_search',
  `Search the web in real-time using Perplexity AI.

Use this tool when you need:
- Current information beyond your knowledge cutoff
- Real-time data (news, prices, weather, events)
- Fact-checking with citations
- Research on recent topics

The tool returns search results with citations/URLs for verification.

**Important:** This delegates to Perplexity AI - it's a separate API call.
Only use when you actually need real-time web information.

**Available models:**
- sonar (default): Fast, lightweight search
- sonar-pro: Deeper retrieval with follow-ups
- sonar-reasoning: Complex problem solving with search
- sonar-reasoning-pro: Advanced reasoning (DeepSeek R1 based)
- sonar-deep-research: Expert-level comprehensive research`,
  {
    query: z.string().describe('The search query - be specific and detailed for better results'),
    model: z.enum(['sonar', 'sonar-pro', 'sonar-reasoning', 'sonar-reasoning-pro', 'sonar-deep-research'])
      .optional()
      .describe('Model to use. sonar=fast search, sonar-pro=deeper retrieval, sonar-reasoning=complex problems, sonar-deep-research=expert research. Default: sonar'),
  },
  async (args) => {
    const { query, model = 'sonar' } = args;
    debug(`[perplexity_search] Query: ${query}, Model: ${model}`);

    try {
      const manager = getCredentialManager();
      const apiKey = await manager.getPerplexityApiKey();

      if (!apiKey) {
        return {
          content: [{
            type: 'text' as const,
            text: 'Perplexity API key not configured. Ask the user to add their Perplexity API key in Settings > App > Integrations.',
          }],
          isError: true,
        };
      }

      // Build request body
      const requestBody: Record<string, unknown> = {
        model, // User-selected Perplexity model
        messages: [
          {
            role: 'system',
            content: 'You are a helpful search assistant. Provide accurate, well-sourced information with citations.',
          },
          {
            role: 'user',
            content: query,
          },
        ],
        return_citations: true,
      };

      const response = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        debug(`[perplexity_search] API error: ${response.status} - ${errorText}`);

        if (response.status === 401) {
          return {
            content: [{
              type: 'text' as const,
              text: 'Perplexity API key is invalid. Ask the user to check their API key in Settings > App > Integrations.',
            }],
            isError: true,
          };
        }

        if (response.status === 429) {
          return {
            content: [{
              type: 'text' as const,
              text: 'Perplexity API rate limit exceeded. Please wait a moment and try again.',
            }],
            isError: true,
          };
        }

        return {
          content: [{
            type: 'text' as const,
            text: `Perplexity API error (${response.status}): ${errorText}`,
          }],
          isError: true,
        };
      }

      const data = await response.json() as PerplexityResponse;
      const content = data.choices[0]?.message?.content || 'No results found.';
      const citations = data.citations || [];

      // Format response with citations
      let result = content;
      if (citations.length > 0) {
        result += '\n\n**Sources:**\n';
        citations.forEach((url, i) => {
          result += `[${i + 1}] ${url}\n`;
        });
      }

      debug(`[perplexity_search] Success, ${citations.length} citations`);
      return {
        content: [{
          type: 'text' as const,
          text: result,
        }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      debug(`[perplexity_search] Error: ${message}`);
      return {
        content: [{
          type: 'text' as const,
          text: `Perplexity search failed: ${message}`,
        }],
        isError: true,
      };
    }
  }
);

// ============================================================
// Gemini Analysis Tool
// ============================================================

/**
 * Gemini API response structure
 */
interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text: string;
      }>;
    };
    finishReason: string;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

const geminiAnalyzeTool = tool(
  'gemini_analyze',
  `Analyze large amounts of text using Google Gemini's 1M+ token context window.

Use this tool when you need to:
- Analyze very long documents that exceed Claude's context
- Process multiple large files together
- Summarize extensive codebases or documentation
- Find patterns across large text corpora

**Important:** This delegates to Google Gemini - it's a separate API call.
Only use when the content is too large for Claude to handle directly.

The tool accepts text content and a prompt describing what analysis to perform.

**Available models:**
- gemini-2.5-flash (default): Fast, stable, 1M context
- gemini-2.5-flash-lite: Ultra-efficient for simple tasks
- gemini-2.5-pro: Most powerful with adaptive thinking
- gemini-3-flash-preview: Latest for complex multimodal
- gemini-3-pro-preview: Latest reasoning-first model`,
  {
    content: z.string().describe('The text content to analyze (can be very large, up to 1M tokens)'),
    prompt: z.string().describe('What analysis to perform on the content'),
    model: z.enum(['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-3-flash-preview', 'gemini-3-pro-preview'])
      .optional()
      .describe('Model to use. gemini-2.5-flash=fast/stable, gemini-2.5-pro=most powerful, gemini-3-*-preview=latest. Default: gemini-2.5-flash'),
  },
  async (args) => {
    const { content, prompt, model = 'gemini-2.5-flash' } = args;
    debug(`[gemini_analyze] Model: ${model}, Content length: ${content.length}, Prompt: ${prompt.substring(0, 100)}...`);

    try {
      const manager = getCredentialManager();
      const apiKey = await manager.getGeminiApiKey();

      if (!apiKey) {
        return {
          content: [{
            type: 'text' as const,
            text: 'Gemini API key not configured. Ask the user to add their Google Gemini API key in Settings > App > Integrations.',
          }],
          isError: true,
        };
      }

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: `${prompt}\n\n---\n\nContent to analyze:\n\n${content}`,
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 8192,
            },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        debug(`[gemini_analyze] API error: ${response.status} - ${errorText}`);

        if (response.status === 401 || response.status === 403) {
          return {
            content: [{
              type: 'text' as const,
              text: 'Gemini API key is invalid or lacks permissions. Ask the user to check their API key in Settings > App > Integrations.',
            }],
            isError: true,
          };
        }

        if (response.status === 429) {
          return {
            content: [{
              type: 'text' as const,
              text: 'Gemini API rate limit exceeded. Please wait a moment and try again.',
            }],
            isError: true,
          };
        }

        return {
          content: [{
            type: 'text' as const,
            text: `Gemini API error (${response.status}): ${errorText}`,
          }],
          isError: true,
        };
      }

      const data = await response.json() as GeminiResponse;
      const result = data.candidates[0]?.content?.parts[0]?.text || 'No analysis generated.';
      const usage = data.usageMetadata;

      let output = result;
      if (usage) {
        output += `\n\n---\n_Gemini tokens: ${usage.promptTokenCount} in, ${usage.candidatesTokenCount} out_`;
      }

      debug(`[gemini_analyze] Success, ${usage?.totalTokenCount || 'unknown'} total tokens`);
      return {
        content: [{
          type: 'text' as const,
          text: output,
        }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      debug(`[gemini_analyze] Error: ${message}`);
      return {
        content: [{
          type: 'text' as const,
          text: `Gemini analysis failed: ${message}`,
        }],
        isError: true,
      };
    }
  }
);

// ============================================================
// OpenAI Analysis Tool
// ============================================================

/**
 * OpenAI API response structure
 */
interface OpenAIResponse {
  id: string;
  model: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    completion_tokens_details?: {
      reasoning_tokens: number;
    };
  };
}

const openaiAnalyzeTool = tool(
  'openai_analyze',
  `Analyze tasks using OpenAI models, including advanced reasoning models.

Use this tool when you need:
- Complex multi-step reasoning or problem solving
- Mathematical calculations or proofs
- Code generation or analysis requiring deep thinking
- Logical deduction or structured analysis

**Important:** This delegates to OpenAI - it's a separate API call.
Only use when the task benefits from OpenAI's specific capabilities.

**Available models:**
- gpt-4.1-mini (default): Fast, efficient for most tasks
- gpt-4.1: Most capable non-reasoning model, 1M context
- o3: Advanced reasoning for complex problems
- o4-mini: Fast reasoning, cost-efficient

**Reasoning effort** (o-series only): low, medium (default), high`,
  {
    prompt: z.string().describe('The task or question to analyze'),
    context: z.string().optional().describe('Optional additional context or data'),
    model: z.enum(['gpt-4.1', 'gpt-4.1-mini', 'o3', 'o4-mini'])
      .optional()
      .describe('Model to use. gpt-4.1-mini=fast, gpt-4.1=powerful, o3=advanced reasoning, o4-mini=fast reasoning. Default: gpt-4.1-mini'),
    reasoning_effort: z.enum(['low', 'medium', 'high'])
      .optional()
      .describe('For o-series models: reasoning depth. low=fast, medium=balanced, high=thorough. Default: medium'),
  },
  async (args) => {
    const { prompt, context, model = 'gpt-4.1-mini', reasoning_effort = 'medium' } = args;
    const isReasoningModel = model.startsWith('o');
    debug(`[openai_analyze] Model: ${model}, Reasoning: ${isReasoningModel ? reasoning_effort : 'N/A'}, Prompt: ${prompt.substring(0, 100)}...`);

    try {
      const manager = getCredentialManager();
      const apiKey = await manager.getOpenAIApiKey();

      if (!apiKey) {
        return {
          content: [{
            type: 'text' as const,
            text: 'OpenAI API key not configured. Ask the user to add their OpenAI API key in Settings > App > Integrations.',
          }],
          isError: true,
        };
      }

      // Build the user message content
      let userContent = prompt;
      if (context) {
        userContent = `${prompt}\n\n---\n\nContext:\n\n${context}`;
      }

      // Build request body - differs for reasoning vs non-reasoning models
      const requestBody: Record<string, unknown> = {
        model,
        messages: [
          {
            role: 'user',
            content: userContent,
          },
        ],
        max_completion_tokens: 16384,
      };

      // Add model-specific parameters
      if (isReasoningModel) {
        // o-series models: use reasoning_effort, no temperature
        requestBody.reasoning_effort = reasoning_effort;
      } else {
        // gpt-4.1 series: use temperature
        requestBody.temperature = 0.7;
      }

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        debug(`[openai_analyze] API error: ${response.status} - ${errorText}`);

        if (response.status === 401) {
          return {
            content: [{
              type: 'text' as const,
              text: 'OpenAI API key is invalid. Ask the user to check their API key in Settings > App > Integrations.',
            }],
            isError: true,
          };
        }

        if (response.status === 402) {
          return {
            content: [{
              type: 'text' as const,
              text: 'OpenAI API quota exceeded. Please check your billing settings at platform.openai.com.',
            }],
            isError: true,
          };
        }

        if (response.status === 404) {
          return {
            content: [{
              type: 'text' as const,
              text: `Model "${model}" is not available. It may require organization verification. Try gpt-4.1-mini instead.`,
            }],
            isError: true,
          };
        }

        if (response.status === 429) {
          return {
            content: [{
              type: 'text' as const,
              text: 'OpenAI API rate limit exceeded. Please wait a moment and try again.',
            }],
            isError: true,
          };
        }

        return {
          content: [{
            type: 'text' as const,
            text: `OpenAI API error (${response.status}): ${errorText}`,
          }],
          isError: true,
        };
      }

      const data = await response.json() as OpenAIResponse;
      const result = data.choices[0]?.message?.content || 'No response generated.';
      const usage = data.usage;

      // Format output with usage metadata
      let output = result;
      if (usage) {
        output += `\n\n---\n_OpenAI tokens: ${usage.prompt_tokens} in, ${usage.completion_tokens} out`;
        if (usage.completion_tokens_details?.reasoning_tokens) {
          output += ` (${usage.completion_tokens_details.reasoning_tokens} reasoning)`;
        }
        output += '_';
      }

      debug(`[openai_analyze] Success, ${usage?.total_tokens || 'unknown'} total tokens`);
      return {
        content: [{
          type: 'text' as const,
          text: output,
        }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      debug(`[openai_analyze] Error: ${message}`);
      return {
        content: [{
          type: 'text' as const,
          text: `OpenAI analysis failed: ${message}`,
        }],
        isError: true,
      };
    }
  }
);

// ============================================================
// Delegation Tools Server
// ============================================================

let cachedDelegationServer: ReturnType<typeof createSdkMcpServer> | null = null;

/**
 * Get the delegation tools MCP server.
 * Creates and caches the server on first call.
 */
export function getDelegationToolsServer(): ReturnType<typeof createSdkMcpServer> {
  if (!cachedDelegationServer) {
    cachedDelegationServer = createSdkMcpServer({
      name: 'delegation',
      version: '1.0.0',
      tools: [perplexitySearchTool, geminiAnalyzeTool, openaiAnalyzeTool],
    });
    debug('[delegation-tools] Server created');
  }
  return cachedDelegationServer;
}
