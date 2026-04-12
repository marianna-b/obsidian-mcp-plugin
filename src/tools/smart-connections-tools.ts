/**
 * Smart Connections tools - semantic search using pre-computed embeddings
 * 
 * Adapted from smart-connections-mcp by Daniel Glickman
 * https://github.com/msdanyg/smart-connections-mcp
 */

import { App } from 'obsidian';
import { ObsidianAPI } from '../utils/obsidian-api';
import { SmartConnectionsLoader } from '../utils/smart-connections-loader';
import { SmartSearchEngine } from '../utils/smart-search-engine';
import { Debug } from '../utils/debug';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * Cache for search engine instances with metadata
 */
const searchEngineCache = new WeakMap<App, SmartSearchEngine>();
const cacheMetadata = new WeakMap<App, {
  loadedAt: number;
  configMtime: number;
}>();

// Throttle on-demand checks to max once per minute (for tool calls)
const DEMAND_CHECK_THROTTLE = 60 * 1000; // 1 minute
const lastDemandCheck = new WeakMap<App, number>();

// Periodic refresh interval (set by user, checked in background)
let refreshInterval: ReturnType<typeof setInterval> | null = null;
let currentApp: App | null = null;

/**
 * Clear the search engine cache (manual reload)
 */
export function clearSmartConnectionsCache(app: App): void {
  if (searchEngineCache.has(app)) {
    searchEngineCache.delete(app);
    cacheMetadata.delete(app);
    lastDemandCheck.delete(app);
    Debug.log('🔄 Smart Connections cache cleared');
  }
}

/**
 * Check if Smart Connections data has changed (lightweight - only checks config mtime)
 */
async function hasEmbeddingsChanged(app: App): Promise<boolean> {
  const metadata = cacheMetadata.get(app);
  if (!metadata) return true; // No cache, needs load
  
  try {
    // Only stat the config file - much faster than checking all .ajson files
    const configStat = await app.vault.adapter.stat('.smart-env/smart_env.json');
    const currentMtime = configStat?.mtime || 0;
    
    if (currentMtime > metadata.configMtime) {
      Debug.log('📝 Smart Connections data changed (config mtime updated)');
      return true;
    }
  } catch {
    // If we can't check, assume no change (fail-safe)
    return false;
  }
  
  return false;
}

/**
 * Load or reload the search engine
 */
async function loadSearchEngine(app: App): Promise<SmartSearchEngine> {
  Debug.log('🔄 Loading Smart Connections data...');
  
  const loader = new SmartConnectionsLoader(app);
  await loader.initialize();
  const engine = new SmartSearchEngine(loader);
  
  // Cache the engine
  searchEngineCache.set(app, engine);
  
  // Store metadata for future change detection
  try {
    const configStat = await app.vault.adapter.stat('.smart-env/smart_env.json');
    cacheMetadata.set(app, {
      loadedAt: Date.now(),
      configMtime: configStat?.mtime || 0
    });
  } catch {
    cacheMetadata.set(app, {
      loadedAt: Date.now(),
      configMtime: 0
    });
  }
  
  Debug.log('✅ Smart Connections search engine ready');
  return engine;
}

/**
 * Get search engine with lazy validation (throttled)
 * This is called on every tool invocation
 */
async function getSearchEngine(api: ObsidianAPI): Promise<SmartSearchEngine> {
  const app = api.getApp();
  
  // If no cache, load immediately
  if (!searchEngineCache.has(app)) {
    return await loadSearchEngine(app);
  }
  
  // Throttled check: only validate once per minute per tool call
  const now = Date.now();
  const lastCheck = lastDemandCheck.get(app) || 0;
  
  if (now - lastCheck >= DEMAND_CHECK_THROTTLE) {
    lastDemandCheck.set(app, now);
    
    // Quick check if data changed
    if (await hasEmbeddingsChanged(app)) {
      return await loadSearchEngine(app);
    }
  }
  
  // Return cached engine
  return searchEngineCache.get(app)!;
}

/**
 * Start periodic refresh timer (background)
 */
