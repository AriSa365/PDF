import * as pdfjsLib from 'pdfjs-dist'

const median = arr => {
  const xs = arr.filter(Number.isFinite).sort((a,b)=>a-b)
  if (!xs.length) return 11
  const m = Math.floor(xs.length/2)
  return xs.length % 2 ? xs[m] : (xs[m-1]+xs[m])/2
}

export function cleanFontFamily(raw='') {
  let f = String(raw || '').replace(/^[A-Z]{6}\+/, '').replace(/[-_](Regular|Roman|Book)$/i,'').trim()
  const aliases = [
    [/Arial/i,'Arial'],[/Helvetica/i,'Arial'],[/TimesNewRoman|Times New Roman|Times-Roman/i,'Times New Roman'],
    [/Courier/i,'Courier New'],[/Calibri/i,'Calibri'],[/Cambria/i,'Cambria'],[/Georgia/i,'Georgia'],
    [/Garamond/i,'Garamond'],[/Verdana/i,'Verdana'],[/Tahoma/i,'Tahoma']
  ]
  for (const [re,name] of aliases) if (re.test(f)) return name
  return f || 'Arial'
}

const isBoldName = s => /bold|semibold|demi|black|heavy/i.test(String(s||''))
const isItalicName = s => /italic|oblique/i.test(String(s||''))

export async function extractPageLayout(page, pageNumber) {
  const viewport = page.getViewport({ scale: 1 })
  const tc = await page.getTextContent({ includeMarkedContent: true })
  const items = tc.items.filter(it => it.str && it.str.trim()).map((it, idx) => {
    const tx = pdfjsLib.Util.transform(viewport.transform, it.transform)
    const px = Math.max(4, Math.hypot(tx[2], tx[3]) || Math.hypot(tx[0], tx[1]))
    const style = tc.styles?.[it.fontName] || {}
    const family = cleanFontFamily(style.fontFamily || it.fontName)
    const x = tx[4]
    const y = tx[5] - px
    const w = Math.max(1, (it.width || 0) * viewport.scale)
    const h = px
    return {
      id:`p${pageNumber}-t${idx}`, text:it.str, x, y, w, h,
      nx:x/viewport.width, ny:y/viewport.height, nw:w/viewport.width, nh:h/viewport.height,
      sizePt:px, family, fontName:it.fontName,
      bold:isBoldName(it.fontName) || isBoldName(style.fontFamily),
      italic:isItalicName(it.fontName) || isItalicName(style.fontFamily)
    }
  })

  const baseSize = median(items.map(i=>i.sizePt))
  const sorted = [...items].sort((a,b) => Math.abs(a.y-b.y) > Math.max(2, baseSize*.35) ? a.y-b.y : a.x-b.x)
  const lines=[]
  for (const it of sorted) {
    let line = lines.find(l => Math.abs(l.y-it.y) <= Math.max(2.5, Math.min(l.h,it.h)*.45))
    if (!line) { line={items:[],y:it.y,h:it.h}; lines.push(line) }
    line.items.push(it); line.y=(line.y*(line.items.length-1)+it.y)/line.items.length; line.h=Math.max(line.h,it.h)
  }
  lines.sort((a,b)=>a.y-b.y)

  const lineModels = lines.map((line, li) => {
    line.items.sort((a,b)=>a.x-b.x)
    let text=''
    for (let i=0;i<line.items.length;i++) {
      const cur=line.items[i], prev=line.items[i-1]
      if (prev) {
        const gap=cur.x-(prev.x+prev.w)
        if (gap > Math.max(1.5, cur.sizePt*.18)) text += ' '
      }
      text += cur.text
    }
    const x=Math.min(...line.items.map(i=>i.x)), right=Math.max(...line.items.map(i=>i.x+i.w))
    const y=Math.min(...line.items.map(i=>i.y)), bottom=Math.max(...line.items.map(i=>i.y+i.h))
    const sizePt=median(line.items.map(i=>i.sizePt))
    const family=line.items.sort((a,b)=>b.w-a.w)[0]?.family || 'Arial'
    const bold=line.items.some(i=>i.bold), italic=line.items.some(i=>i.italic)
    return {id:`p${pageNumber}-l${li}`,text,x,y,w:right-x,h:bottom-y,
      nx:x/viewport.width,ny:y/viewport.height,nw:(right-x)/viewport.width,nh:(bottom-y)/viewport.height,
      sizePt,family,bold,italic,items:line.items}
  }).filter(l=>l.text.trim())

  // Paragraph reconstruction: merge nearby lines with similar indentation and font size.
  const blocks=[]
  for (const line of lineModels) {
    const prev=blocks[blocks.length-1]
    const gap = prev ? line.y-(prev.y+prev.h) : Infinity
    const sameStyle = prev && Math.abs(line.sizePt-prev.sizePt) <= Math.max(1.2, baseSize*.15)
    const sameIndent = prev && Math.abs(line.x-prev.x) <= Math.max(8, viewport.width*.025)
    const shouldMerge = prev && sameStyle && sameIndent && gap >= -2 && gap <= Math.max(baseSize*.9, line.h*.95) && !prev.text.endsWith('•')
    if (shouldMerge) {
      const join = /[-–—]$/.test(prev.text.trim()) ? '' : ' '
      prev.text += join + line.text.trim()
      prev.lines.push(line)
      const right=Math.max(prev.x+prev.w,line.x+line.w), bottom=Math.max(prev.y+prev.h,line.y+line.h)
      prev.w=right-prev.x; prev.h=bottom-prev.y; prev.nw=prev.w/viewport.width; prev.nh=prev.h/viewport.height
    } else {
      const kind = sizePtKind(line.sizePt, baseSize, line.bold, line.text)
      blocks.push({...line, id:`p${pageNumber}-b${blocks.length}`, kind, lines:[line]})
    }
  }

  return {pageNumber,width:viewport.width,height:viewport.height,baseSize,items,lineModels,blocks}
}

