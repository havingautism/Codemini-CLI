'use strict';

/**
 * Unsigned-by-default desktop packager config.
 * Signing turns on when CSC_LINK / WIN_CSC_LINK are present.
 * forceCodeSigning stays false so a machine without certificates still produces artifacts.
 * See DESKTOP.md.
 */
module.exports = {
  appId: 'dev.codemini.desktop',
  productName: 'Codemini',
  executableName: 'Codemini',
  asar: true,
  npmRebuild: true,
  buildDependenciesFromSource: false,
  forceCodeSigning: false,
  // A v* checkout otherwise turns on GitHub publishing. The release workflow uploads artifacts itself.
  publish: null,
  directories: {
    output: 'desktop-dist',
  },
  files: [
    'package.json',
    'LICENSE',
    'README.md',
    'OPERATIONS.md',
    'deployment.md',
    'DESKTOP.md',
    'bin/**/*',
    'src/**/*',
    'desktop/**/*',
    'souls/**/*',
    'templates/**/*',
    'codemini-web/server.js',
    'codemini-web/lib/**/*',
    'codemini-web/shared/**/*',
    'codemini-web/dist/**/*',
    'codemini-web/codemini_logo.png',
    'codemini-web/client/src/lib/plan-ui-state.js',
    'codemini-web/client/src/lib/crew-ui-state.js',
    'codemini-web/client/src/lib/message-context-parsers.js',
  ],
  mac: {
    category: 'public.app-category.developer-tools',
    icon: 'codemini-web/codemini_logo.png',
    target: ['dmg'],
    gatekeeperAssess: false,
    artifactName: 'Codemini-${version}-mac-${arch}.${ext}',
  },
  win: {
    icon: 'codemini-web/codemini_logo.png',
    target: ['nsis'],
    artifactName: 'Codemini-Setup-${version}-win-${arch}.${ext}',
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    artifactName: 'Codemini-Setup-${version}-win-${arch}.${ext}',
  },
};