export function startPeriodicRefresh(app: App, intervalMinutes: number): void {
  stopPeriodicRefresh();
  
  currentApp = app;
  const intervalMs = intervalMinutes * 60 * 1000;
  
  Debug.log(`⏰ Smart Connections periodic refresh started (every ${intervalMinutes} min)`);
  
  refreshInterval = setInterval(() => {
    void (async () => {
      if (!currentApp) return;
      try {
        if (await hasEmbeddingsChanged(currentApp)) {
          Debug.log('🔄 Periodic check: embeddings changed, reloading...');
          await loadSearchEngine(currentApp);
        }
      } catch (error) {
        Debug.error('Error in periodic Smart Connections refresh:', error);
      }
    })();
  }, intervalMs);
}

/**
 * Stop periodic refresh timer
 */
export function stopPeriodicRefresh(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
    currentApp = null;
    Debug.log('⏸️ Smart Connections periodic refresh stopped');
  }
}

/**
 * Check if Smart Connections data is available
 */
export async function hasSmartConnectionsData(api: ObsidianAPI): Promise<boolean> {
  const app = api.getApp();
  const adapter = app.vault.adapter;
  
  try {
    const configExists = await adapter.exists('.smart-env/smart_env.json');
    const multiExists = await adapter.exists('.smart-env/multi');
    return configExists && multiExists;
  } catch {
    return false;
  }
}

/**
 * Check if Smart Connections plugin is installed
 */
export function hasSmartConnectionsPlugin(api: ObsidianAPI): boolean {
  const app = api.getApp();
  const appWithPlugins = app as unknown as { plugins?: { plugins?: Record<string, unknown> } };
  const plugins = appWithPlugins.plugins?.plugins ?? {};
  return !!plugins['smart-connections'];
}

/**
 * Smart Connections MCP tools
 */
export const smartConnectionsTools: Tool[] = [
  {
    name: 'smart_similar_notes',
    description: '🧠 Find notes semantically similar to a given note using embeddings. Returns paths, similarity scores, and available blocks.',
    inputSchema: {
      type: 'object',
      properties: {
        note_path: {
          type: 'string',
          description: 'Path to the note (e.g., "Note.md" or "Folder/Note.md")'
        },
        threshold: {
          type: 'number',
          description: 'Similarity threshold (0-1), default 0.5',
          minimum: 0,
          maximum: 1,
          default: 0.5
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results, default 10',
          minimum: 1,
          default: 10
        }
      },
      required: ['note_path']
    }
  },
  
  {
    name: 'smart_connection_graph',
    description: '🕸️ Build a multi-level connection graph starting from a note, showing how notes are semantically connected.',
    inputSchema: {
      type: 'object',
      properties: {
        note_path: {
          type: 'string',
          description: 'Path to the note to start from'
        },
        depth: {
          type: 'number',
          description: 'Depth of the connection graph (levels), default 2',
          minimum: 1,
          default: 2
        },
        threshold: {
          type: 'number',
          description: 'Similarity threshold (0-1), default 0.6',
          minimum: 0,
          maximum: 1,
          default: 0.6
        },
        max_per_level: {
          type: 'number',
          description: 'Max connections per level, default 5',
          minimum: 1,
          default: 5
        }
      },
      required: ['note_path']
    }
  },
  
  {
    name: 'smart_search_notes',
    description: '🔍 Search using a text query. Returns individual blocks (if available) or notes ranked by relevance with similarity scores.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query text'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results, default 10',
          minimum: 1,
          default: 10
        },
        threshold: {
          type: 'number',
          description: 'Similarity threshold (0-1), default 0.5',
          minimum: 0,
          maximum: 1,
          default: 0.5
        }
      },
      required: ['query']
    }
  },
  
  {
    name: 'smart_embedding_neighbors',
    description: '🎯 Find nearest neighbors for a given embedding vector. Useful for custom similarity searches.',
    inputSchema: {
      type: 'object',
      properties: {
        embedding_vector: {
          type: 'array',
          items: { type: 'number' },
          description: '384-dimensional embedding vector'
        },
        k: {
          type: 'number',
          description: 'Number of neighbors to return, default 10',
          minimum: 1,
          default: 10
        },
        threshold: {
          type: 'number',
          description: 'Similarity threshold (0-1), default 0.5',
          minimum: 0,
          maximum: 1,
          default: 0.5
        }
      },
      required: ['embedding_vector']
    }
  },
  
  {
    name: 'smart_note_content',
    description: '📄 Retrieve the full content of a note with Smart Connections metadata, optionally with specific blocks/sections extracted.',
    inputSchema: {
      type: 'object',
      properties: {
        note_path: {
          type: 'string',
          description: 'Path to the note'
        },
        include_blocks: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific block headings to include (optional)'
        }
      },
      required: ['note_path']
    }
  },
  
  {
    name: 'smart_stats',
    description: 'ℹ️ Get statistics about the Smart Connections knowledge base (total notes, blocks, embedding model, etc.).',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];

