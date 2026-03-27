import { getConfigValue, loadConfig, resetConfig, setConfigValue } from '../core/config-store.js';

function usage() {
  console.log(`Usage:
  codemini config set <key> <value>
  codemini config get <key>
  codemini config list
  codemini config reset`);
}

export async function handleConfig(args) {
  const [sub, ...rest] = args;

  if (!sub) {
    usage();
    return;
  }

  if (sub === 'set') {
    const [key, ...valueParts] = rest;
    if (!key || valueParts.length === 0) {
      throw new Error('config set requires <key> <value>');
    }
    const value = valueParts.join(' ');
    await setConfigValue(key, value);
    console.log(`Set ${key}=${value}`);
    return;
  }

  if (sub === 'get') {
    const [key] = rest;
    if (!key) {
      throw new Error('config get requires <key>');
    }
    const value = await getConfigValue(key);
    if (value === undefined) {
      console.log('undefined');
      return;
    }
    if (typeof value === 'object') {
      console.log(JSON.stringify(value, null, 2));
      return;
    }
    console.log(String(value));
    return;
  }

  if (sub === 'list') {
    const config = await loadConfig();
    console.log(JSON.stringify(config, null, 2));
    return;
  }

  if (sub === 'reset') {
    await resetConfig();
    console.log('Config reset complete');
    return;
  }

  usage();
}
