import { createHash } from 'node:crypto';
import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '../support/config';
import { ConsentDefinition } from './consent-definition';
import { ConsentRecord } from './consent-record';

export interface ConsentConfigRow {
  key?: unknown;
  label?: unknown;
  html?: unknown;
  blocking?: unknown;
  links?: unknown;
}

export interface ConsentConfig {
  consents?: ConsentConfigRow[];
}

/**
 * Ported from storefront-lamp/core/Checkout/Consents.php. The consent set a deployment shows at
 * checkout (§26).
 *
 * Consent is an explicit affirmative action (`[26.2]`): nothing here has a default of "granted",
 * and the template renders every control unchecked. A consent absent from the submitted body is a
 * decline, recorded as `false` rather than omitted — `[26.10]`.
 *
 * The version is a hash of the copy itself (`[26.7]`). A number someone has to remember to bump is
 * a number that will not get bumped; a hash makes editing a comma a new version automatically.
 */
@Injectable()
export class Consents {
  private readonly definitionsList: ConsentDefinition[];
  private readonly versionHash: string;
  private readonly clock: () => string;

  constructor(config: ConfigService, @Optional() clock?: () => string) {
    this.definitionsList = Consents.parse(config.consent?.consents ?? []);
    this.versionHash = Consents.hash(this.definitionsList);
    this.clock = clock ?? (() => new Date().toISOString());
  }

  /** Builds a reduced set directly from already-resolved definitions, bypassing the config-reading constructor — see `except()`. */
  private static withDefinitions(definitions: ConsentDefinition[], clock: () => string): Consents {
    const reduced: Consents = Object.create(Consents.prototype) as Consents;
    Object.assign(reduced, { definitionsList: definitions, versionHash: Consents.hash(definitions), clock });
    return reduced;
  }

  private static parse(rows: ConsentConfigRow[]): ConsentDefinition[] {
    const definitions: ConsentDefinition[] = [];

    for (const row of rows) {
      const key = typeof row.key === 'string' ? row.key.trim() : '';
      if (key === '') continue;

      const links: string[] = [];
      if (Array.isArray(row.links)) {
        for (const link of row.links) {
          if (typeof link === 'string' && link !== '') links.push(link);
        }
      }

      definitions.push(
        new ConsentDefinition(
          key,
          typeof row.label === 'string' ? row.label : key,
          typeof row.html === 'string' ? row.html : '',
          row.blocking === true,
          links,
        ),
      );
    }

    return definitions;
  }

  definitions(): ConsentDefinition[] {
    return this.definitionsList;
  }

  version(): string {
    return this.versionHash;
  }

  /** The same set minus consents an intake form already collected (`[26.11]`). */
  except(keys: string[]): Consents {
    const remaining = this.definitionsList.filter((d) => !keys.includes(d.key));
    return Consents.withDefinitions(remaining, this.clock);
  }

  /**
   * Turns a submitted body into one record per configured consent, and names the blocking ones
   * that were not granted.
   */
  record(checked: Record<string, unknown>): { records: ConsentRecord[]; missing: string[] } {
    const at = this.clock();
    const records: ConsentRecord[] = [];
    const missing: string[] = [];

    for (const definition of this.definitionsList) {
      const raw = checked[definition.key];
      const granted = raw !== undefined && !['', '0', 'false', 'off'].includes(String(raw));

      if (definition.blocking && !granted) {
        missing.push(definition.key);
      }

      records.push(new ConsentRecord(definition.key, granted, this.versionHash, definition.html, at));
    }

    return { records, missing };
  }

  private static hash(definitions: ConsentDefinition[]): string {
    let material = '';
    for (const definition of definitions) {
      material += `${definition.key}\0${definition.html}\0${definition.blocking ? '1' : '0'}\n`;
    }
    return createHash('sha256').update(material).digest('hex').slice(0, 16);
  }
}
