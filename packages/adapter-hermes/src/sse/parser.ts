export type SseEvent = {
  id?: string;
  event?: string;
  data: string;
};

export async function* parseSseStream(
  body: AsyncIterable<Uint8Array>,
  maxEventBytes = 1_000_000,
): AsyncIterable<SseEvent> {
  const decoder = new TextDecoder();
  let buffer = '';
  let eventId: string | undefined;
  let eventName: string | undefined;
  const dataLines: string[] = [];
  let eventBytes = 0;

  const flush = function* (): Iterable<SseEvent> {
    if (dataLines.length === 0 && !eventName && !eventId) return;
    const event: SseEvent = { data: dataLines.join('\n') };
    if (eventId) event.id = eventId;
    if (eventName) event.event = eventName;
    eventId = undefined;
    eventName = undefined;
    dataLines.length = 0;
    eventBytes = 0;
    yield event;
  };

  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    while (true) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const rawLine = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      eventBytes += rawLine.length;
      if (eventBytes > maxEventBytes) {
        throw new Error(`SSE event exceeded ${maxEventBytes} bytes`);
      }
      if (rawLine === '') {
        yield* flush();
      } else if (rawLine.startsWith(':')) {
        continue;
      } else if (rawLine.startsWith('id:')) {
        eventId = rawLine.slice(3).trimStart();
      } else if (rawLine.startsWith('event:')) {
        eventName = rawLine.slice(6).trimStart();
      } else if (rawLine.startsWith('data:')) {
        dataLines.push(rawLine.slice(5).trimStart());
      }
    }
  }

  if (buffer) {
    dataLines.push(buffer);
  }
  yield* flush();
}
