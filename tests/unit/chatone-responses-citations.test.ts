import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeResponsesApiResponse } from "../../open-sse/handlers/responseSanitizer.ts";
import { createResponsesApiTransformStream } from "../../open-sse/transformer/responsesTransformer.ts";
import { openaiToOpenAIResponsesResponse } from "../../open-sse/translator/response/openai-responses.ts";
import { initState } from "../../open-sse/translator/index.ts";
import { FORMATS } from "../../open-sse/translator/formats.ts";
import {
  beginResponseCitationMessage,
  collectResponseAnnotations,
  normalizeResponseAnnotations,
  responseAnnotations,
} from "../../open-sse/utils/responseAnnotations.ts";

const citation = (url: string) => ({
  type: "url_citation",
  url_citation: { url, title: url, start_index: 0, end_index: 5 },
});
const chunk = (delta: Record<string, unknown>, finish_reason: string | null = null) => ({
  id: "gen-contract",
  model: "contract-model",
  choices: [{ index: 0, delta, finish_reason }],
});
const chunks = () => [
  chunk({ content: "First", annotations: [citation("https://first.example")] }),
  chunk({
    tool_calls: [
      {
        index: 0,
        id: "call_lookup",
        type: "function",
        function: { name: "lookup", arguments: "{}" },
      },
    ],
  }),
  chunk({ annotations: [citation("https://late.example")] }),
  chunk({ content: "Second", annotations: [citation("https://second.example")] }),
  chunk({}, "stop"),
];

test("ChatOne nonstream conversion flattens and deduplicates citations", () => {
  const response = sanitizeResponsesApiResponse({
    choices: [
      {
        message: {
          role: "assistant",
          content: "First",
          annotations: [citation("https://first.example"), citation("https://first.example"), null],
        },
      },
    ],
  });
  const output = response.output as Array<{ content: Array<{ annotations: unknown[] }> }>;
  assert.deepEqual(output[0].content[0].annotations, [
    {
      ...citation("https://first.example").url_citation,
      type: "url_citation",
    },
  ]);
});

test("ChatOne stream transformer keeps late citations on their original message", async () => {
  const encoder = new TextEncoder();
  const input = new ReadableStream({
    start(controller) {
      for (const item of chunks())
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(item)}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  const body = await new Response(
    input.pipeThrough(createResponsesApiTransformStream(null, 0))
  ).text();
  const events = body
    .split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice(6)));
  const messages = events
    .find((event) => event.type === "response.completed")
    .response.output.filter((item: { type: string }) => item.type === "message");
  assert.equal(messages.length, 2);
  assert.deepEqual(
    messages.map((item: { content: Array<{ annotations: Array<{ url: string }> }> }) =>
      item.content[0].annotations.map((a) => a.url)
    ),
    [["https://first.example", "https://late.example"], ["https://second.example"]]
  );
});

test("ChatOne registry translator preserves citations across tool boundaries", () => {
  const state = initState(FORMATS.OPENAI_RESPONSES);
  const events = chunks().flatMap((item) => openaiToOpenAIResponsesResponse(item, state));
  events.push(...openaiToOpenAIResponsesResponse(null, state));
  const completed = events.find((event) => event.event === "response.completed");
  assert.ok(completed);
  const messages = completed.data.response.output.filter(
    (item: { type: string }) => item.type === "message"
  );
  assert.deepEqual(
    messages.map((item: { content: Array<{ annotations: Array<{ url: string }> }> }) =>
      item.content[0].annotations.map((a) => a.url)
    ),
    [["https://first.example", "https://late.example"], ["https://second.example"]]
  );
});

test("ChatOne citation normalization supports flat sources and keeps stable message arrays", () => {
  const flat = { ...citation("https://flat.example").url_citation, type: "url_citation" };
  assert.deepEqual(
    normalizeResponseAnnotations([citation("https://flat.example"), flat, null, 1, []]),
    [flat]
  );
  assert.deepEqual(normalizeResponseAnnotations(undefined), []);
  const state = {};
  beginResponseCitationMessage(state, 1);
  collectResponseAnnotations(state, [flat]);
  const snapshot = responseAnnotations(state, 1);
  collectResponseAnnotations(state, [citation("https://late.example")]);
  assert.equal(snapshot.length, 2);
  beginResponseCitationMessage(state, 2);
  collectResponseAnnotations(state, undefined);
  assert.deepEqual(responseAnnotations(state, 2), []);
  assert.equal(snapshot, responseAnnotations(state, 1));
});

test("ChatOne pending citations follow the first text message after reasoning", async () => {
  const items = [
    chunk({ reasoning_content: "Thinking" }),
    chunk({ annotations: [citation("https://pending.example")] }),
    chunk({ content: "Answer" }),
    chunk({}, "stop"),
  ];
  const state = initState(FORMATS.OPENAI_RESPONSES);
  const translated = items.flatMap((item) => openaiToOpenAIResponsesResponse(item, state));
  translated.push(...openaiToOpenAIResponsesResponse(null, state));
  const message = translated
    .find((event) => event.event === "response.completed")
    ?.data.response.output.find((item: { type: string }) => item.type === "message");
  assert.equal(message.content[0].annotations[0]?.url, "https://pending.example");
  const encoder = new TextEncoder();
  const input = new ReadableStream({
    start(controller) {
      for (const item of items)
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(item)}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  const output = await new Response(
    input.pipeThrough(createResponsesApiTransformStream(null, 0))
  ).text();
  const completed = output
    .split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice(6)))
    .find((event) => event.type === "response.completed");
  const streamedMessage = completed.response.output.find(
    (item: { type: string }) => item.type === "message"
  );
  assert.equal(streamedMessage.content[0].annotations[0]?.url, "https://pending.example");
});
