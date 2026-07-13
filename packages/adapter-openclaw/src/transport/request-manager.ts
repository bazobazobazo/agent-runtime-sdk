import { RuntimeError, withDeadline, type RuntimeWebSocketConnection } from '@banzae/agent-runtime-core';
import type { OpenClawFrame, OpenClawProtocolCodec, OpenClawRpcRequest } from '../protocol/types.js';

export class OpenClawRequestManager {
  constructor(
    private readonly connection: RuntimeWebSocketConnection,
    private readonly codec: OpenClawProtocolCodec,
    private readonly timeoutMs: number,
  ) {}

  async request<T = unknown>(request: OpenClawRpcRequest, signal?: AbortSignal): Promise<T> {
    await this.connection.send(this.codec.encodeRequest(request));
    const response = await withDeadline(this.nextResponse(request.id), this.timeoutMs, signal);
    if ('error' in response && response.error) {
      throw this.codec.mapError(response.error);
    }
    return response.payload as T;
  }

  private async nextResponse(id: string): Promise<Extract<OpenClawFrame, { type: 'res' }>> {
    for await (const event of this.connection.events()) {
      if (event.type === 'message') {
        const frame = this.codec.parseFrame(event.data);
        if (frame.type === 'res' && frame.id === id) return frame;
      }
      if (event.type === 'error') {
        throw new RuntimeError({
          code: 'NETWORK',
          retryable: true,
          message: 'OpenClaw WebSocket error',
          adapterId: 'openclaw',
          cause: event.error,
        });
      }
      if (event.type === 'close') {
        throw new RuntimeError({
          code: 'NETWORK',
          retryable: true,
          message: 'OpenClaw WebSocket closed before response',
          adapterId: 'openclaw',
          details: { code: event.code, reason: event.reason },
        });
      }
    }
    throw new RuntimeError({
      code: 'NETWORK',
      retryable: true,
      message: 'OpenClaw WebSocket ended before response',
      adapterId: 'openclaw',
    });
  }
}
