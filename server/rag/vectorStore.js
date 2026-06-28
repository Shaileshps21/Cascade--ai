/**
 * Vector Store
 * ────────────────────────────────────────────────────────────────────────────
 * Stores user task history as embedding vectors in Firestore.
 * Provides semantic search via cosine similarity so the Prioritization Agent
 * can retrieve past context that is *relevant* to a new task, not just recent.
 *
 * Collection layout in Firestore:
 *   users/{userId}/rag_entries/{entryId}
 *     ├── text        : string  – original text of the entry
 *     ├── metadata    : object  – { taskId, category, completedOnTime, hoursUnderestimated, ... }
 *     ├── embedding   : number[] – 768-dim vector from text-embedding-004
 *     └── createdAt   : timestamp
 */

import { db } from '../config/firebase.js';
import { cosineSimilarity } from './embeddings.js';

const COLLECTION = 'rag_entries';

/**
 * Add a new entry to the user's personal RAG store.
 *
 * @param {string}   userId
 * @param {string}   text      – descriptive text to embed (e.g. "ML assignment deadline")
 * @param {number[]} embedding – pre-computed embedding vector
 * @param {object}   metadata  – task metadata (category, completed_on_time, etc.)
 */
export async function addEntry(userId, text, embedding, metadata = {}) {
  const ref = db
    .collection('users')
    .doc(userId)
    .collection(COLLECTION)
    .doc();

  await ref.set({
    text,
    embedding,
    metadata,
    createdAt: new Date(),
  });

  return ref.id;
}

/**
 * Semantic search: retrieve the top-K most relevant entries for a given query embedding.
 *
 * @param {string}   userId
 * @param {number[]} queryEmbedding – embedding of the current task
 * @param {number}   topK           – number of results to return (default: 5)
 * @returns {Array<{ text, metadata, similarity }>}
 */
export async function search(userId, queryEmbedding, topK = 5) {
  const snapshot = await db
    .collection('users')
    .doc(userId)
    .collection(COLLECTION)
    .orderBy('createdAt', 'desc')
    .limit(200) // Pull recent 200, rank by similarity
    .get();

  if (snapshot.empty) return [];

  const results = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      text: data.text,
      metadata: data.metadata,
      similarity: cosineSimilarity(queryEmbedding, data.embedding),
    };
  });

  // Sort by similarity descending, return top K
  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, topK);
}

/**
 * After a task is completed, record the outcome so future planning improves.
 *
 * @param {string} userId
 * @param {object} taskOutcome – { taskId, title, category, estimatedHours,
 *                                 actualHours, completedOnTime, minutesLate }
 * @param {number[]} embedding
 */
export async function recordOutcome(userId, taskOutcome, embedding) {
  const text = `${taskOutcome.category} task: "${taskOutcome.title}" — ` +
    `estimated ${taskOutcome.estimatedHours}h, actual ${taskOutcome.actualHours}h. ` +
    `Completed ${taskOutcome.completedOnTime ? 'on time' : `${taskOutcome.minutesLate} min late`}.`;

  return addEntry(userId, text, embedding, {
    ...taskOutcome,
    type: 'completed_task',
  });
}
