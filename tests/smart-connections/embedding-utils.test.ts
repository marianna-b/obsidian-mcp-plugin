import { describe, it, expect } from '@jest/globals';
import {
  cosineSimilarity,
  findNearestNeighbors,
  normalizeVector
} from '../../src/utils/embedding-utils';

describe('Embedding Utils', () => {
  describe('cosineSimilarity', () => {
    it('should calculate similarity correctly for identical vectors', () => {
      const vec1 = [1, 2, 3];
      const vec2 = [1, 2, 3];
      expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(1.0, 5);
    });

    it('should calculate similarity correctly for orthogonal vectors', () => {
      const vec1 = [1, 0, 0];
      const vec2 = [0, 1, 0];
      expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(0.0, 5);
    });

    it('should calculate similarity correctly for opposite vectors', () => {
      const vec1 = [1, 0, 0];
      const vec2 = [-1, 0, 0];
      expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(-1.0, 5);
    });

    it('should handle zero vectors', () => {
      const vec1 = [0, 0, 0];
      const vec2 = [1, 2, 3];
      expect(cosineSimilarity(vec1, vec2)).toBe(0);
    });

    it('should throw error for vectors of different lengths', () => {
      const vec1 = [1, 2, 3];
      const vec2 = [1, 2];
      expect(() => cosineSimilarity(vec1, vec2)).toThrow('Vectors must have the same length');
    });

    it('should handle high-dimensional vectors', () => {
      // Simulate 384-dimensional embeddings
      const vec1 = Array(384).fill(0).map(() => Math.random());
      const vec2 = [...vec1]; // Copy
      expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(1.0, 5);
    });
  });

  describe('normalizeVector', () => {
    it('should normalize a vector to unit length', () => {
      const vec = [3, 4];
      const normalized = normalizeVector(vec);
      expect(normalized[0]).toBeCloseTo(0.6, 5);
      expect(normalized[1]).toBeCloseTo(0.8, 5);
      
      // Check magnitude is 1
      const magnitude = Math.sqrt(normalized.reduce((sum, val) => sum + val * val, 0));
      expect(magnitude).toBeCloseTo(1.0, 5);
    });

    it('should handle zero vector', () => {
      const vec = [0, 0, 0];
      const normalized = normalizeVector(vec);
      expect(normalized).toEqual([0, 0, 0]);
    });

    it('should handle single-dimension vector', () => {
      const vec = [5];
      const normalized = normalizeVector(vec);
      expect(normalized[0]).toBeCloseTo(1.0, 5);
    });
  });

  describe('findNearestNeighbors', () => {
    it('should find k nearest neighbors correctly', () => {
      const query = [1, 0, 0];
      const vectors = [
        { id: 'a', vec: [1, 0, 0], metadata: {} },      // similarity: 1.0
        { id: 'b', vec: [0.9, 0.1, 0], metadata: {} },  // similarity: ~0.995
        { id: 'c', vec: [0, 1, 0], metadata: {} },      // similarity: 0.0
        { id: 'd', vec: [0.5, 0.5, 0], metadata: {} },  // similarity: ~0.707
        { id: 'e', vec: [-1, 0, 0], metadata: {} }      // similarity: -1.0
      ];

      const neighbors = findNearestNeighbors(query, vectors, 3);
      
      expect(neighbors).toHaveLength(3);
      expect(neighbors[0].id).toBe('a');
      expect(neighbors[0].similarity).toBeCloseTo(1.0, 2);
      expect(neighbors[1].id).toBe('b');
      expect(neighbors[2].id).toBe('d');
    });

    it('should respect similarity threshold', () => {
      const query = [1, 0, 0];
      const vectors = [
        { id: 'a', vec: [1, 0, 0], metadata: {} },      // similarity: 1.0
        { id: 'b', vec: [0.9, 0.1, 0], metadata: {} },  // similarity: ~0.995
        { id: 'c', vec: [0, 1, 0], metadata: {} },      // similarity: 0.0
        { id: 'd', vec: [0.5, 0.5, 0], metadata: {} }   // similarity: ~0.707
      ];

      const neighbors = findNearestNeighbors(query, vectors, 10, 0.9);
      
      // Only 'a' and 'b' should pass threshold of 0.9
      expect(neighbors.length).toBeLessThanOrEqual(2);
      expect(neighbors.every(n => n.similarity >= 0.9)).toBe(true);
    });

    it('should preserve metadata', () => {
      const query = [1, 0, 0];
      const vectors = [
        { id: 'note1', vec: [1, 0, 0], metadata: { blocks: ['#intro', '#content'], lastModified: 123456 } }
      ];

      const neighbors = findNearestNeighbors(query, vectors, 1);
      
      expect(neighbors[0].metadata).toEqual({ blocks: ['#intro', '#content'], lastModified: 123456 });
    });

    it('should return empty array if no vectors pass threshold', () => {
      const query = [1, 0, 0];
      const vectors = [
        { id: 'a', vec: [0, 1, 0], metadata: {} },
        { id: 'b', vec: [0, 0, 1], metadata: {} }
      ];

      const neighbors = findNearestNeighbors(query, vectors, 10, 0.9);
      expect(neighbors).toHaveLength(0);
    });

    it('should handle empty vector list', () => {
      const query = [1, 0, 0];
      const vectors: Array<{ id: string; vec: number[]; metadata?: any }> = [];

      const neighbors = findNearestNeighbors(query, vectors, 10);
      expect(neighbors).toHaveLength(0);
    });

    it('should sort by similarity in descending order', () => {
      const query = [1, 0, 0];
      const vectors = [
        { id: 'low', vec: [0.5, 0.5, 0], metadata: {} },
        { id: 'high', vec: [0.99, 0.01, 0], metadata: {} },
        { id: 'medium', vec: [0.7, 0.3, 0], metadata: {} }
      ];

      const neighbors = findNearestNeighbors(query, vectors, 10);
      
      expect(neighbors[0].id).toBe('high');
      expect(neighbors[1].id).toBe('medium');
      expect(neighbors[2].id).toBe('low');
      
      // Verify descending order
      for (let i = 1; i < neighbors.length; i++) {
        expect(neighbors[i - 1].similarity).toBeGreaterThanOrEqual(neighbors[i].similarity);
      }
    });
  });
});
