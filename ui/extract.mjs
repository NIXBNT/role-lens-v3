import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import {unzipSync,strFromU8} from 'fflate';
pdfjs.GlobalWorkerOptions.workerSrc='/pdf-worker.mjs';
export async function extractFile(file){
 if(file.size>10*1024*1024)throw Error(`${file.name}: maximum file size is 10 MB.`);
 const ext=file.name.split('.').pop().toLowerCase();let sections;
 if(ext==='md')sections=[{location:'Markdown',text:await file.text()}];
 else if(ext==='pdf'){
  const doc=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,disableFontFace:true}).promise;sections=[];
  if(doc.numPages>150)throw Error('PDF limit: 150 pages.');
  try{for(let i=1;i<=doc.numPages;i++){const p=await doc.getPage(i);const c=await p.getTextContent();const text=c.items.map(x=>x.str+(x.hasEOL?'\n':' ')).join('');if(text.trim().length<20)throw Error(`Page ${i} has no readable text. Upload a text PDF or apply OCR first.`);sections.push({location:`Page ${i}`,text});}}finally{await doc.destroy();}
 }else if(ext==='docx'){
  const files=unzipSync(new Uint8Array(await file.arrayBuffer()),{filter:f=>{if(f.name==='word/document.xml'&&f.originalSize>2*1024*1024)throw Error('DOCX text is too large.');return f.name==='word/document.xml';}});
  if(!files['word/document.xml'])throw Error('Invalid DOCX document.');const xml=new DOMParser().parseFromString(strFromU8(files['word/document.xml']),'application/xml');
  if(xml.querySelector('parsererror'))throw Error('DOCX XML could not be read.');
  const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';const body=xml.getElementsByTagNameNS(ns,'body')[0];if(!body)throw Error('Invalid DOCX document body.');sections=[];
  for(const [i,block] of [...body.children].entries()){
   const text=[...block.getElementsByTagNameNS(ns,'p')].map(p=>[...p.getElementsByTagNameNS(ns,'t')].map(t=>t.textContent).join('')).join('\n')||[...block.getElementsByTagNameNS(ns,'t')].map(t=>t.textContent).join('');
   if(text.trim())sections.push({location:`Block ${i+1}`,text});
  }
 }else throw Error('Choose a PDF, Markdown (.md), or DOCX file.');
 const length=sections.reduce((s,x)=>s+x.text.length,0);if(length<50||length>120000)throw Error('Upload a document with 50–120,000 characters of readable text.');
 return {filename:file.name,sections};
}
