import { HttpClientInterface, Request, Response } from '@astermd-hq/vrio-client';

/** Records every request it sees and replays queued responses in order — the seam that keeps every Vrio adapter test off the real network. */
export class FakeVrioTransport implements HttpClientInterface {
  readonly requests: Request[] = [];
  private readonly queue: Response[];

  constructor(responses: Response[]) {
    this.queue = [...responses];
  }

  async send(request: Request): Promise<Response> {
    this.requests.push(request);
    const next = this.queue.shift();
    if (!next) throw new Error('FakeVrioTransport: no more queued responses.');
    return next;
  }

  paramsOf(index: number): Record<string, unknown> {
    const request = this.requests[index];
    if (request.getMethod() === 'GET') {
      return Object.fromEntries(new URL(request.getUrl()).searchParams.entries());
    }
    return JSON.parse(request.getBody() ?? '{}');
  }
}

export function envelope(body: Record<string, unknown>): Response {
  return new Response(200, JSON.stringify(body));
}
