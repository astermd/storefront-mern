import { HttpClientInterface, Request, Response } from '@astermd-hq/checkoutchamp-client';

/** Records every request it sees and replays queued responses in order — the seam that keeps every CheckoutChamp adapter test off the real network. */
export class FakeCheckoutChampTransport implements HttpClientInterface {
  readonly requests: Request[] = [];
  private readonly queue: Response[];

  constructor(responses: Response[]) {
    this.queue = [...responses];
  }

  async send(request: Request): Promise<Response> {
    this.requests.push(request);
    const next = this.queue.shift();
    if (!next) throw new Error('FakeCheckoutChampTransport: no more queued responses.');
    return next;
  }

  paramsOf(index: number): Record<string, string> {
    return Object.fromEntries(new URL(this.requests[index].url).searchParams.entries());
  }

  pathOf(index: number): string {
    return new URL(this.requests[index].url).pathname;
  }
}

export function envelope(body: Record<string, unknown>): Response {
  return new Response(200, JSON.stringify(body));
}
