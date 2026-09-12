import { executeQueryBySubgraphId } from "./mcpClient.js";
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

  const { query, variables } = template.buildQuery(params);
  const rawResult = await executeQueryBySubgraphId(template.pinnedSubgraphId, query, variables);
  const result = template.transform(rawResult);

  return {
    templateId,
    subgraphUsed: { name: template.name, id: template.pinnedSubgraphId },
    result,
    rawResult,
  };
}
