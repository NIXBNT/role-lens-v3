import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

/** A local JSON record store. A rename makes each completed write atomic. */
export class FileStore {
  constructor(directory) { this.directory = path.resolve(directory); }
  async init() { await fs.mkdir(this.directory, {recursive:true,mode:0o700}); }
  file(key) { return path.join(this.directory, encodeURIComponent(key)); }
  async get(key) {
    try { return JSON.parse(await fs.readFile(this.file(key),'utf8')); }
    catch (error) { if(error.code==='ENOENT')return null;throw error; }
  }
  async put(key,value) {
    const temporary=path.join(this.directory,`.tmp-${randomUUID()}`);
    try {
      await fs.writeFile(temporary,JSON.stringify(value),{mode:0o600});
      await fs.rename(temporary,this.file(key));
    } finally { await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;}); }
  }
  async list(prefix) {
    return (await fs.readdir(this.directory)).filter(name=>!name.startsWith('.tmp-')).map(name=>decodeURIComponent(name)).filter(key=>key.startsWith(prefix));
  }
}
