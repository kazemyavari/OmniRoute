import test from "node:test";
import assert from "node:assert/strict";
import { buildImageEndpointSuccess } from "../../open-sse/handlers/imageGeneration/result.ts";
import { fetchImageEndpoint } from "../../open-sse/handlers/imageGeneration/openAiImageFetch.ts";
import { imageEndpointResponse } from "../../open-sse/handlers/imageGeneration/httpResponse.ts";

test("ChatOne image result exposes real upstream cost and generation identity", () => {
  const usage = { input_tokens: 10, output_tokens: 20, cost: 0.125 };
  const result = buildImageEndpointSuccess(
    { created: 123, usage, provider_generation_id: "gen-image-contract" },
    [{ b64_json: "aW1hZ2U=" }]
  );
  assert.deepEqual(result.data.usage, usage);
  assert.equal(result.data.provider_generation_id, "gen-image-contract");
  assert.match(String(result.data.omniroute_request_id), /^[a-f0-9-]{36}$/);
});

test("ChatOne unknown image cost and generation remain absent", () => {
  const result = buildImageEndpointSuccess({ id: "upstream-ambiguous-id" }, [
    { url: "https://image.example/out.png" },
  ]);
  assert.equal(result.data.usage, undefined);
  assert.equal(result.data.provider_generation_id, undefined);
  assert.match(String(result.data.omniroute_request_id), /^[a-f0-9-]{36}$/);
});

test("ChatOne fetch retains image accounting headers", async (context) => {
  const original = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ data: [{ b64_json: "aW1hZ2U=" }], usage: { input_tokens: 5 } }), {
      headers: {
        "x-openrouter-generation-id": "gen-header-contract",
        "x-omniroute-request-id": "request-contract",
        "x-omniroute-response-cost": "0.25",
      },
    });
  const result = await fetchImageEndpoint(
    "https://upstream.example/images",
    {},
    "{}",
    "test",
    null,
    { timeoutMs: 1000 }
  );
  assert.equal(result.success, true);
  assert.equal(result.data?.provider_generation_id, "gen-header-contract");
  assert.equal(result.data?.omniroute_request_id, "request-contract");
  assert.equal(result.data?.usage?.total_cost, 0.25);
});

test("ChatOne edit response exposes evidence without inventing a cost", async () => {
  const result = buildImageEndpointSuccess(
    { usage: { cost: 0.125 }, generation_id: "gen-test" },
    []
  );
  const response = imageEndpointResponse(result.data);
  assert.equal(response.headers.get("x-omniroute-response-cost"), "0.125");
  assert.equal(response.headers.get("x-openrouter-generation-id"), "gen-test");
  assert.equal(response.headers.get("x-omniroute-request-id"), result.data.omniroute_request_id);
  assert.deepEqual((await response.json()).usage, { cost: 0.125 });
  for (const cost of [undefined, null, "", "NaN", -1, 0, false]) {
    assert.equal(
      imageEndpointResponse({ usage: { cost } }).headers.get("x-omniroute-response-cost"),
      null
    );
  }
  assert.equal(imageEndpointResponse({ error: "failure" }, 502).status, 502);
});

test("ChatOne image metadata uses explicit evidence and rejects invalid header identities", () => {
  const input = { cost: "0.75", usage: { input_tokens: 2 }, generation_id: "bad\r\nid" };
  const result = buildImageEndpointSuccess(
    input,
    [],
    new Headers({ "x-omniroute-response-cost": "unknown" })
  );
  assert.deepEqual(result.data.usage, { input_tokens: 2, cost: "0.75" });
  assert.deepEqual(input.usage, { input_tokens: 2 });
  assert.equal(result.data.provider_generation_id, undefined);
  assert.equal(
    imageEndpointResponse({ provider_generation_id: "bad\nheader" }).headers.get(
      "x-openrouter-generation-id"
    ),
    null
  );
  for (const value of ["", "0", "-1", "Infinity", "unknown"]) {
    const unknown = buildImageEndpointSuccess(
      {},
      [],
      new Headers({ "x-omniroute-response-cost": value })
    );
    assert.equal(unknown.data.usage, undefined);
  }
});

test("ChatOne zero placeholders do not mask positive image cost evidence", () => {
  assert.equal(
    imageEndpointResponse({ usage: { total_cost: 0, cost: 0.125 } }).headers.get(
      "x-omniroute-response-cost"
    ),
    "0.125"
  );
  const result = buildImageEndpointSuccess(
    { usage: { total_cost: 0 } },
    [],
    new Headers({ "x-omniroute-response-cost": "0.25" })
  );
  assert.equal(result.data.usage?.total_cost, 0.25);
  assert.equal(result.data.usage?.provider_reported_total_cost, 0);
  assert.equal(imageEndpointResponse(result.data).headers.get("x-omniroute-response-cost"), "0.25");
});
