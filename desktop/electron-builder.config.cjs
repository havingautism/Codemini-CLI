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
  artifactName: 'Codemini-${version}-${os}-${arch}.${ext}',
  mac: {
    category: 'public.app-category.developer-tools',
    icon: 'codemini-web/codemini_logo.png',
    target: ['dmg', 'zip'],
    gatekeeperAssess: false,
  },
  win: {
    icon: 'codemini-web/codemini_logo.png',
    target: ['nsis', 'zip'],
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
  },
};
