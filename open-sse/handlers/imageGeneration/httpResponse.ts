import { isJsonObject } from "../../utils/kieTask.ts";
import { positiveImageCost } from "./result.ts";

/** Expose evidence already carried by the image payload; never estimate a missing cost. */
export function imageEndpointResponse(data: unknown, status = 200): Response {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (isJsonObject(data)) {
    for (const [field, header] of [
      ["omniroute_request_id", "x-omniroute-request-id"],
      ["provider_generation_id", "x-openrouter-generation-id"],
    ]) {
      const value = data[field];
      if (typeof value === "string" && value.trim() && !/[\u0000-\u001f\u007f]/.test(value)) {
        headers.set(header, value);
      }
    }
    const usage = isJsonObject(data.usage) ? data.usage : {};
    const cost = [usage.total_cost, usage.cost, usage.response_cost]
      .map(positiveImageCost)
      .find((value) => value !== undefined);
    if (cost !== undefined) {
      headers.set("x-omniroute-response-cost", String(cost));
    }
  }
  return new Response(JSON.stringify(data), { status, headers });
}
