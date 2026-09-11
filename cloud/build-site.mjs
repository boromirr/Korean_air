import {mkdir,copyFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
await mkdir('dist/server',{recursive:true});
await mkdir('dist/.openai',{recursive:true});
await copyFile('cloud/site-worker.mjs','dist/server/index.js');
if (existsSync('.openai/hosting.json')) {
  await copyFile('.openai/hosting.json','dist/.openai/hosting.json');
  // The Railway-only Node modules must not be staged as Cloudflare Worker modules.
  for (const dir of ['dist/src','dist/scripts','dist/tests']) await rm(dir,{recursive:true,force:true});
}
console.log('Private award viewer gateway built.');
