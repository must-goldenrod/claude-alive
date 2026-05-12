import { loadConfig, saveConfig, setConfigValue } from '@think-prompt/core';
import pc from 'picocolors';

function getDeep(obj: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((acc, k) => {
    if (acc == null || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[k];
  }, obj);
}

function coerce(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

export async function configGetCmd(key?: string): Promise<void> {
  const cfg = loadConfig();
  if (!key) {
    console.log(JSON.stringify(cfg, null, 2));
    return;
  }
  console.log(JSON.stringify(getDeep(cfg, key), null, 2));
}

export async function configSetCmd(key: string, value: string): Promise<void> {
  const cfg = loadConfig();
  const next = setConfigValue(cfg, key, coerce(value));
  saveConfig(next);
  console.log(pc.green('✓') + ` ${key} = ${JSON.stringify(coerce(value))}`);
}

export async function configListCmd(): Promise<void> {
  const cfg = loadConfig();
  console.log(JSON.stringify(cfg, null, 2));
}

export async function coachCmd(state: string): Promise<void> {
  if (state !== 'on' && state !== 'off') {
    console.log(pc.red('usage: think-prompt coach <on|off>'));
    return;
  }
  const cfg = loadConfig();
  const next = setConfigValue(cfg, 'agent.coach_mode', state === 'on');
  saveConfig(next);
  console.log(pc.green('✓') + ` coach_mode=${state === 'on' ? 'on' : 'off'}`);
  console.log(pc.dim('(restart the agent for the change to take effect: `think-prompt restart`)'));
}
