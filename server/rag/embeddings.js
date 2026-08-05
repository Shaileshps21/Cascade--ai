import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config();

// Standalone server-default embedding model — independent of the per-user
// LLM provider choice (Groq has no embedding API, so RAG always uses the
// server's own Gemini key for embeddings regardless of which provider the
// user picked for text generation).
const embeddingModel = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY).getGenerativeModel({ model: 'embedding-001' })
  : null;

/**
 * Generate a vector embedding for a piece of text.
 * Uses Google's text-embedding-004 model (768 dimensions).
 *
 * @param {string} text  – text to embed
 * @returns {number[]}   – embedding vector
 */
export async function generateEmbedding(text) {
  if (!embeddingModel) return null;
  const result = await embeddingModel.embedContent(text);
  return result.embedding.values;
}

/**
 * Generate embeddings for multiple texts in parallel.
 * @param {string[]} texts
 * @returns {number[][]}
 */
export async function generateEmbeddingsBatch(texts) {
  const promises = texts.map((t) => generateEmbedding(t));
  return Promise.all(promises);
}

/**
 * Compute cosine similarity between two vectors.
 * Returns a value between -1 and 1 (higher = more similar).
 */
export function cosineSimilarity(a, b) {
  if (a.length !== b.length) throw new Error('Vector dimension mismatch');
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}
