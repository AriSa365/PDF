import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { PDFDocument, degrees, rgb, StandardFonts } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx'
import pptxgen from 'pptxgenjs'
import { extractDocumentLayout, refineWithOllama } from './conversionAgent.js'
import {
  Upload, Download, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCw,
  Files, FileOutput, Type, Highlighter, PenLine, Search, Home, ImagePlus,
  Trash2, Plus, MousePointer2, Undo2, Redo2, Signature, Square, X, Copy,
  Bold, Italic, Underline, AlignLeft, Save, Move, Maximize2, Pipette, FileUp, FileText, Presentation, Sparkles
} from 'lucide-react'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36)
const clamp = (n, min, max) => Math.min(max, Math.max(min, n))
const hexToRgb = hex => {
  const clean = hex.replace('#','')
  const n = parseInt(clean.length === 3 ? clean.split('').map(c=>c+c).join('') : clean, 16)
  return { r: ((n>>16)&255)/255, g: ((n>>8)&255)/255, b:(n&255)/255 }
}

const downloadBytes = (bytes, name, type='application/pdf') => {
  const blob = new Blob([bytes], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const dataUrlToBytes = async dataUrl => new Uint8Array(await (await fetch(dataUrl)).arrayBuffer())

export default function App() {
  const canvasRef = useRef(null)
  const stageRef = useRef(null)
  const signatureCanvasRef = useRef(null)
  const signatureDrawRef = useRef(null)
  const mergeInputRef = useRef(null)

  const [file, setFile] = useState(null)
  const [bytes, setBytes] = useState(null)
  const [pdf, setPdf] = useState(null)
  const [page, setPage] = useState(1)
  const [scale, setScale] = useState(1.25)
  const [viewportSize, setViewportSize] = useState({width:0,height:0})
  const [tool, setTool] = useState('select')
  const [objects, setObjects] = useState({})
  const [selectedId, setSelectedId] = useState(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('Open a PDF to begin. Your file stays in your browser.')
  const [busy, setBusy] = useState(false)
  const [signatureOpen, setSignatureOpen] = useState(false)
  const [signatureTab, setSignatureTab] = useState('draw')
  const [typedSignature, setTypedSignature] = useState('')
  const [savedSignature, setSavedSignature] = useState(()=>localStorage.getItem('pdf-workbench-signature') || '')
  const [history, setHistory] = useState([])
  const [future, setFuture] = useState([])
  const [textRuns, setTextRuns] = useState([])
  const [customFonts, setCustomFonts] = useState({})
  const highlightPresets = ['#facc15','#86efac','#7dd3fc','#f9a8d4','#fdba74','#c4b5fd','#fca5a5','#d1d5db']
  const [highlightColor, setHighlightColor] = useState(()=>localStorage.getItem('pdf-workbench-highlight-color') || '#facc15')
  const [highlightOpacity, setHighlightOpacity] = useState(()=>Number(localStorage.getItem('pdf-workbench-highlight-opacity') || .35))
  const [mergeOpen, setMergeOpen] = useState(false)
  const [mergeQueue, setMergeQueue] = useState([])
  const [mergeOutputName, setMergeOutputName] = useState('merged.pdf')

  useEffect(()=>{ localStorage.setItem('pdf-workbench-highlight-color', highlightColor) },[highlightColor])
  useEffect(()=>{ localStorage.setItem('pdf-workbench-highlight-opacity', String(highlightOpacity)) },[highlightOpacity])

  const currentObjects = objects[page] || []
  const selected = useMemo(() => currentObjects.find(o=>o.id===selectedId) || null, [currentObjects, selectedId])

  const pushObjects = updater => {
    setObjects(prev => {
      const before = JSON.stringify(prev)
      const next = typeof updater === 'function' ? updater(prev) : updater
      setHistory(h => [...h.slice(-29), before])
      setFuture([])
      return next
    })
  }

  const undo = () => {
    if (!history.length) return
    const prev = history[history.length-1]
    setFuture(f => [JSON.stringify(objects), ...f].slice(0,30))
    setHistory(h => h.slice(0,-1))
    setObjects(JSON.parse(prev)); setSelectedId(null)
  }
  const redo = () => {
    if (!future.length) return
    const next = future[0]
    setHistory(h => [...h, JSON.stringify(objects)].slice(-30))
    setFuture(f => f.slice(1))
    setObjects(JSON.parse(next)); setSelectedId(null)
  }

  const openBytes = async (arr, name='document.pdf') => {
    setBusy(true)
    try {
      const copy = arr instanceof Uint8Array ? arr.slice() : new Uint8Array(arr)
      const doc = await pdfjsLib.getDocument({ data: copy.slice() }).promise
      setBytes(copy); setPdf(doc); setPage(1); setObjects({}); setSelectedId(null); setHistory([]); setFuture([])
      setFile({ name })
      setStatus(`${name} • ${doc.numPages} page${doc.numPages === 1 ? '' : 's'}`)
    } catch (e) { setStatus(`Could not open PDF: ${e.message}`) }
    finally { setBusy(false) }
  }

  const onFile = async e => {
    const f = e.target.files?.[0]
    if (!f) return
    await openBytes(await f.arrayBuffer(), f.name)
    e.target.value = ''
  }

  useEffect(() => {
    if (!pdf) return
    let cancelled = false
    ;(async () => {
      const p = await pdf.getPage(page)
      const viewport = p.getViewport({ scale })
      if (cancelled) return
      const canvas = canvasRef.current
      canvas.width = viewport.width; canvas.height = viewport.height
      canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`
      setViewportSize({width:viewport.width,height:viewport.height})
      await p.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
      const tc = await p.getTextContent()
      const cleanFamily = (raw='') => {
        let f = String(raw || '').replace(/^[A-Z]{6}\+/, '').trim()
        const aliases = [
          [/ArialMT/i, 'Arial'], [/Arial-BoldMT/i, 'Arial'],
          [/TimesNewRomanPSMT/i, 'Times New Roman'], [/TimesNewRomanPS/i, 'Times New Roman'],
          [/CourierNewPSMT/i, 'Courier New'], [/Calibri/i, 'Calibri'],
          [/HelveticaNeue/i, 'Helvetica Neue'], [/Helvetica/i, 'Helvetica']
        ]
        for (const [re,name] of aliases) if (re.test(f)) return name
        return f || 'Helvetica'
      }
      const runs = tc.items.filter(it => it.str?.trim()).map(it => {
        const tx = pdfjsLib.Util.transform(viewport.transform, it.transform)
        const displayPx = Math.max(5, Math.hypot(tx[2], tx[3]) || Math.hypot(tx[0], tx[1]))
        const style = tc.styles?.[it.fontName] || {}
        let family = style.fontFamily || 'Helvetica'
        try {
          const fo = p.commonObjs.get(it.fontName)
          family = fo?.fontFamily || fo?.fallbackName || fo?.name || family
        } catch {}
        family = cleanFamily(family)
        return {
          text: it.str,
          x: tx[4] / viewport.width,
          y: (tx[5] - displayPx) / viewport.height,
          w: Math.max(.005, (it.width * viewport.scale) / viewport.width),
          h: displayPx / viewport.height,
          // Store size in PDF-ish points, not zoom-dependent screen pixels.
          sizePt: displayPx / scale,
          displayPx,
          family,
          fontName: it.fontName,
          rawFamily: style.fontFamily || family
        }
      })
      setTextRuns(runs)
    })()
    return () => { cancelled = true }
  }, [pdf, page, scale])

  // Keep the selected text object while entering Match Font mode.
  // Clearing selection on every tool change made Match Font lose its target.
  useEffect(()=>setSelectedId(null),[page])

  const pagePos = e => {
    const r = stageRef.current.getBoundingClientRect()
    return { x: clamp((e.clientX-r.left)/r.width,0,1), y: clamp((e.clientY-r.top)/r.height,0,1) }
  }

  const drawRef = useRef(null)
  const onStageDown = e => {
    if (!pdf || e.target.closest('.edit-object')) return
    const p = pagePos(e)
    if (tool === 'select') { setSelectedId(null); return }
    if (tool === 'matchfont') {
      if (!selected || selected.kind !== 'text') { setStatus('Select an added text box first, then choose Match PDF text.'); setTool('select'); return }
      if (!textRuns.length) { setStatus('No selectable text was detected on this page. It may be a scanned image.'); setTool('select'); return }
      // Prefer a text run whose bounding box contains the click. If none does, use the nearest run.
      const padX=.008, padY=.01
      const hit = textRuns
        .filter(r => p.x >= r.x-padX && p.x <= r.x+r.w+padX && p.y >= r.y-padY && p.y <= r.y+r.h+padY)
        .sort((a,b) => (a.w*a.h)-(b.w*b.h))[0]
      const nearest = hit || [...textRuns].sort((a,b) => {
        const da = Math.hypot((a.x+a.w/2)-p.x,(a.y+a.h/2)-p.y)
        const db = Math.hypot((b.x+b.w/2)-p.x,(b.y+b.h/2)-p.y)
        return da-db
      })[0]
      const matchedSize = Math.max(6, Math.round((nearest.sizePt || 12) * 10) / 10)
      updateObject(selected.id,{
        font:`pdf:${nearest.family}`,
        pdfFontFamily:nearest.family,
        pdfFontName:nearest.fontName,
        size:matchedSize
      })
      setStatus(`Matched “${nearest.text.slice(0,40)}” → ${nearest.family}, ~${matchedSize} pt. If the PDF uses an embedded/subset font, upload the matching TTF/OTF for exact export.`)
      setTool('select')
      return
    }
    if (tool === 'text') {
      const obj = {id:uid(),kind:'text',x:p.x,y:p.y,w:.24,h:.055,text:'Double-click to edit',font:'Helvetica',size:18,bold:false,italic:false,underline:false,color:'#111827',opacity:1}
      pushObjects(prev=>({...prev,[page]:[...(prev[page]||[]),obj]})); setSelectedId(obj.id); setTool('select'); return
    }
    if (tool === 'signature') { setSignatureOpen(true); return }
    drawRef.current = { start:p, points:[p] }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  const onStageMove = e => {
    if (!drawRef.current || tool !== 'draw') return
    drawRef.current.points.push(pagePos(e))
    setObjects(prev=>({...prev,[page]:[...(prev[page]||[]).filter(o=>o.id!=='__preview'),{id:'__preview',kind:'stroke',points:[...drawRef.current.points],color:'#e11d48',width:3}]}))
  }

  const onStageUp = e => {
    const cur = drawRef.current; if(!cur) return
    const p = pagePos(e); let obj=null
    if(tool==='draw') obj={id:uid(),kind:'stroke',points:[...cur.points,p],color:'#e11d48',width:3}
    if(tool==='highlight') obj={id:uid(),kind:'highlight',x:Math.min(cur.start.x,p.x),y:Math.min(cur.start.y,p.y),w:Math.abs(p.x-cur.start.x),h:Math.abs(p.y-cur.start.y),color:highlightColor,opacity:highlightOpacity}
    if(tool==='whiteout') obj={id:uid(),kind:'whiteout',x:Math.min(cur.start.x,p.x),y:Math.min(cur.start.y,p.y),w:Math.abs(p.x-cur.start.x),h:Math.abs(p.y-cur.start.y)}
    setObjects(prev=>({...prev,[page]:(prev[page]||[]).filter(o=>o.id!=='__preview')}))
    if(obj) pushObjects(prev=>({...prev,[page]:[...(prev[page]||[]).filter(o=>o.id!=='__preview'),obj]}))
    drawRef.current=null
  }

  const updateObject = (id, patch, record=true) => {
    const fn = prev => ({...prev,[page]:(prev[page]||[]).map(o=>o.id===id?{...o,...patch}:o)})
    if(record) pushObjects(fn); else setObjects(fn)
  }
  const removeSelected = () => selectedId && pushObjects(prev=>({...prev,[page]:(prev[page]||[]).filter(o=>o.id!==selectedId)}))
  const duplicateSelected = () => {
    if(!selected) return
    const obj={...selected,id:uid(),x:clamp((selected.x||0)+.025,0,.95),y:clamp((selected.y||0)+.025,0,.95)}
    pushObjects(prev=>({...prev,[page]:[...(prev[page]||[]),obj]})); setSelectedId(obj.id)
  }

  useEffect(()=>{
    const key=e=>{
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo()}
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redo()}
      if((e.key==='Delete'||e.key==='Backspace')&&selectedId&&!['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)){e.preventDefault();removeSelected()}
    }
    window.addEventListener('keydown',key); return()=>window.removeEventListener('keydown',key)
  },[selectedId,selected,history,future,objects])

  const saveAnnotated = async () => {
    if(!bytes) return
    setBusy(true)
    try {
      const doc=await PDFDocument.load(bytes)
      doc.registerFontkit(fontkit)
      const fontMap={
        Helvetica: await doc.embedFont(StandardFonts.Helvetica),
        Times: await doc.embedFont(StandardFonts.TimesRoman),
        Courier: await doc.embedFont(StandardFonts.Courier)
      }
      const boldMap={
        Helvetica: await doc.embedFont(StandardFonts.HelveticaBold),
        Times: await doc.embedFont(StandardFonts.TimesRomanBold),
        Courier: await doc.embedFont(StandardFonts.CourierBold)
      }
      const italicMap={
        Helvetica: await doc.embedFont(StandardFonts.HelveticaOblique),
        Times: await doc.embedFont(StandardFonts.TimesRomanItalic),
        Courier: await doc.embedFont(StandardFonts.CourierOblique)
      }
      const embeddedCustom = {}
      for (const [id, cf] of Object.entries(customFonts)) {
        try { embeddedCustom[id] = await doc.embedFont(cf.bytes, { subset: true }) } catch {}
      }
      const fallbackBase = value => {
        const v=(value||'Helvetica').toLowerCase()
        if(v.includes('courier')||v.includes('mono')) return 'Courier'
        if(v.includes('times')||v.includes('georgia')||v.includes('garamond')||v.includes('palatino')||v.includes('bookman')||v.includes('serif')) return 'Times'
        return 'Helvetica'
      }
      for(const [pg,items] of Object.entries(objects)) {
        const p=doc.getPage(Number(pg)-1), {width,height}=p.getSize()
        for(const n of items){
          if(n.id==='__preview') continue
          if(n.kind==='text') {
            const {r,g,b}=hexToRgb(n.color||'#111827')
            const customId = (n.font||'').startsWith('custom:') ? n.font.split(':')[1] : null
            const base = fallbackBase(n.font)
            const font = customId && embeddedCustom[customId] ? embeddedCustom[customId] : n.bold ? boldMap[base] : n.italic ? italicMap[base] : fontMap[base]
            const size=(n.size||18)
            p.drawText(n.text||'',{x:n.x*width,y:height-(n.y*height)-size,size,font,color:rgb(r,g,b),opacity:n.opacity??1,maxWidth:n.w*width})
            if(n.underline) p.drawLine({start:{x:n.x*width,y:height-(n.y*height)-size*1.15},end:{x:(n.x+n.w)*width,y:height-(n.y*height)-size*1.15},thickness:1,color:rgb(r,g,b),opacity:n.opacity??1})
          }
          if(n.kind==='highlight') {const {r,g,b}=hexToRgb(n.color||'#facc15');p.drawRectangle({x:n.x*width,y:height-(n.y+n.h)*height,width:n.w*width,height:n.h*height,color:rgb(r,g,b),opacity:n.opacity??.35})}
          if(n.kind==='whiteout') p.drawRectangle({x:n.x*width,y:height-(n.y+n.h)*height,width:n.w*width,height:n.h*height,color:rgb(1,1,1),opacity:1})
          if(n.kind==='stroke') for(let i=1;i<n.points.length;i++){const a=n.points[i-1],b=n.points[i],c=hexToRgb(n.color||'#e11d48');p.drawLine({start:{x:a.x*width,y:height-a.y*height},end:{x:b.x*width,y:height-b.y*height},thickness:(n.width||3)/1.25,color:rgb(c.r,c.g,c.b)})}
          if(n.kind==='signature' && n.dataUrl){
            const imgBytes=await dataUrlToBytes(n.dataUrl); let img
            try{img=await doc.embedPng(imgBytes)}catch{img=await doc.embedJpg(imgBytes)}
            p.drawImage(img,{x:n.x*width,y:height-(n.y+n.h)*height,width:n.w*width,height:n.h*height,opacity:n.opacity??1})
          }
        }
      }
      downloadBytes(await doc.save(), `edited-${file?.name || 'document.pdf'}`)
      setStatus('Saved an edited copy. Whiteouts and replacement text are flattened into the export.')
    } catch(e){setStatus(`Save failed: ${e.message}`)} finally{setBusy(false)}
  }

  const rotatePage = async () => {
    if(!bytes)return
    const doc=await PDFDocument.load(bytes); const p=doc.getPage(page-1)
    p.setRotation(degrees((p.getRotation().angle+90)%360)); const out=await doc.save(); await openBytes(out,file.name)
  }
  const extractPage = async () => {
    if(!bytes)return
    const src=await PDFDocument.load(bytes), out=await PDFDocument.create(); const [p]=await out.copyPages(src,[page-1]); out.addPage(p)
    downloadBytes(await out.save(), `${file.name.replace(/\.pdf$/i,'')}-page-${page}.pdf`)
  }
  const deletePage = async () => {
    if(!bytes || pdf.numPages<=1)return
    const doc=await PDFDocument.load(bytes); doc.removePage(page-1); const out=await doc.save(); await openBytes(out,file.name)
  }
  const stageMergeFiles = e => {
    const fs=[...e.target.files]
    if(!fs.length) return
    setMergeQueue(prev=>[...prev,...fs.map(f=>({id:uid(),file:f}))])
    setStatus(`Staged ${fs.length} PDF${fs.length>1?'s':''}. You can add files from another location before merging.`)
    e.target.value=''
  }
  const removeMergeItem = id => setMergeQueue(prev=>prev.filter(item=>item.id!==id))
  const moveMergeItem = (index, direction) => {
    setMergeQueue(prev=>{
      const next=[...prev], target=index+direction
      if(target<0 || target>=next.length) return prev
      ;[next[index],next[target]]=[next[target],next[index]]
      return next
    })
  }
  const mergeStagedFiles = async () => {
    if(mergeQueue.length<2){setStatus('Stage at least two PDF files before merging.');return}
    setBusy(true)
    try{
      const out=await PDFDocument.create()
      for(const item of mergeQueue){
        const src=await PDFDocument.load(await item.file.arrayBuffer())
        const pages=await out.copyPages(src,src.getPageIndices())
        pages.forEach(p=>out.addPage(p))
      }
      const base=(mergeOutputName || 'merged.pdf').trim().replace(/[\\/:*?"<>|]+/g,'-')
      const filename=base.toLowerCase().endsWith('.pdf')?base:`${base}.pdf`
      downloadBytes(await out.save(),filename)
      setStatus(`Merged ${mergeQueue.length} staged PDF files in the displayed order.`)
      setMergeQueue([]); setMergeOpen(false)
    }catch(err){setStatus(`Merge failed: ${err.message}`)}finally{setBusy(false)}
  }
  const imageToPdf = async e => {
    const fs=[...e.target.files]; if(!fs.length)return
    setBusy(true)
    try{const out=await PDFDocument.create();for(const f of fs){const data=new Uint8Array(await f.arrayBuffer());let img=f.type==='image/png'?await out.embedPng(data):await out.embedJpg(data);const dims=img.scale(1),maxW=595,maxH=842,ratio=Math.min(maxW/dims.width,maxH/dims.height,1);const p=out.addPage([maxW,maxH]);const w=dims.width*ratio,h=dims.height*ratio;p.drawImage(img,{x:(maxW-w)/2,y:(maxH-h)/2,width:w,height:h})}downloadBytes(await out.save(),'images.pdf');setStatus(`Converted ${fs.length} image${fs.length>1?'s':''} to PDF.`)}catch(err){setStatus(`Image conversion failed: ${err.message}`)}finally{setBusy(false);e.target.value=''}
  }
  const [convertMode, setConvertMode] = useState('smart')
  const [ollamaModel, setOllamaModel] = useState('qwen2.5:7b')

  const buildStructuredLayout = async () => {
    let layout = await extractDocumentLayout(pdf, msg=>setStatus(msg))
    if (convertMode === 'ai') {
      setStatus(`Running local AI reconstruction agent (${ollamaModel})…`)
      layout = await refineWithOllama(layout, {model:ollamaModel}, msg=>setStatus(msg))
    }
    return layout
  }

  const pdfToWord = async () => {
    if(!pdf) return
    setBusy(true); setStatus('Separating PDF text and reconstructing editable Word content…')
    try {
      const layout=await buildStructuredLayout()
      const children=[]
      for(const pg of layout.pages){
        for(const b of pg.blocks){
          if(b.kind==='footer') continue
          const heading = b.kind==='title' ? HeadingLevel.TITLE : b.kind==='heading' ? HeadingLevel.HEADING_1 : undefined
          const bullet = b.kind==='list' ? {level:0} : undefined
          children.push(new Paragraph({
            heading,
            bullet,
            spacing:{after: b.kind==='title'?180:b.kind==='heading'?120:80},
            children:[new TextRun({text:b.text,bold:b.bold,italics:b.italic,font:b.family||'Arial',size:Math.max(16,Math.min(56,Math.round((b.sizePt||11)*2)))})]
          }))
        }
        if(pg.pageNumber<layout.pages.length) children.push(new Paragraph({pageBreakBefore:true,children:[new TextRun('')]}))
      }
      const doc=new Document({sections:[{children}]})
      const blob=await Packer.toBlob(doc), url=URL.createObjectURL(blob), a=document.createElement('a')
      a.href=url;a.download=`${(file?.name||'document').replace(/\.pdf$/i,'')}-editable.docx`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
      setStatus(`Editable Word created from reconstructed text${convertMode==='ai'?' with local AI refinement':''}. No page screenshots were pasted.`)
    }catch(err){setStatus(`Word conversion failed: ${err.message}`)}finally{setBusy(false)}
  }

  const pdfToPowerPoint = async () => {
    if(!pdf) return
    setBusy(true); setStatus('Separating PDF text into editable PowerPoint objects…')
    try{
      const layout=await buildStructuredLayout()
      const pptx=new pptxgen(); pptx.layout='LAYOUT_WIDE'; pptx.author='PDF Workbench'; pptx.subject='Editable reconstruction from PDF'
      const sw=13.333, sh=7.5
      for(const pg of layout.pages){
        const slide=pptx.addSlide()
        // Each reconstructed line becomes an independent, editable PowerPoint text box.
        for(const line of pg.lineModels){
          const x=Math.max(0,line.nx*sw), y=Math.max(0,line.ny*sh)
          const w=Math.max(.08,Math.min(sw-x,line.nw*sw+.08)), h=Math.max(.16,Math.min(sh-y,line.nh*sh*1.35+.06))
          slide.addText(line.text,{x,y,w,h,fontFace:line.family||'Arial',fontSize:Math.max(5,Math.min(44,line.sizePt||11)),bold:!!line.bold,italic:!!line.italic,margin:0,breakLine:false,fit:'shrink',valign:'mid',color:'111111',transparency:0})
        }
      }
      await pptx.writeFile({fileName:`${(file?.name||'document').replace(/\.pdf$/i,'')}-editable.pptx`})
      setStatus(`Editable PowerPoint created: PDF text is now separate PowerPoint text boxes${convertMode==='ai'?' with local AI structural refinement':''}. Graphics are not flattened behind the text.`)
    }catch(err){setStatus(`PowerPoint conversion failed: ${err.message}`)}finally{setBusy(false)}
  }

  const search = async () => {
    if(!pdf || !query.trim()) return
    setBusy(true); const found=[]
    for(let i=1;i<=pdf.numPages;i++){const p=await pdf.getPage(i),tc=await p.getTextContent();const text=tc.items.map(x=>x.str).join(' ');if(text.toLowerCase().includes(query.toLowerCase())) found.push(i)}
    setStatus(found.length?`Found “${query}” on page${found.length>1?'s':''} ${found.join(', ')}.`:`No matches for “${query}”.`);setBusy(false)
  }

  const beginObjectDrag = (e,obj) => {
    if(tool!=='select') return
    e.stopPropagation(); e.preventDefault(); setSelectedId(obj.id)
    const before=JSON.stringify(objects)
    const startX=e.clientX,startY=e.clientY,baseX=obj.x,baseY=obj.y
    const move=ev=>updateObject(obj.id,{x:clamp(baseX+(ev.clientX-startX)/viewportSize.width,0,1-obj.w),y:clamp(baseY+(ev.clientY-startY)/viewportSize.height,0,1-obj.h)},false)
    const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);setHistory(h=>[...h.slice(-29),before]);setFuture([])}
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',up)
  }

  const beginResize = (e,obj) => {
    e.stopPropagation();e.preventDefault();setSelectedId(obj.id)
    const before=JSON.stringify(objects)
    const sx=e.clientX,sy=e.clientY,bw=obj.w,bh=obj.h
    const move=ev=>updateObject(obj.id,{w:clamp(bw+(ev.clientX-sx)/viewportSize.width,.04,1-obj.x),h:clamp(bh+(ev.clientY-sy)/viewportSize.height,.025,1-obj.y)},false)
    const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);setHistory(h=>[...h.slice(-29),before]);setFuture([])}
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',up)
  }

  const addSignatureData = dataUrl => {
    if(!dataUrl) return
    const obj={id:uid(),kind:'signature',dataUrl,x:.2,y:.2,w:.28,h:.10,opacity:1}
    pushObjects(prev=>({...prev,[page]:[...(prev[page]||[]),obj]}));setSelectedId(obj.id);setTool('select');setSignatureOpen(false)
  }

  const clearSignatureCanvas = () => {
    const c=signatureCanvasRef.current;if(!c)return;const ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height)
  }
  const signaturePointerDown=e=>{
    const c=signatureCanvasRef.current,r=c.getBoundingClientRect(),ctx=c.getContext('2d');signatureDrawRef.current=true;ctx.strokeStyle='#111827';ctx.lineWidth=3;ctx.lineCap='round';ctx.beginPath();ctx.moveTo((e.clientX-r.left)*c.width/r.width,(e.clientY-r.top)*c.height/r.height)
  }
  const signaturePointerMove=e=>{
    if(!signatureDrawRef.current)return;const c=signatureCanvasRef.current,r=c.getBoundingClientRect(),ctx=c.getContext('2d');ctx.lineTo((e.clientX-r.left)*c.width/r.width,(e.clientY-r.top)*c.height/r.height);ctx.stroke()
  }
  const signaturePointerUp=()=>signatureDrawRef.current=false
  const useDrawnSignature=()=>{
    const data=signatureCanvasRef.current?.toDataURL('image/png');if(data){localStorage.setItem('pdf-workbench-signature',data);setSavedSignature(data);addSignatureData(data)}
  }
  const useTypedSignature=()=>{
    if(!typedSignature.trim())return
    const c=document.createElement('canvas');c.width=900;c.height=240;const ctx=c.getContext('2d');ctx.font='italic 120px cursive';ctx.fillStyle='#111827';ctx.textBaseline='middle';ctx.fillText(typedSignature,30,120);const data=c.toDataURL('image/png');localStorage.setItem('pdf-workbench-signature',data);setSavedSignature(data);addSignatureData(data)
  }
  const uploadSignature=e=>{const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=()=>{const data=r.result;localStorage.setItem('pdf-workbench-signature',data);setSavedSignature(data);addSignatureData(data)};r.readAsDataURL(f);e.target.value=''}

  const fontCss = value => {
    if((value||'').startsWith('custom:')) return customFonts[value.split(':')[1]]?.family || 'Arial'
    if((value||'').startsWith('pdf:')) return value.slice(4)
    const map={Helvetica:'Arial',Times:'Times New Roman',Courier:'Courier New'}
    return map[value] || value || 'Arial'
  }
  const commonFonts=['Helvetica','Arial','Calibri','Verdana','Tahoma','Trebuchet MS','Century Gothic','Times','Times New Roman','Georgia','Garamond','Palatino Linotype','Bookman Old Style','Courier','Courier New']
  const detectedFonts=[...new Set(textRuns.map(r=>r.family).filter(Boolean))]
  const uploadFont=async e=>{
    const f=e.target.files?.[0]; if(!f||!selected||selected.kind!=='text') return
    try{
      const arr=new Uint8Array(await f.arrayBuffer())
      const id=uid(), family=f.name.replace(/\.(ttf|otf)$/i,'')
      const url=URL.createObjectURL(new Blob([arr]))
      const ff=new FontFace(family,`url(${url})`); await ff.load(); document.fonts.add(ff)
      setCustomFonts(prev=>({...prev,[id]:{family,bytes:arr}}))
      updateObject(selected.id,{font:`custom:${id}`})
      setStatus(`Loaded ${family}. This font will be embedded into the exported PDF.`)
    }catch(err){setStatus(`Could not load font: ${err.message}`)}
    e.target.value=''
  }

  return <div className="app">
    <header>
      <div className="brand"><div className="logo">PDF</div><div><b>PDF Workbench</b><span>Editor v3.5 • local-first</span></div></div>
      <div className="status">{busy?'Working…':status}</div>
      <label className="primary"><Upload size={17}/> Open PDF<input hidden type="file" accept="application/pdf" onChange={onFile}/></label>
    </header>

    <aside>
      <button className="nav active"><Home/>Workspace</button>
      <div className="section">EDIT</div>
      <button className={tool==='select'?'active':''} onClick={()=>setTool('select')}><MousePointer2/>Select / move</button>
      <button className={tool==='text'?'active':''} onClick={()=>setTool('text')}><Type/>Add text</button>
      <button className={tool==='whiteout'?'active':''} onClick={()=>setTool('whiteout')}><Square/>Whiteout / erase</button>
      <button className={tool==='signature'?'active':''} onClick={()=>{setTool('signature');setSignatureOpen(true)}}><Signature/>Signature</button>
      <div className="section">ANNOTATE</div>
      <button className={tool==='highlight'?'active':''} onClick={()=>setTool('highlight')}><Highlighter/>Highlight area</button>
      <button className={tool==='draw'?'active':''} onClick={()=>setTool('draw')}><PenLine/>Draw</button>
      <div className="section">PAGE TOOLS</div>
      <button onClick={rotatePage} disabled={!pdf}><RotateCw/>Rotate page</button>
      <button onClick={extractPage} disabled={!pdf}><FileOutput/>Extract page</button>
      <button onClick={deletePage} disabled={!pdf || pdf?.numPages<=1}><Trash2/>Delete page</button>
      <div className="section">PDF TOOLS</div>
      <button onClick={()=>setMergeOpen(true)}><Files/>Merge PDFs{mergeQueue.length>0 && <span className="queue-badge">{mergeQueue.length}</span>}</button>
      <label className="side-label"><ImagePlus/>Images → PDF<input hidden multiple type="file" accept="image/png,image/jpeg" onChange={imageToPdf}/></label>
      <div className="section">SMART CONVERT</div>
      <div className="convert-agent-card">
        <div className="agent-title"><Sparkles/>Reconstruction agent</div>
        <label><input type="radio" checked={convertMode==='smart'} onChange={()=>setConvertMode('smart')}/> Smart local</label>
        <label><input type="radio" checked={convertMode==='ai'} onChange={()=>setConvertMode('ai')}/> Local AI (Ollama)</label>
        {convertMode==='ai' && <input className="agent-model" value={ollamaModel} onChange={e=>setOllamaModel(e.target.value)} placeholder="Ollama model"/>}
      </div>
      <button onClick={pdfToWord} disabled={!pdf||busy}><FileText/>Editable Word</button>
      <button onClick={pdfToPowerPoint} disabled={!pdf||busy}><Presentation/>Editable PowerPoint</button>
    </aside>

    <main>
      <div className="toolbar">
        <div className="group"><button onClick={undo} disabled={!history.length} title="Undo"><Undo2/></button><button onClick={redo} disabled={!future.length} title="Redo"><Redo2/></button></div>
        <div className="group"><button disabled={!pdf||page<=1} onClick={()=>setPage(p=>p-1)}><ChevronLeft/></button><span>{pdf?`${page} / ${pdf.numPages}`:'— / —'}</span><button disabled={!pdf||page>=pdf.numPages} onClick={()=>setPage(p=>p+1)}><ChevronRight/></button></div>
        <div className="group"><button onClick={()=>setScale(s=>Math.max(.5,s-.15))}><ZoomOut/></button><span>{Math.round(scale*100)}%</span><button onClick={()=>setScale(s=>Math.min(3,s+.15))}><ZoomIn/></button></div>
        <div className="search"><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==='Enter'&&search()} placeholder="Search text…"/><button onClick={search}><Search/></button></div>
        <button className="save" disabled={!pdf} onClick={saveAnnotated}><Download/>Export edited PDF</button>
      </div>

      {selected?.kind==='text' && <div className="properties">
        <select value={selected.font} onChange={e=>updateObject(selected.id,{font:e.target.value})}>
          <optgroup label="Common fonts">{commonFonts.map(f=><option key={f} value={f}>{f}</option>)}</optgroup>
          {detectedFonts.length>0 && <optgroup label="Detected in this PDF">{detectedFonts.map(f=><option key={`pdf:${f}`} value={`pdf:${f}`}>PDF: {f}</option>)}</optgroup>}
          {Object.entries(customFonts).length>0 && <optgroup label="Uploaded fonts">{Object.entries(customFonts).map(([id,f])=><option key={id} value={`custom:${id}`}>{f.family}</option>)}</optgroup>}
        </select>
        <button onClick={()=>{setTool('matchfont');setStatus('Match font mode: click directly on the existing PDF text whose font and size you want to copy.')}}><Pipette/>Match PDF text</button>
        <label className="font-upload"><FileUp/>Upload font<input hidden type="file" accept=".ttf,.otf,font/ttf,font/otf" onChange={uploadFont}/></label>
        <label>Size <input type="number" min="8" max="96" value={selected.size} onChange={e=>updateObject(selected.id,{size:Number(e.target.value)})}/></label>
        <button className={selected.bold?'active':''} onClick={()=>updateObject(selected.id,{bold:!selected.bold,italic:false})}><Bold/></button>
        <button className={selected.italic?'active':''} onClick={()=>updateObject(selected.id,{italic:!selected.italic,bold:false})}><Italic/></button>
        <button className={selected.underline?'active':''} onClick={()=>updateObject(selected.id,{underline:!selected.underline})}><Underline/></button>
        <input type="color" value={selected.color} onChange={e=>updateObject(selected.id,{color:e.target.value})} title="Text color"/>
        <label>Opacity <input type="range" min="0.1" max="1" step="0.1" value={selected.opacity} onChange={e=>updateObject(selected.id,{opacity:Number(e.target.value)})}/></label>
        <button onClick={duplicateSelected}><Copy/>Duplicate</button><button className="danger" onClick={removeSelected}><Trash2/>Delete</button>
      </div>}
      {(tool==='highlight' || selected?.kind==='highlight') && <div className="properties highlight-properties">
        <span className="selected-label"><Highlighter/>Highlight</span>
        <div className="swatches">{highlightPresets.map(c=><button key={c} className={`swatch ${((selected?.kind==='highlight'?selected.color:highlightColor)===c)?'chosen':''}`} style={{background:c}} title={c} onClick={()=>{setHighlightColor(c); if(selected?.kind==='highlight') updateObject(selected.id,{color:c})}} />)}</div>
        <label className="custom-color">Custom <input type="color" value={selected?.kind==='highlight'?(selected.color||highlightColor):highlightColor} onChange={e=>{setHighlightColor(e.target.value); if(selected?.kind==='highlight') updateObject(selected.id,{color:e.target.value})}}/></label>
        <label className="opacity-control">Opacity <input type="range" min="0.1" max="0.8" step="0.05" value={selected?.kind==='highlight'?(selected.opacity??highlightOpacity):highlightOpacity} onChange={e=>{const v=Number(e.target.value);setHighlightOpacity(v);if(selected?.kind==='highlight')updateObject(selected.id,{opacity:v},false)}}/><span>{Math.round((selected?.kind==='highlight'?(selected.opacity??highlightOpacity):highlightOpacity)*100)}%</span></label>
      </div>}
      {selected && selected.kind!=='text' && <div className="properties"><span className="selected-label"><Move/>Selected {selected.kind}</span><button onClick={duplicateSelected}><Copy/>Duplicate</button><button className="danger" onClick={removeSelected}><Trash2/>Delete</button></div>}

      <div className="stage">
        {!pdf && <div className="empty"><div className="empty-icon"><Upload size={34}/></div><h1>Open a PDF</h1><p>Edit with movable text, signatures, whiteout, highlights and drawing. Everything runs locally in your browser.</p><label className="primary big"><Plus/>Choose PDF<input hidden type="file" accept="application/pdf" onChange={onFile}/></label><div className="privacy">No server upload is required for the core tools.</div></div>}
        {pdf && <div className={`page-wrap tool-${tool}`} ref={stageRef} onPointerDown={onStageDown} onPointerMove={onStageMove} onPointerUp={onStageUp} style={{width:viewportSize.width,height:viewportSize.height}}>
          <canvas ref={canvasRef}/>
          <div className="object-layer">
            {currentObjects.map(obj => {
              if(obj.id==='__preview' && obj.kind==='stroke') return <svg key={obj.id} className="stroke-svg"><polyline points={obj.points.map(p=>`${p.x*viewportSize.width},${p.y*viewportSize.height}`).join(' ')} fill="none" stroke={obj.color} strokeWidth={obj.width} strokeLinecap="round"/></svg>
              if(obj.kind==='stroke') return <svg key={obj.id} className="stroke-svg" onPointerDown={e=>{e.stopPropagation();setSelectedId(obj.id)}}><polyline points={obj.points.map(p=>`${p.x*viewportSize.width},${p.y*viewportSize.height}`).join(' ')} fill="none" stroke={obj.color} strokeWidth={obj.width} strokeLinecap="round"/></svg>
              const style={left:`${obj.x*100}%`,top:`${obj.y*100}%`,width:`${obj.w*100}%`,height:`${obj.h*100}%`,opacity:obj.opacity??1}
              return <div key={obj.id} className={`edit-object ${obj.kind} ${selectedId===obj.id?'selected':''}`} style={style} onPointerDown={e=>{e.stopPropagation();setSelectedId(obj.id)}}>
                {obj.kind==='text' && <textarea spellCheck="false" value={obj.text} onPointerDown={e=>{e.stopPropagation();setSelectedId(obj.id)}} onChange={e=>updateObject(obj.id,{text:e.target.value},false)} style={{fontFamily:fontCss(obj.font),fontSize:`${(obj.size||18)*scale}px`,fontWeight:obj.bold?'700':'400',fontStyle:obj.italic?'italic':'normal',textDecoration:obj.underline?'underline':'none',color:obj.color}}/>}
                {obj.kind==='signature' && <img src={obj.dataUrl} alt="signature" draggable="false"/>}
                {obj.kind==='highlight' && <div className="fill" style={{background:obj.color,opacity:obj.opacity}}/>}
                {obj.kind==='whiteout' && <div className="fill white"/>}
                {selectedId===obj.id && <button className="move-handle" onPointerDown={e=>beginObjectDrag(e,obj)} title="Drag to move"><Move/></button>}
                {selectedId===obj.id && <button className="resize-handle" onPointerDown={e=>beginResize(e,obj)} title="Resize"><Maximize2/></button>}
              </div>
            })}
          </div>
        </div>}
      </div>
    </main>

    {mergeOpen && <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setMergeOpen(false)}}><div className="modal merge-modal">
      <div className="modal-head"><div><h2>Merge PDFs</h2><p>Stage PDFs from as many folders, drives, or locations as you need. They will merge in the order shown.</p></div><button onClick={()=>setMergeOpen(false)}><X/></button></div>
      <input ref={mergeInputRef} hidden multiple type="file" accept="application/pdf,.pdf" onChange={stageMergeFiles}/>
      <div className="merge-add-row">
        <button className="merge-add primary" onClick={()=>mergeInputRef.current?.click()}><Plus/>{mergeQueue.length?'Add more PDFs':'Add PDFs'}</button>
        {mergeQueue.length>0 && <button className="merge-clear" onClick={()=>setMergeQueue([])}>Clear all</button>}
        <span>{mergeQueue.length} file{mergeQueue.length===1?'':'s'} staged</span>
      </div>
      {mergeQueue.length===0 ? <div className="merge-empty"><Files/><b>No PDFs staged yet</b><span>Select PDFs from one location. Then click “Add more PDFs” to continue selecting from another location.</span></div> : <div className="merge-list">
        {mergeQueue.map((item,i)=><div className="merge-item" key={item.id}>
          <div className="merge-order">{i+1}</div>
          <div className="merge-file"><b title={item.file.name}>{item.file.name}</b><span>{(item.file.size/1024/1024).toFixed(2)} MB</span></div>
          <div className="merge-item-actions"><button disabled={i===0} onClick={()=>moveMergeItem(i,-1)} title="Move up">↑</button><button disabled={i===mergeQueue.length-1} onClick={()=>moveMergeItem(i,1)} title="Move down">↓</button><button className="remove" onClick={()=>removeMergeItem(item.id)} title="Remove"><Trash2/></button></div>
        </div>)}
      </div>}
      <div className="merge-name-row">
        <label htmlFor="merge-output-name">Merged PDF name</label>
        <input id="merge-output-name" value={mergeOutputName} onChange={e=>setMergeOutputName(e.target.value)} placeholder="merged.pdf"/>
      </div>
      <div className="merge-hint">You can close this window and return later. The staged PDFs remain available while this browser tab stays open.</div>
      <div className="modal-actions merge-actions"><button onClick={()=>setMergeOpen(false)}>Keep staged & close</button><button className="primary merge-submit" disabled={mergeQueue.length<2||busy} onClick={mergeStagedFiles}><Files/>{busy?'Merging…':`Merge ${mergeQueue.length>=2?`${mergeQueue.length} PDFs`:'PDFs'}`}</button></div>
    </div></div>}

    {signatureOpen && <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&setSignatureOpen(false)}><div className="modal">
      <div className="modal-head"><div><h2>Add signature</h2><p>Draw, type, upload, or reuse your saved signature.</p></div><button onClick={()=>setSignatureOpen(false)}><X/></button></div>
      <div className="tabs"><button className={signatureTab==='draw'?'active':''} onClick={()=>setSignatureTab('draw')}>Draw</button><button className={signatureTab==='type'?'active':''} onClick={()=>setSignatureTab('type')}>Type</button><button className={signatureTab==='upload'?'active':''} onClick={()=>setSignatureTab('upload')}>Upload</button>{savedSignature&&<button className={signatureTab==='saved'?'active':''} onClick={()=>setSignatureTab('saved')}>Saved</button>}</div>
      {signatureTab==='draw' && <div><canvas ref={signatureCanvasRef} className="signature-pad" width="900" height="260" onPointerDown={signaturePointerDown} onPointerMove={signaturePointerMove} onPointerUp={signaturePointerUp} onPointerLeave={signaturePointerUp}/><div className="modal-actions"><button onClick={clearSignatureCanvas}>Clear</button><button className="primary" onClick={useDrawnSignature}>Use signature</button></div></div>}
      {signatureTab==='type' && <div className="type-signature"><input autoFocus value={typedSignature} onChange={e=>setTypedSignature(e.target.value)} placeholder="Type your name"/><div className="signature-preview">{typedSignature||'Your signature'}</div><button className="primary" onClick={useTypedSignature}>Use signature</button></div>}
      {signatureTab==='upload' && <label className="upload-box"><Upload/><b>Upload PNG or JPG signature</b><span>Transparent PNG works best.</span><input hidden type="file" accept="image/png,image/jpeg" onChange={uploadSignature}/></label>}
      {signatureTab==='saved' && savedSignature && <div className="saved-signature"><img src={savedSignature}/><button className="primary" onClick={()=>addSignatureData(savedSignature)}>Use saved signature</button></div>}
    </div></div>}
  </div>
}