function sizePtKind(size, base, bold, text='') {
  const t=text.trim()
  if (size >= base*1.75) return 'title'
  if (size >= base*1.35 || (bold && size >= base*1.12)) return 'heading'
  if (/^[•·▪◦-]\s/.test(t) || /^\d+[.)]\s/.test(t)) return 'list'
  return 'paragraph'
}

export async function extractDocumentLayout(pdf, onProgress=()=>{}) {
  const pages=[]
  for (let i=1;i<=pdf.numPages;i++) {
    onProgress(`Analyzing page ${i} of ${pdf.numPages}…`)
    pages.push(await extractPageLayout(await pdf.getPage(i), i))
  }
  return {pages}
}

// Optional local AI refinement through Ollama. No PDF content leaves the machine.
// The agent classifies blocks (title/heading/paragraph/list/caption) and can repair reading order.
export async function refineWithOllama(layout, {endpoint='http://localhost:11434', model='qwen2.5:7b'}={}, onProgress=()=>{}) {
  const refined={pages:[]}
  for (const page of layout.pages) {
    onProgress(`AI-refining page ${page.pageNumber}…`)
    const compact=page.blocks.map((b,i)=>({i,text:b.text.slice(0,1200),x:+b.nx.toFixed(4),y:+b.ny.toFixed(4),size:+b.sizePt.toFixed(1),bold:b.bold,kind:b.kind}))
    const prompt=`You are a document reconstruction agent. Return ONLY valid JSON array. For each input block, return {i,kind,order}. kind must be title, heading, paragraph, list, caption, footer, or table_text. Preserve all blocks. Infer semantic type and human reading order. Input: ${JSON.stringify(compact)}`
    try {
      const res=await fetch(`${endpoint.replace(/\/$/,'')}/api/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,stream:false,format:'json',messages:[{role:'user',content:prompt}]})})
      if(!res.ok) throw new Error(`Ollama HTTP ${res.status}`)
      const data=await res.json(); let parsed=JSON.parse(data.message?.content || '[]')
      if(parsed && !Array.isArray(parsed) && Array.isArray(parsed.blocks)) parsed=parsed.blocks
      const byI=new Map((parsed||[]).map(x=>[Number(x.i),x]))
      const blocks=page.blocks.map((b,i)=>({...b,kind:byI.get(i)?.kind||b.kind,order:Number.isFinite(Number(byI.get(i)?.order))?Number(byI.get(i).order):i}))
        .sort((a,b)=>a.order-b.order)
      refined.pages.push({...page,blocks})
    } catch (e) {
      throw new Error(`Local AI agent unavailable. Start Ollama and allow browser access, or use Smart Local mode. ${e.message}`)
    }
  }
  return refined
}
