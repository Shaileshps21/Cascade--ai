import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config();

if (!process.env.GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY is missing from environment variables');
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Gemini 1.5 Pro  → complex multi-step reasoning (prioritization, planning)
export const geminiPro = genAI.getGenerativeModel({
  model: "gemini-2.0-flash",
  generationConfig: {
    temperature: 0.3,
    topP: 0.8,
    maxOutputTokens: 4096,
  },
});

export const geminiFlash = genAI.getGenerativeModel({
  model: "gemini-2.0-flash",
  generationConfig: {
    temperature: 0.1,
    topP: 0.8,
    maxOutputTokens: 2048,
  },
});

// text-embedding-004 → RAG embeddings
export const embeddingModel = genAI.getGenerativeModel({
  model: "text-embedding-004",
});

/**
 * Parse a Gemini JSON response safely.
 * Strips markdown code fences if present.
 */
export function parseGeminiJSON(text) {
  const cleaned = text
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();
  return JSON.parse(cleaned);
}
