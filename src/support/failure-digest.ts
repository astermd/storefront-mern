import { Prisma } from '@prisma/client';

/**
 * Ported from storefront-lamp/core/Support/FailureDigest.php. How a failure is named where its
 * message may not be repeated.
 *
 * Several boundaries in this application must report that something failed without reporting what
 * it said: a database driver refusing a write to the journey column is entitled to quote the row
 * back at us, and that row holds clinical answers, buyer contact details, and a provider's
 * credential handle. Neither `OperatorLog`'s key-based redaction nor `CardScrubber`'s Luhn-based
 * masking can see inside a message like that.
 *
 * **What may be added here, and what may not.** Every value this returns is drawn from the
 * exception's *type* or from Prisma's own fixed error-code vocabulary (`P2002`, `P2025`, ...).
 * Nothing composed by another system may join them — not a message, not a query, not a parameter
 * list.
 */
export class FailureDigest {
  /**
   * The exception's class, plus Prisma's error code when there is one — shaped for a human reading
   * a console line: `PrismaClientKnownRequestError (P2002)`. This port's equivalent of the PHP
   * original's `PDOException (SQLSTATE HY000)`, since Prisma reports a fixed code rather than a
   * SQLSTATE.
   */
  static describe(error: unknown): string {
    const name = FailureDigest.className(error);
    const code = FailureDigest.errorCode(error);

    return code === null ? name : `${name} (${code})`;
  }

  /** Prisma's fixed error code, when there is one — driver vocabulary carrying no free text, which is the property that lets it be reported at all. */
  static errorCode(error: unknown): string | null {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return error.code;
    }
    return null;
  }

  private static className(error: unknown): string {
    if (error instanceof Error) {
      return error.constructor.name;
    }
    return 'UnknownError';
  }
}
