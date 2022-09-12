import { existsSync, lstatSync, readdirSync } from 'fs';
import { join } from 'path';
import { Library } from 'cql-execution';
import { extractPrefetchFromELM } from './hooks-loader.js';

var forApplying = {};

async function load(pathToFolder) {
  if (!existsSync(pathToFolder) || !lstatSync(pathToFolder).isDirectory()) {
    console.error(`Failed to load local repository at: ${pathToFolder}.  Not a valid folder path.`);
    return;
  }

  for (const folderName of readdirSync(pathToFolder)) {
    const file = join(pathToFolder, folderName);
    const stats = lstatSync(file);
    if (stats.isDirectory()) {
      const index = join(pathToFolder, folderName, 'index.js');
      const { elmJson, cdsResources, valueSetJson } = await import(index);
      const prefetch = extractPrefetch(Object.values(elmJson));
      forApplying[folderName] = { elmJson, cdsResources, valueSetJson, prefetch };
    } else {
      continue;
    }
  }
}

function get() {
  return forApplying;
}

function extractPrefetch(elmJson) {
  let prefetch = {};
  for (const ej of elmJson) {
    prefetch = extractPrefetchFromELM(new Library(ej), prefetch);
  }
  console.log(prefetch);
  return prefetch;
}

export default {load, get};
export { get, load };