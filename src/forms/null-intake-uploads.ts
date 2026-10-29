import { IntakeUploads } from './intake-uploads';
import { UploadOutcome } from './upload-outcome';

/**
 * Ported from storefront-lamp/core/Forms/NullIntakeUploads.php. Bound when EMR analytics are off,
 * which is also the test suite.
 *
 * A file answer reaches the clinician only inside the intake submission, and with analytics off no
 * submission is sent, so an upload here would store a file nothing ever names. Every call fails
 * instead, and the page says the file could not be uploaded — unlike `NullIntakeGateway`, which
 * reports success, because a patient told their file was attached would believe the clinician can
 * see it.
 */
export class NullIntakeUploads implements IntakeUploads {
  async upload(): Promise<UploadOutcome> {
    return UploadOutcome.failed();
  }

  async start(): Promise<UploadOutcome> {
    return UploadOutcome.failed();
  }

  async part(): Promise<UploadOutcome> {
    return UploadOutcome.failed();
  }

  async finish(): Promise<UploadOutcome> {
    return UploadOutcome.failed();
  }

  async abort(): Promise<void> {}
}
