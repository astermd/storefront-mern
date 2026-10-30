import { ApiError } from '@astermd-hq/sdk';
import { EmrClientFactory } from '../../src/emr/client-factory';

/** A canned SDK response: only `data()` is read by the gateways under test. */
export const response = (data: unknown) => ({ data: () => data });

/** The SDK's own error for a given HTTP status. */
export const apiError = (status: number, message = 'You do not have permission to perform this action') => new ApiError(message, status, {});

/**
 * A stand-in `EmrClientFactory` whose client exposes only the SDK resources a test wires up — no
 * network, no credentials. Every call is a jest mock, so a test asserts what reached the EMR and, as
 * often, that nothing did.
 */
export function fakeClients(resources: { verification?: Record<string, jest.Mock>; intakeSubmissions?: Record<string, jest.Mock>; treatments?: Record<string, jest.Mock> }): EmrClientFactory {
  const client = {
    verification: () => resources.verification ?? {},
    intakeSubmissions: () => resources.intakeSubmissions ?? {},
    treatments: () => resources.treatments ?? {},
  };

  return { create: () => client } as unknown as EmrClientFactory;
}

/** An `OperatorLog` that remembers its lines instead of writing a file. */
export function capturedLog() {
  const lines: Array<{ level: string; event: string; context: Record<string, unknown> }> = [];
  const log = {
    info: (event: string, context: Record<string, unknown> = {}) => lines.push({ level: 'info', event, context }),
    warning: (event: string, context: Record<string, unknown> = {}) => lines.push({ level: 'warning', event, context }),
    error: (event: string, context: Record<string, unknown> = {}) => lines.push({ level: 'error', event, context }),
  };

  return { log: log as never, lines };
}
