import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Completion } from '../../completion/completion';
import { ReceiptViewModel } from '../../completion/receipt-view-model';
import { PRODUCT_CATALOG } from '../../core/tokens';
import { ProductCatalog } from '../../domain/product-catalog';

/**
 * Ported from storefront-lamp/core/Http/Controller/ReceiptController.php. The receipt page
 * (`[17.1]`).
 *
 * Deliberately one line of work: reaching this page is what triggers completion, so every decision
 * — whether the actions have already fired, what the page shows, when the journey is torn down —
 * belongs to `Completion` rather than here.
 */
@Controller('thank-you')
export class ReceiptController {
  constructor(
    private readonly completion: Completion,
    @Inject(PRODUCT_CATALOG) private readonly catalog: ProductCatalog,
  ) {}

  @Get()
  async show(@Res() res: Response): Promise<void> {
    const receipt = await this.completion.complete();

    res.render('pages/thank-you', {
      noindex: true,
      receipt,
      line_images: this.lineImages(receipt),
      post_checkout_steps: ReceiptController.prescriptionCount(receipt) > 1,
    });
  }

  /**
   * An order with two or more prescriptions had every assessment left for the patient portal
   * (`[8.0i]`), which the page mentions. Read off the kind each line was charged as, not the
   * catalog's current one.
   */
  private static prescriptionCount(receipt: ReceiptViewModel): number {
    return new Set(receipt.lines.filter((line) => line.kind === 'rx').map((line) => line.slug)).size;
  }

  /**
   * Each line's product photo, by slug, read from the catalog at render time — deliberately not part
   * of `ReceiptViewModel`, which is a snapshot of what was charged and carries no catalog dependency.
   * A slug the catalog no longer knows, or a product with no photo, is absent and renders the
   * placeholder tile.
   */
  private lineImages(receipt: ReceiptViewModel): Record<string, string> {
    const images: Record<string, string> = {};

    for (const line of receipt.lines) {
      if (images[line.slug] !== undefined) continue;

      const image = this.catalog.product(line.slug)?.image;
      if (typeof image === 'string' && image !== '') {
        images[line.slug] = image;
      }
    }

    return images;
  }
}
