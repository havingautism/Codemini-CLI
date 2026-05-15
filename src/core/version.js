import pkg from '../../package.json' with { type: 'json' };

export const PACKAGE_NAME = pkg.name || 'codemini-cli';
export const VERSION = pkg.version;

export function getPackageInfo() {
  return {
    name: PACKAGE_NAME,
    version: VERSION
  };
}
