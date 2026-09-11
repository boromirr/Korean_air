import {mkdir,copyFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
await mkdir('dist/server',{recursive:true});
await mkdir('dist/.openai',{recursive:true});
await copyFile('cloud/site-worker.mjs','dist/server/index.js');
if (existsSync('.openai/hosting.json')) await copyFile('.openai/hosting.json','dist/.openai/hosting.json');
console.log('Private award viewer gateway built.');
