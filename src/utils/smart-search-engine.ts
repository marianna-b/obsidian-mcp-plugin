/**
 * Semantic search engine for Smart Connections
 * 
 * Adapted from smart-connections-mcp by Daniel Glickman
 * https://github.com/msdanyg/smart-connections-mcp
 */

import type { SimilarNote, BlockResult, ConnectionGraph, NoteContent } from '../types/smart-connections';
import { findNearestNeighbors } from './embedding-utils';
import type { SmartConnectionsLoader } from './smart-connections-loader';

interface SmartEmbedModel {
  embed_batch?: (inputs: Array<{ embed_input: string }>) => Promise<Array<{ vec?: number[] }>>;
  embed?: (text: string) => Promise<{ vec?: number[] } | number[] | null | undefined>;
}

type SourceMetadata = { blocks: string[]; lastModified: number };
type BlockMetadata = { path: string; block: string; lines: [number, number] };

export class SmartSearchEngine {
  private loader: SmartConnectionsLoader;
  private embeddingModelKey: string;

  constructor(loader: SmartConnectionsLoader) {
    this.loader = loader;
    this.embeddingModelKey = loader.getEmbeddingModelKey();
  }

  /**
   * Validate search parameters
   */
  private validateParams(limit: number, threshold: number): void {
    if (!Number.isFinite(limit) || limit < 1) {
      throw new Error(`Invalid limit: ${limit}. Must be a positive number.`);
    }
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
      throw new Error(`Invalid threshold: ${threshold}. Must be between 0 and 1.`);
    }
  }

  /**
   * Normalize path for consistent case handling
   */
  private normalizePath(path: string): string {
    // Preserve original path but use lowercase for comparison
    return path;
  }

  /**
   * Find similar notes to a given note path
   */
  getSimilarNotes(
    notePath: string,
    threshold: number = 0.5,
    limit: number = 10
  ): SimilarNote[] {
    this.validateParams(limit, threshold);
    
    const source = this.loader.getSource(notePath);

    if (!source) {
      throw new Error(`Note not found: ${notePath}`);
    }

    const embeddings = source.embeddings[this.embeddingModelKey];

    if (!embeddings || !embeddings.vec) {
      throw new Error(`No embeddings found for note: ${notePath}`);
    }

    // Build vector dataset from all sources
    const vectors = Array.from(this.loader.getSources().entries())
      .filter(([path]) => path !== notePath) // Exclude the query note itself
      .map(([path, src]) => {
        const emb = src.embeddings[this.embeddingModelKey];
        return {
          id: path,
          vec: emb?.vec ?? [],
          metadata: {
            blocks: Object.keys(src.blocks ?? {}),
            lastModified: src.last_import?.mtime ?? 0
          } as SourceMetadata
        };
      })
      .filter(item => item.vec.length > 0);

    // Find nearest neighbors
    const neighbors = findNearestNeighbors<SourceMetadata>(
      embeddings.vec,
      vectors,
      limit,
      threshold
    );

    // Convert to SimilarNote format
    return neighbors.map(neighbor => ({
      path: neighbor.id,
      similarity: neighbor.similarity,
      blocks: neighbor.metadata?.blocks
    }));
  }

  /**
   * Get embedding neighbors for a given embedding vector
   */
  getEmbeddingNeighbors(
    embeddingVector: number[],
    k: number = 10,
    threshold: number = 0.5
  ): SimilarNote[] {
    this.validateParams(k, threshold);
    
    // Build vector dataset from all sources
    const vectors = Array.from(this.loader.getSources().entries())
      .map(([path, src]) => {
        const emb = src.embeddings[this.embeddingModelKey];
        return {
          id: path,
          vec: emb?.vec ?? [],
          metadata: {
            blocks: Object.keys(src.blocks ?? {}),
            lastModified: src.last_import?.mtime ?? 0
          } as SourceMetadata
        };
      })
      .filter(item => item.vec.length > 0);

    // Find nearest neighbors
    const neighbors = findNearestNeighbors<SourceMetadata>(
      embeddingVector,
      vectors,
      k,
      threshold
    );

    // Convert to SimilarNote format
    return neighbors.map(neighbor => ({
      path: neighbor.id,
      similarity: neighbor.similarity,
      blocks: neighbor.metadata?.blocks
    }));
  }

  /**
   * Build a connection graph starting from a note
   */
  getConnectionGraph(
    notePath: string,
    depth: number = 2,
    threshold: number = 0.6,
    maxPerLevel: number = 5
  ): ConnectionGraph {
    this.validateParams(maxPerLevel, threshold);
    
    if (!Number.isFinite(depth) || depth < 1) {
      throw new Error(`Invalid depth: ${depth}. Must be a positive number.`);
    }
    
    const visited = new Set<string>();
    const flatConnections: Array<{ path: string; depth: number; similarity: number }> = [];

    const buildGraph = (
      currentPath: string,
      currentDepth: number,
      parentSimilarity: number = 1.0
    ): void => {
      visited.add(currentPath);

      // Add to flat list (skip root at depth 0)
      if (currentDepth > 0) {
        flatConnections.push({
          path: currentPath,
          depth: currentDepth,
          similarity: parentSimilarity
        });
      }

      // Stop if we've reached max depth
      if (currentDepth >= depth) {
        return;
      }

      // Find similar notes
      try {
        const similar = this.getSimilarNotes(
          currentPath,
          threshold,
          maxPerLevel
        );

        // Recursively build connections
        for (const sim of similar) {
          // Skip already visited nodes to prevent cycles
          if (!visited.has(sim.path)) {
            buildGraph(
              sim.path,
              currentDepth + 1,
              sim.similarity
            );
          }
        }
      } catch {
        // Skip nodes that can't be processed
      }
    };

    buildGraph(notePath, 0);

    return {
      root: notePath,
      connections: flatConnections
    };
  }

  /**
   * Semantic search by embedding the query text
   * Uses Smart Connections' loaded embedding model if available
   * Returns individual block results for more precise matches
   */
  async searchByQuery(
    queryText: string,
    limit: number = 10,
    threshold: number = 0.5
  ): Promise<BlockResult[] | SimilarNote[]> {
    this.validateParams(limit, threshold);
    
    if (!queryText || typeof queryText !== 'string' || queryText.trim().length === 0) {
      throw new Error('Invalid query: query text must be a non-empty string.');
    }
    
    // Try to get the embedding model from Smart Connections
    const embedModel = this.getSmartConnectionsEmbedModel();
    
    if (!embedModel) {
      throw new Error('Smart Connections embedding model not available. Make sure Smart Connections plugin is installed and enabled.');
    }
    
    // Embed the query text
    const queryEmbedding = await this.embedQuery(embedModel, queryText);
    
    if (!queryEmbedding || queryEmbedding.length === 0) {
      throw new Error('Failed to embed query text');
    }
    
    // Cap at 50 to prevent large responses
    const maxResults = Math.min(limit, 50);
    
    // Build vector dataset from blocks (if available) or fall back to sources
    const blocks = this.loader.getBlocks();
    
    if (blocks.size > 0) {
      // Search at block level and return individual blocks
      const blockVectors = Array.from(blocks.entries())
        .map(([key, block]) => {
          const emb = block.embeddings[this.embeddingModelKey];
          return {
            id: key,
            vec: emb?.vec ?? [],
            metadata: {
              path: key.split('#')[0], // Extract path from "path#heading"
              block: key.split('#')[1] ?? '', // Extract heading
              lines: block.lines
            } as BlockMetadata
          };
        })
        .filter(item => item.vec.length > 0);
      
      // Find nearest neighbors at block level
      const neighbors = findNearestNeighbors<BlockMetadata>(
        queryEmbedding,
        blockVectors,
        maxResults,
        threshold
      );
      
      // Deduplicate by normalized key (case-insensitive)
      const seen = new Map<string, BlockResult>();
      for (const neighbor of neighbors) {
        const normalizedKey = neighbor.id.toLowerCase();
        
        if (!seen.has(normalizedKey) || neighbor.similarity > seen.get(normalizedKey)!.similarity) {
          seen.set(normalizedKey, {
            key: neighbor.id,
            path: neighbor.metadata?.path ?? '',
            block: neighbor.metadata?.block ?? '',
            similarity: neighbor.similarity,
            lines: neighbor.metadata?.lines ?? [0, 0]
          });
        }
      }
      
      return Array.from(seen.values())
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);
    } else {
      // Fall back to note-level search
      const results = this.getEmbeddingNeighbors(queryEmbedding, maxResults, threshold);
      
      // Deduplicate by path (case-insensitive)
      const seen = new Map<string, SimilarNote>();
      for (const result of results) {
        const normalizedPath = result.path.toLowerCase();
        if (!seen.has(normalizedPath) || result.similarity > seen.get(normalizedPath)!.similarity) {
          seen.set(normalizedPath, result);
        }
      }
      
      return Array.from(seen.values())
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);
    }
  }
  
  /**
   * Get Smart Connections' embedding model from the global environment
   */
  private getSmartConnectionsEmbedModel(): SmartEmbedModel | null {
    // Check for Smart Connections' global smart_env
    interface WindowWithSmartEnv {
      smart_env?: {
        smart_sources?: { embed_model?: SmartEmbedModel };
        embedding_models?: { default?: { instance?: SmartEmbedModel } };
      };
    }
    const win = window as WindowWithSmartEnv;
    return win.smart_env?.smart_sources?.embed_model ??
           win.smart_env?.embedding_models?.default?.instance ??
           null;
  }
  
  /**
   * Embed query text using Smart Connections' model
   */
  private async embedQuery(model: SmartEmbedModel, text: string): Promise<number[]> {
    try {
      // Smart Connections embed_model has an embed_batch method
      if (typeof model.embed_batch === 'function') {
        const results = await model.embed_batch([{ embed_input: text }]);
        return results[0]?.vec ?? [];
      }
      
      // Fallback: try embed method
      if (typeof model.embed === 'function') {
        const result = await model.embed(text);
        if (Array.isArray(result)) return result;
        return result?.vec ?? [];
      }
      
      throw new Error('Embedding model does not have embed_batch or embed method');
    } catch (error) {
      console.error('Error embedding query:', error);
      throw error;
    }
  }
  

  /**
   * Get note content with matched blocks highlighted
   */
  async getNoteWithContext(
    notePath: string,
    includeBlocks: string[] = []
  ): Promise<NoteContent> {
    const content = await this.loader.readNoteContent(notePath);
    const source = this.loader.getSource(notePath);
    const availableBlocks = source ? Object.keys(source.blocks || {}) : [];

    return {
      path: notePath,
      content,
      blocks: availableBlocks
    };
  }

  /**
   * Get statistics about the knowledge base
   */
  getStats(): {
    totalNotes: number;
    totalBlocks: number;
    embeddingDimension: number;
    modelKey: string;
  } {
    const sources = this.loader.getSources();
    let totalBlocks = 0;
    let embeddingDim = 0;

    for (const source of sources.values()) {
      totalBlocks += Object.keys(source.blocks || {}).length;

      if (embeddingDim === 0) {
        const emb = source.embeddings[this.embeddingModelKey];
        if (emb?.vec) {
          embeddingDim = emb.vec.length;
        }
      }
    }

    return {
      totalNotes: sources.size,
      totalBlocks,
      embeddingDimension: embeddingDim,
      modelKey: this.embeddingModelKey
    };
  }
}