/**
 * Create tool handlers for Smart Connections tools
 */
export function createSmartConnectionsToolHandlers(api: ObsidianAPI): Map<string, (args: unknown) => Promise<unknown>> {
  const handlers = new Map<string, (args: unknown) => Promise<unknown>>();

  handlers.set('smart_similar_notes', async (args: unknown) => {
    const engine = await getSearchEngine(api);
    const { note_path, threshold = 0.5, limit = 10 } = args as { note_path: string; threshold?: number; limit?: number };
    const results = engine.getSimilarNotes(note_path, threshold, limit);
    
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(results, null, 2)
      }]
    };
  });

  handlers.set('smart_connection_graph', async (args: unknown) => {
    const engine = await getSearchEngine(api);
    const { note_path, depth = 2, threshold = 0.6, max_per_level = 5 } = args as { note_path: string; depth?: number; threshold?: number; max_per_level?: number };
    const graph = engine.getConnectionGraph(note_path, depth, threshold, max_per_level);
    
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(graph, null, 2)
      }]
    };
  });

  handlers.set('smart_search_notes', async (args: unknown) => {
    const engine = await getSearchEngine(api);
    const { query, limit = 10, threshold = 0.5 } = args as { query: string; limit?: number; threshold?: number };
    const results = await engine.searchByQuery(query, limit, threshold);
    
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(results, null, 2)
      }]
    };
  });

  handlers.set('smart_embedding_neighbors', async (args: unknown) => {
    const engine = await getSearchEngine(api);
    const { embedding_vector, k = 10, threshold = 0.5 } = args as { embedding_vector: number[]; k?: number; threshold?: number };
    const results = engine.getEmbeddingNeighbors(embedding_vector, k, threshold);
    
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(results, null, 2)
      }]
    };
  });

  handlers.set('smart_note_content', async (args: unknown) => {
    const engine = await getSearchEngine(api);
    const { note_path, include_blocks } = args as { note_path: string; include_blocks?: string[] };
    const result = await engine.getNoteWithContext(note_path, include_blocks);
    
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(result, null, 2)
      }]
    };
  });

  handlers.set('smart_stats', async (args: unknown) => {
    const engine = await getSearchEngine(api);
    const stats = engine.getStats();
    
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(stats, null, 2)
      }]
    };
  });

  return handlers;
}

/**
 * Create Smart Connections tools with handlers if enabled and data is available
 */
export async function createSmartConnectionsTools(api?: ObsidianAPI, settings?: unknown): Promise<{ tools: Tool[]; handlers: Map<string, (args: unknown) => Promise<unknown>> }> {
  // Check settings toggle first
  const typedSettings = settings as { enableSmartConnections?: boolean } | undefined;
  if (!typedSettings?.enableSmartConnections) {
    Debug.log('Smart Connections tools disabled in settings');
    return { tools: [], handlers: new Map() };
  }
  
  // Then check if data is available
  if (!api || !(await hasSmartConnectionsData(api))) {
    Debug.warn('Smart Connections enabled but data not found');
    return { tools: [], handlers: new Map() };
  }
  
  Debug.log('✅ Smart Connections tools enabled (6 tools added)');
  const handlers = createSmartConnectionsToolHandlers(api);
  return { tools: smartConnectionsTools, handlers };
}
