type Annotation = Record<string, unknown>;
type CitationState = {
  responseAnnotations?: Record<number, Annotation[]>;
  citationMessageIndex?: number;
};

/** Chat Completions nests URL citations; Responses exposes their fields directly. */
export function normalizeResponseAnnotations(items: unknown): Annotation[] {
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  return items.flatMap((item): Annotation[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const annotation = item as Annotation;
    const nested = annotation.url_citation;
    const normalized =
      annotation.type === "url_citation" &&
      nested &&
      typeof nested === "object" &&
      !Array.isArray(nested)
        ? { ...(nested as Annotation), type: "url_citation" }
        : { ...annotation };
    const identity = JSON.stringify(normalized);
    if (seen.has(identity)) return [];
    seen.add(identity);
    return [normalized];
  });
}

export function responseAnnotations(state: CitationState, index: number): Annotation[] {
  state.responseAnnotations ??= {};
  return (state.responseAnnotations[index] ??= []);
}

export function beginResponseCitationMessage(state: CitationState, index: number): void {
  state.citationMessageIndex = index;
  responseAnnotations(state, index);
}

export function collectResponseAnnotations(state: CitationState, items: unknown): void {
  if (!Array.isArray(items) || items.length === 0) return;
  const annotations = responseAnnotations(state, state.citationMessageIndex ?? 0);
  const merged = normalizeResponseAnnotations([...annotations, ...items]);
  // Completed output items retain this array. Late annotation-only chunks must update
  // that snapshot without leaking the first message's sources into the next message.
  annotations.splice(0, annotations.length, ...merged);
}
