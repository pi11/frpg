import releases from '../../changelog.json';

/**
 * What changed for players, newest first: changelog.json at the repository root, shared with the
 * server, which posts new versions to the Telegram channel. Every commit raises the version in
 * client/package.json (the third number; a big change such as new locations raises the second
 * one), but only changes that matter to players get an entry, so versions may be skipped.
 * Hidden achievements are never named or described: an entry only says that new ones were added.
 */
export interface Release {
  version: string;
  /** DD.MM.YYYY */
  date: string;
  title: string;
  changes: string[];
}

export const CHANGELOG: readonly Release[] = releases;

/** Version of this build (client/package.json). */
export const VERSION = __APP_VERSION__;
