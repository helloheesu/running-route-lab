import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {assertCleanOSM} from './sanitize-osm.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
// Scan exactly the staged/tracked publication list. Does not scan ignored raw work.
const files=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
if(!files.length)throw Error('Stage the intended public files before checking release');
const bad=[];
const patterns=[/\/Users\/[A-Za-z0-9_.-]+\//,/\/home\/[A-Za-z0-9_.-]+\//,/[A-Za-z]:\\Users\\[A-Za-z0-9_.-]+\\/,/appgprj_[a-f0-9]{12,}/,/g-p-[a-f0-9]{20,}/,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/\b(?:ghp|github_pat)_[A-Za-z0-9_]{25,}\b/,/\bsk-(?:proj-)?[A-Za-z0-9_-]{30,}\b/];
for(const file of files) {
  if(/^(?:\.openai|work|evidence|node_modules|dist|public\/map-regions)\//.test(file)||/\.osm\.pbf$/.test(file)||/^\.env(?:\.|$)/.test(file)&&file!=='.env.example')bad.push(file+': excluded path');
  const bytes=await fs.readFile(new URL(file, new URL('../',import.meta.url)));
  if(bytes.length>10*1024*1024)bad.push(file+': unexpectedly large tracked file');
  const content=file.endsWith('.gz')?gunzipSync(bytes):bytes;
  if(!/\.(png|jpe?g|woff2?)$/i.test(file)) {
    const text=content.toString('utf8');
    if(patterns.some(p=>p.test(text)))bad.push(file+': personal path/deployment/secret pattern');
    if(file.endsWith('.json')||file.endsWith('.json.gz')) {
      const data=JSON.parse(text);
      if(data?.raw?.elements||data?.elements)try{assertCleanOSM(data);}catch{bad.push(file+': OSM metadata/contact');}
    }
  }
}
if(bad.length){console.error(bad.join('\n'));process.exitCode=1;}
else console.log(`Release list checked: ${files.length} files. Commit email is explicitly allowed. Pattern scanning is not a guarantee of absence of all secrets.`);
