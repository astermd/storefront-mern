import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Inject } from '@nestjs/common';
import { Command, CommandRunner, Option } from 'nest-commander';
import { TELEFORM_GATEWAY } from '../core/tokens';
import { TeleformGateway } from '../forms/teleform-gateway';

interface FormsRecordOptions {
  teleform?: string;
  out?: string;
}

const DEFAULT_OUTPUT_DIR = join(process.cwd(), 'storage/cache/teleforms/recordings');

/**
 * Ported from storefront-lamp/core/Console/FormsRecordCommand.php. `forms:record --teleform=<id>
 * [--out=<dir>]` — writes what the EMR currently serves for one teleform to disk, as the metadata
 * record and the definition document.
 *
 * It reads through the gateway rather than through `TeleformSource`, deliberately bypassing the
 * definition cache: a recording that could be answered from cache would capture what the
 * storefront happens to be holding rather than what the EMR is serving, which is the opposite of
 * what anyone runs this for. It exists so re-recording a republished form, or capturing an
 * envelope shape nobody anticipated, is one command instead of a hand-written fixture.
 *
 * The metadata written is the reduced record the storefront actually keeps — id, identifier, type,
 * layout and the `db_fields` mapping — not the raw API payload, since the reduction is the part
 * every later reader consumes. A teleform that cannot be resolved is a failure exit, and nothing is
 * written in that case: a half-written recording read later as a fixture is worse than no recording.
 */
@Command({ name: 'forms:record', description: 'Capture a teleform metadata record and definition to disk' })
export class FormsRecordCommand extends CommandRunner {
  constructor(@Inject(TELEFORM_GATEWAY) private readonly gateway: TeleformGateway) {
    super();
  }

  @Option({ flags: '--teleform <id>', description: 'The teleform id to record' })
  parseTeleform(value: string): string {
    return value;
  }

  @Option({ flags: '--out <dir>', description: 'Directory to write the two files into' })
  parseOut(value: string): string {
    return value;
  }

  async run(_params: string[], options: FormsRecordOptions): Promise<void> {
    const teleformId = (options.teleform ?? '').trim();

    if (teleformId === '') {
      console.error('A teleform id is required: --teleform=ID');
      process.exitCode = 1;
      return;
    }

    const metadata = await this.gateway.metadata(teleformId);
    if (metadata === null) {
      console.error(`No teleform metadata for "${teleformId}".`);
      process.exitCode = 1;
      return;
    }

    const definition = await this.gateway.definition(metadata);
    if (definition === null) {
      console.error(`No definition for teleform "${teleformId}".`);
      process.exitCode = 1;
      return;
    }

    const outputDir = (options.out ?? '').trim() || DEFAULT_OUTPUT_DIR;
    try {
      if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true, mode: 0o770 });
    } catch {
      console.error(`Unable to create output directory: ${outputDir}`);
      process.exitCode = 1;
      return;
    }

    const pages = Array.isArray(definition.pages) ? definition.pages.filter((page): page is Record<string, unknown> => page !== null && typeof page === 'object') : [];
    let fields = 0;
    for (const page of pages) {
      const pageFields = Array.isArray(page.fields) ? page.fields : [];
      fields += pageFields.filter((field) => field !== null && typeof field === 'object').length;
    }

    const metadataFile = join(outputDir, 'teleform-metadata.json');
    const definitionFile = join(outputDir, 'teleform-definition.json');

    writeFileSync(
      metadataFile,
      FormsRecordCommand.encode({
        id: metadata.id,
        form_json_identifier: metadata.identifier,
        type: metadata.type,
        layout: metadata.layout,
        db_fields: metadata.dbFields,
      }),
    );
    writeFileSync(definitionFile, FormsRecordCommand.encode(definition));

    console.log(`Identifier: ${metadata.identifier}`);
    console.log(`Form: ${typeof definition.formName === 'string' ? definition.formName : '(unnamed)'}`);
    console.log(`Type: ${metadata.type}`);
    console.log(`Layout: ${metadata.layout}`);
    console.log(`Pages: ${pages.length}`);
    console.log(`Fields: ${fields}`);
    console.log(`db_fields: ${Object.keys(metadata.dbFields).length}`);
    console.log(`Wrote ${metadataFile}`);
    console.log(`Wrote ${definitionFile}`);
  }

  private static encode(data: unknown): string {
    return JSON.stringify(data, null, 2) + '\n';
  }
}
