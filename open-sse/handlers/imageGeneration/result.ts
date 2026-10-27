import { isJsonObject } from "../../utils/kieTask.ts";

export type ImageEndpointPayload = {
  created: unknown;
  data: unknown[];
  usage?: Record<string, unknown>;
  omniroute_request_id: string;
  provider_generation_id?: string;
};

type ImageEndpointSuccess = {
  success: true;
  data: ImageEndpointPayload;
  usage?: Record<string, unknown>;
  status?: never;
  error?: never;
};

export type ImageEndpointResult =
  | ImageEndpointSuccess
  | { success: false; status: number; error: string; data?: never; usage?: never };

function evidenceId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const id = value.trim();
  return id && !/[\u0000-\u001f\u007f]/.test(id) ? id : undefined;
}

/** Preserve provider evidence in both the accounting result and the public image payload. */
export function buildImageEndpointSuccess(
  data: Record<string, unknown>,
  items: unknown[],
  headers?: Headers
): ImageEndpointSuccess {
  const usage = isJsonObject(data?.usage) ? { ...data.usage } : {};
  for (const key of ["cost", "response_cost", "total_cost", "prompt_cost", "completion_cost"]) {
    if (usage[key] == null && data[key] != null) usage[key] = data[key];
  }
  const headerCost = headers?.get("x-omniroute-response-cost");
  if (
    headerCost?.trim() &&
    Number.isFinite(Number(headerCost)) &&
    Number(headerCost) > 0 &&
    usage.total_cost == null
  ) {
    usage.total_cost = Number(headerCost);
  }
  const generation =
    evidenceId(headers?.get("x-openrouter-generation-id")) ||
    evidenceId(headers?.get("x-generation-id")) ||
    evidenceId(data.provider_generation_id) ||
    evidenceId(data.generation_id) ||
    evidenceId(usage.provider_generation_id) ||
    evidenceId(usage.generation_id);
  const request =
    evidenceId(headers?.get("x-omniroute-request-id")) ||
    evidenceId(data.omniroute_request_id) ||
    globalThis.crypto.randomUUID();
  const keptUsage = Object.keys(usage).length ? usage : undefined;
  return {
    success: true,
    data: {
      created: data.created || Math.floor(Date.now() / 1000),
      data: items,
      ...(keptUsage ? { usage: keptUsage } : {}),
      omniroute_request_id: request,
      ...(generation ? { provider_generation_id: generation } : {}),
    },
    usage: keptUsage,
  };
}
