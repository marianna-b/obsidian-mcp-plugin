/**
 * Loader for Smart Connections data from .smart-env directory
 * Uses Obsidian API instead of Node.js fs module
 * 
 * Adapted from smart-connections-mcp by Daniel Glickman
 * https://github.com/msdanyg/smart-connections-mcp
 */

import { App } from 'obsidian';
import type { SmartSource, SmartEnvConfig } from '../types/smart-connections';
import { Debug } from './debug';

export class SmartConnectionsLoader {
  private app: App;
  private config: SmartEnvConfig | null = null;
  private sources: Map<string, SmartSource> = new Map();
  private smartEnvPath: string = '.smart-env';

  constructor(app: App) {
    this.app = app;
  }

  /**
   * Initialize and load all Smart Connections data
   */
  async initialize(): Promise<void> {
    const adapter = this.app.vault.adapter;

    // Check if .smart-env exists
    const smartEnvExists = await adapter.exists(this.smartEnvPath);
    if (!smartEnvExists) {
      throw new Error(`Smart Connections directory not found at: ${this.smartEnvPath}`);
    }

    // Load configuration
    await this.loadConfig();

    // Load all sources
    await this.loadSources();
  }

  /**
   * Load smart_env.json configuration
   */
  private async loadConfig(): Promise<void> {
    const configPath = `${this.smartEnvPath}/smart_env.json`;
    const adapter = this.app.vault.adapter;

    const configExists = await adapter.exists(configPath);
    if (!configExists) {
      throw new Error(`Configuration file not found at: ${configPath}`);
    }

    const configData = await adapter.read(configPath);
    this.config = JSON.parse(configData);
    Debug.log('✅ Smart Connections config loaded');
  }

  /**
   * Load all .ajson files from the multi directory
   */
  private async loadSources(): Promise<void> {
    const multiPath = `${this.smartEnvPath}/multi`;
    const adapter = this.app.vault.adapter;

    const multiExists = await adapter.exists(multiPath);
    if (!multiExists) {
      throw new Error(`Multi directory not found at: ${multiPath}`);
    }

    // List all files in the multi directory
    const listing = await adapter.list(multiPath);
    const ajsonFiles = listing.files.filter(f => f.endsWith('.ajson'));

    Debug.log(`📂 Loading ${ajsonFiles.length} Smart Connections source files...`);

    for (const filePath of ajsonFiles) {
      try {
        const content = await adapter.read(filePath);

        // Parse the AJSON format (JSONL - one JSON object per line)
        const lines = content.trim().split('\n');

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            // Each line is formatted as: "key1": {...}, "key2": {...}, "key3": {...},
            // Remove trailing comma and wrap with curly braces to make valid JSON
            const cleanedLine = line.replace(/,\s*$/, '');
            const obj = JSON.parse(`{${cleanedLine}}`);

            // Process all key-value pairs in the object
            for (const key of Object.keys(obj)) {
              // Only process smart_sources entries (not smart_blocks)
              if (key.startsWith('smart_sources:')) {
                const sourceData: SmartSource = obj[key];
                // Skip entries with null/undefined paths
                if (sourceData && sourceData.path) {
                  this.sources.set(sourceData.path, sourceData);
                }
              }
            }
          } catch (parseError) {
            // Skip lines that can't be parsed
            Debug.error(`Parse error in ${filePath}:`, parseError);
          }
        }
      } catch (error) {
        Debug.error(`Error loading ${filePath}:`, error);
      }
    }

    Debug.log(`✅ Loaded ${this.sources.size} Smart Connections sources`);
  }

  /**
   * Get all sources
   */
  getSources(): Map<string, SmartSource> {
    return this.sources;
  }

  /**
   * Get a specific source by path
   */
  getSource(notePath: string): SmartSource | undefined {
    return this.sources.get(notePath);
  }

  /**
   * Get configuration
   */
  getConfig(): SmartEnvConfig | null {
    return this.config;
  }

  /**
   * Get the embedding model key from config
   */
  getEmbeddingModelKey(): string {
    if (!this.config) {
      throw new Error('Configuration not loaded');
    }

    // Extract the model key from the embed_model configuration
    const embedModel = this.config.smart_sources.embed_model;
    const adapter = embedModel.adapter;

    // The actual model key is nested in the adapter configuration
    // e.g., embed_model.transformers.model_key = "TaylorAI/bge-micro-v2"
    if (adapter && embedModel[adapter] && typeof embedModel[adapter] === 'object') {
      const adapterConfig = embedModel[adapter] as any;
      if (adapterConfig.model_key) {
        return adapterConfig.model_key;
      }
    }

    // Fallback: find first object key that's not 'adapter'
    const modelKeys = Object.keys(embedModel).filter(k => k !== 'adapter' && typeof embedModel[k] === 'object');

    if (modelKeys.length === 0) {
      throw new Error('No embedding model found in configuration');
    }

    return modelKeys[0];
  }

  /**
   * Read the actual markdown content of a note
   */
  async readNoteContent(notePath: string): Promise<string> {
    const adapter = this.app.vault.adapter;

    const exists = await adapter.exists(notePath);
    if (!exists) {
      throw new Error(`Note not found at: ${notePath}`);
    }

    return await adapter.read(notePath);
  }

  /**
   * Extract content for specific blocks/sections
   */
  async extractBlockContent(notePath: string, blockHeading: string): Promise<string> {
    const content = await this.readNoteContent(notePath);
    const source = this.getSource(notePath);

    if (!source || !source.blocks[blockHeading]) {
      return '';
    }

    const [startLine, endLine] = source.blocks[blockHeading];
    const lines = content.split('\n');

    return lines.slice(startLine - 1, endLine).join('\n');
  }
}
