import { pickBestSubgraph, executeQueryBySubgraphId } from "./mcpClient.js";
import { getTemplate, type TemplateResult } from "./templates.js";

export interface TemplateRunResult {
  templateId: string;
  subgraphUsed: { name: string; id: string };
  result: TemplateResult;
  rawResult: unknown;
}

export async function runTemplate(templateId: string, params: Record<string, unknown>): Promise<TemplateRunResult> {
  const template = getTemplate(templateId);
  if (!template) throw new Error(`Unknown template "${templateId}"`);

  const { candidate } = await pickBestSubgraph(template.protocolKeyword);
  const { query, variables } = template.buildQuery(params);
  const rawResult = await executeQueryBySubgraphId(candidate.id, query, variables);
  const result = template.transform(rawResult);

  return {
    templateId,
    subgraphUsed: { name: candidate.displayName ?? candidate.id, id: candidate.id },
    result,
    rawResult,
  };
}
