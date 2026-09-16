import type { GenerateAnswerInput } from './answer';
import { ApiError, readJson } from './api';
import { jsonObject } from './source-forms';

// One request contract for the JSON and SSE answer endpoints.
export async function readAnswerRequest(req: Request): Promise<GenerateAnswerInput> {
  const { question, sourceIds } = jsonObject(await readJson<unknown>(req));
  if (sourceIds !== undefined && sourceIds !== null &&
      (!Array.isArray(sourceIds) || !sourceIds.every((id) => typeof id === 'string'))) {
    throw new ApiError(400, 'invalid_scope', 'De bronselectie moet een lijst van bron-id’s zijn.');
  }
  return {
    question: typeof question === 'string' ? question : '',
    sourceIds: sourceIds as string[] | null | undefined,
  };
}
