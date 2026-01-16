/**
 * Semantic search engine for Smart Connections
 * 
 * Adapted from smart-connections-mcp by Daniel Glickman
 * https://github.com/msdanyg/smart-connections-mcp
 */

import type { SmartSource, SimilarNote, ConnectionGraph, NoteContent } from '../types/smart-connections';
import { cosineSimilarity, findNearestNeighbors } from './embedding-utils';
import type { SmartConnectionsLoader } from './smart-connections-loader';

export class SmartSearchEngine {
  private loader: SmartConnectionsLoader;
  private embeddingModelKey: string;

  constructor(loader: SmartConnectionsLoader) {
    this.loader = loader;
    this.embeddingModelKey = loader.getEmbeddingModelKey();
  }

  /**
   * Find similar notes to a given note path
   */
  getSimilarNotes(
    notePath: string,
    threshold: number = 0.5,
    limit: number = 10
  ): SimilarNote[] {
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
          vec: emb?.vec || [],
          metadata: {
            blocks: Object.keys(src.blocks || {}),
            lastModified: src.last_import?.mtime || 0
          }
        };
      })
      .filter(item => item.vec.length > 0);

    // Find nearest neighbors
    const neighbors = findNearestNeighbors(
      embeddings.vec,
      vectors,
      limit,
      threshold
    );

    // Convert to SimilarNote format
    return neighbors.map(neighbor => ({
      path: neighbor.id,
      similarity: neighbor.similarity,
      blocks: neighbor.metadata.blocks
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
    // Build vector dataset from all sources
    const vectors = Array.from(this.loader.getSources().entries())
      .map(([path, src]) => {
        const emb = src.embeddings[this.embeddingModelKey];
        return {
          id: path,
          vec: emb?.vec || [],
          metadata: {
            blocks: Object.keys(src.blocks || {}),
            lastModified: src.last_import?.mtime || 0
          }
        };
      })
      .filter(item => item.vec.length > 0);

    // Find nearest neighbors
    const neighbors = findNearestNeighbors(
      embeddingVector,
      vectors,
      k,
      threshold
    );

    // Convert to SimilarNote format
    return neighbors.map(neighbor => ({
      path: neighbor.id,
      similarity: neighbor.similarity,
      blocks: neighbor.metadata.blocks
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
      } catch (error) {
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
   * Semantic search approximation using keyword match + embedding similarity
   * Since we don't have the embedding model, we:
   * 1. Find notes matching query keywords
   * 2. Compute centroid of their embeddings
   * 3. Find notes similar to that centroid
   */
  async searchByQuery(
    queryText: string,
    limit: number = 10,
    threshold: number = 0.5
  ): Promise<SimilarNote[]> {
    const queryLower = queryText.toLowerCase();
    
    // Step 1: Find notes that contain the query keywords
    const keywordMatches: Array<{path: string, source: any, matchScore: number}> = [];
    
    for (const [path, source] of this.loader.getSources()) {
      try {
        const content = (await this.loader.readNoteContent(path)).toLowerCase();
        const pathLower = path.toLowerCase();
        
        // Count keyword occurrences
        const contentMatches = (content.match(new RegExp(queryLower, 'g')) || []).length;
        const pathMatches = (pathLower.match(new RegExp(queryLower, 'g')) || []).length;
        
        if (contentMatches > 0 || pathMatches > 0) {
          keywordMatches.push({
            path,
            source,
            matchScore: contentMatches + (pathMatches * 2) // Weight path matches higher
          });
        }
      } catch (error) {
        continue;
      }
    }
    
    // If no keyword matches, return empty
    if (keywordMatches.length === 0) {
      return [];
    }
    
    // Step 2: Get embeddings of top keyword matches and compute centroid
    const topMatches = keywordMatches
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, 5); // Use top 5 for centroid
    
    const embeddings: number[][] = [];
    for (const match of topMatches) {
      const emb = match.source.embeddings[this.embeddingModelKey];
      if (emb?.vec && emb.vec.length > 0) {
        embeddings.push(emb.vec);
      }
    }
    
    if (embeddings.length === 0) {
      // Fall back to keyword-based scoring
      return keywordMatches
        .sort((a, b) => b.matchScore - a.matchScore)
        .slice(0, limit)
        .map(m => ({
          path: m.path,
          similarity: Math.min(m.matchScore / 10, 1.0),
          blocks: Object.keys(m.source.blocks || {})
        }));
    }
    
    // Compute centroid (average of embeddings)
    const centroid = this.computeCentroid(embeddings);
    
    // Step 3: Find notes similar to the centroid
    return this.getEmbeddingNeighbors(centroid, limit, threshold);
  }
  
  /**
   * Compute centroid (mean) of embedding vectors
   */
  private computeCentroid(embeddings: number[][]): number[] {
    if (embeddings.length === 0) return [];
    
    const dimensions = embeddings[0].length;
    const centroid = new Array(dimensions).fill(0);
    
    for (const embedding of embeddings) {
      for (let i = 0; i < dimensions; i++) {
        centroid[i] += embedding[i];
      }
    }
    
    // Average
    for (let i = 0; i < dimensions; i++) {
      centroid[i] /= embeddings.length;
    }
    
    return centroid;
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
