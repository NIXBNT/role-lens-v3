import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const root=fileURLToPath(new URL('../',import.meta.url));
await fs.mkdir(new URL('../dist/',import.meta.url),{recursive:true});
await build({absWorkingDir:root,entryPoints:['ui/app.mjs'],bundle:true,outfile:'dist/app.js',format:'esm',target:'es2022',minify:true});
for(const [source,target] of [['ui/index.html','index.html'],['ui/style.css','style.css'],['node_modules/pdfjs-dist/build/pdf.worker.min.mjs','pdf-worker.mjs']]) {
  await fs.copyFile(new URL('../'+source,import.meta.url),new URL('../dist/'+target,import.meta.url));
}
console.log('Built local browser assets in dist/.');
