import os from 'node:os';
import path from 'node:path';

const GLOBAL_APP_DIR = 'codemini-global';
const PROJECT_APP_DIR = '.codemini';
const PROJECT_INDEX_DIR = '.codemini';

export function getBaseConfigDir({
  env = process.env,
  platform = process.platform,
  homedir = os.homedir(),
} = {}) {
  const override = String(env.CODEMINI_GLOBAL_DIR || '').trim();
  if (override) return path.resolve(override);

  if (platform === 'win32') {
    const appData = env.APPDATA || path.join(homedir, 'AppData', 'Roaming');
    return path.join(appData, GLOBAL_APP_DIR);
  }

  if (platform === 'darwin') {
    return path.join(homedir, 'Library', 'Preferences', GLOBAL_APP_DIR);
  }

  const xdgConfigHome = String(env.XDG_CONFIG_HOME || '').trim();
  const configHome = path.posix.isAbsolute(xdgConfigHome)
    ? xdgConfigHome
    : path.join(homedir, '.config');
  return path.join(configHome, GLOBAL_APP_DIR);
}

export function getConfigFilePath() {
  return path.join(getBaseConfigDir(), 'config.json');
}

export function getSessionsDir() {
  return path.join(getBaseConfigDir(), 'sessions');
}

export function getSkillsDir() {
  return path.join(getBaseConfigDir(), 'skills');
}

export function getSkillRegistryPath() {
  return path.join(getBaseConfigDir(), 'skill-registry.json');
}

export function getCommandsDir() {
  return path.join(getBaseConfigDir(), 'commands');
}

export function getMemoryDir() {
  return path.join(getBaseConfigDir(), 'memory');
}

export function getInputHistoryFilePath() {
  return path.join(getBaseConfigDir(), 'input-history.json');
}

export function getProjectWorkspaceDir(cwd = process.cwd()) {
  return path.join(cwd, PROJECT_APP_DIR);
}

export function getProjectCommandsDir(cwd = process.cwd()) {
  return path.join(getProjectWorkspaceDir(cwd), 'commands');
}

export function getProjectHooksDir(cwd = process.cwd()) {
  return path.join(getProjectWorkspaceDir(cwd), 'hooks');
}

export function getProjectHooksFilePath(cwd = process.cwd(), context = 'coding') {
  return path.join(
    getProjectHooksDir(cwd),
    context === 'daily' ? 'hooks.daily.json' : 'hooks.json',
  );
}

export function getGlobalHooksDir() {
  return path.join(getBaseConfigDir(), 'hooks');
}

export function getGlobalHooksFilePath() {
  return path.join(getGlobalHooksDir(), 'hooks.json');
}

export function getProjectSpecsDir(cwd = process.cwd(), sessionId = '') {
  return sessionId
    ? path.join(getProjectWorkspaceDir(cwd), 'specs', String(sessionId))
    : path.join(getProjectWorkspaceDir(cwd), 'specs');
}

export function getProjectPlansDir(cwd = process.cwd(), sessionId = '') {
  return sessionId
    ? path.join(getProjectWorkspaceDir(cwd), 'plans', String(sessionId))
    : path.join(getProjectWorkspaceDir(cwd), 'plans');
}

export function getProjectHandoffsDir(cwd = process.cwd(), sessionId = '') {
  return sessionId
    ? path.join(getProjectWorkspaceDir(cwd), 'handoffs', String(sessionId))
    : path.join(getProjectWorkspaceDir(cwd), 'handoffs');
}

export function getProjectCheckpointsDir(cwd = process.cwd()) {
  return path.join(getProjectWorkspaceDir(cwd), 'checkpoints');
}

export function getProjectTasksDir(cwd = process.cwd()) {
  return path.join(getProjectWorkspaceDir(cwd), 'tasks');
}

export function getProjectLegacyTasksFilePath(cwd = process.cwd()) {
  return path.join(getProjectWorkspaceDir(cwd), 'tasks.json');
}

export function getProjectMapPath(cwd = process.cwd()) {
  return path.join(cwd, PROJECT_INDEX_DIR, 'project-map.json');
}

export function getFileIndexPath(cwd = process.cwd()) {
  return path.join(cwd, PROJECT_INDEX_DIR, 'file-index.json');
}

export function getSandboxCapabilitySnapshotPath() {
  return path.join(getBaseConfigDir(), 'sandbox-capabilities.json');
}

export function getProjectIndexDir(cwd = process.cwd()) {
  return path.join(cwd, PROJECT_INDEX_DIR);
}

export function getProjectMemoryDir(cwd = process.cwd()) {
  return path.join(getProjectIndexDir(cwd), 'memory');
}

export function getInboxDir() {
  return path.join(getMemoryDir(), 'inbox');
}

export function getArchiveDir() {
  return path.join(getMemoryDir(), 'archive');
}

export function getDreamAuditDir() {
  return path.join(getMemoryDir(), 'audit');
}
