import React, { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { PDFDocument, degrees, rgb, StandardFonts } from 'pdf-lib'
import {
  Upload, Download, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCw,
  Files, Scissors, FileOutput, Type, Highlighter, PenLine, Eraser, Search,
  Home, Wrench, Save, ImagePlus, Trash2, Plus, X
} from 'lucide-react'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

const downloadBytes = (bytes, name, type='application/pdf') => {
  const blob = new Blob([bytes], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function App() {
  const canvasRef = useRef(null)
  const overlayRef = useRef(null)
  const [file, setFile] = useState(null)
  const [bytes, setBytes] = useState(null)
  const [pdf, setPdf] = useState(null)
  const [page, setPage] = useState(1)
  const [scale, setScale] = useState(1.25)
  const [tool, setTool] = useState('select')
  const [notes, setNotes] = useState({})
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState([])
  const [status, setStatus] = useState('Open a PDF to begin. Your file stays in your browser.')
  const [busy, setBusy] = useState(false)

  const openBytes = async (arr, name='document.pdf') => {
    setBusy(true)
    try {
      const copy = arr instanceof Uint8Array ? arr.slice() : new Uint8Array(arr)
      const doc = await pdfjsLib.getDocument({ data: copy.slice() }).promise
      setBytes(copy); setPdf(doc); setPage(1); setNotes({})
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
      const overlay = overlayRef.current
      canvas.width = viewport.width; canvas.height = viewport.height
      canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`
      overlay.width = viewport.width; overlay.height = viewport.height
      overlay.style.width = `${viewport.width}px`; overlay.style.height = `${viewport.height}px`
      await p.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
      redrawOverlay()
    })()
    return () => { cancelled = true }
  }, [pdf, page, scale])

  useEffect(() => { redrawOverlay() }, [notes, page])

  const redrawOverlay = () => {
    const c = overlayRef.current; if (!c) return
    const ctx = c.getContext('2d'); ctx.clearRect(0,0,c.width,c.height)
    const list = notes[page] || []
    for (const n of list) {
      if (n.kind === 'stroke') {
        ctx.lineWidth = n.width || 3; ctx.strokeStyle = n.color || '#e11d48'; ctx.lineCap='round'
        ctx.beginPath(); n.points.forEach((pt,i)=> i?ctx.lineTo(pt.x,pt.y):ctx.moveTo(pt.x,pt.y)); ctx.stroke()
      } else if (n.kind === 'highlight') {
        ctx.fillStyle='rgba(250,204,21,.35)'; ctx.fillRect(n.x,n.y,n.w,n.h)
      } else if (n.kind === 'text') {
        ctx.font='18px sans-serif'; ctx.fillStyle='#111827'; ctx.fillText(n.text,n.x,n.y)
      }
    }
  }

  const pointer = useRef(null)
  const pos = e => { const r=overlayRef.current.getBoundingClientRect(); return {x:e.clientX-r.left,y:e.clientY-r.top} }
  const down = e => {
    if (!pdf || tool==='select') return
    const p=pos(e); pointer.current={start:p, points:[p]}; overlayRef.current.setPointerCapture(e.pointerId)
  }
  const move = e => {
    if (!pointer.current || tool!=='draw') return
    pointer.current.points.push(pos(e))
    const temp={...notes,[page]:[...(notes[page]||[]),{kind:'stroke',points:pointer.current.points}]}
    const old=notes; setNotes(temp); setTimeout(()=>setNotes(old),0)
  }
  const up = e => {
    const cur=pointer.current; if(!cur) return
    const p=pos(e); let item=null
    if(tool==='draw') item={kind:'stroke',points:[...cur.points,p]}
    if(tool==='highlight') item={kind:'highlight',x:Math.min(cur.start.x,p.x),y:Math.min(cur.start.y,p.y),w:Math.abs(p.x-cur.start.x),h:Math.abs(p.y-cur.start.y)}
    if(tool==='text') { const text=prompt('Text to add:'); if(text) item={kind:'text',x:p.x,y:p.y,text} }
    if(item) setNotes(n=>({...n,[page]:[...(n[page]||[]),item]}))
    pointer.current=null
  }

  const saveAnnotated = async () => {
    if(!bytes) return
    setBusy(true)
    try {
      const doc=await PDFDocument.load(bytes)
      const font=await doc.embedFont(StandardFonts.Helvetica)
      for(const [pg,items] of Object.entries(notes)) {
        const p=doc.getPage(Number(pg)-1), {width,height}=p.getSize()
        const renderedW=overlayRef.current?.width || width
        const sx=width/renderedW, sy=height/(overlayRef.current?.height || height)
        for(const n of items){
          if(n.kind==='text') p.drawText(n.text,{x:n.x*sx,y:height-n.y*sy,size:14,font,color:rgb(.07,.09,.15)})
          if(n.kind==='highlight') p.drawRectangle({x:n.x*sx,y:height-(n.y+n.h)*sy,width:n.w*sx,height:n.h*sy,color:rgb(1,.85,.1),opacity:.35})
          if(n.kind==='stroke') for(let i=1;i<n.points.length;i++){const a=n.points[i-1],b=n.points[i];p.drawLine({start:{x:a.x*sx,y:height-a.y*sy},end:{x:b.x*sx,y:height-b.y*sy},thickness:2,color:rgb(.88,.08,.3)})}
        }
      }
      downloadBytes(await doc.save(), `edited-${file?.name || 'document.pdf'}`)
      setStatus('Saved an edited copy. Your original file was not changed.')
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
    const doc=await PDFDocument.load(bytes); doc.removePage(page-1); const out=await doc.save(); await openBytes(out,file.name); setPage(Math.min(page,pdf.numPages-1))
  }

  const mergeFiles = async e => {
    const fs=[...e.target.files]; if(!fs.length)return
    setBusy(true)
    try{
      const out=await PDFDocument.create()
      for(const f of fs){const src=await PDFDocument.load(await f.arrayBuffer()); const pages=await out.copyPages(src,src.getPageIndices()); pages.forEach(p=>out.addPage(p))}
      downloadBytes(await out.save(),'merged.pdf'); setStatus(`Merged ${fs.length} PDF files.`)
    }catch(err){setStatus(`Merge failed: ${err.message}`)}finally{setBusy(false);e.target.value=''}
  }

  const imageToPdf = async e => {
    const fs=[...e.target.files]; if(!fs.length)return
    setBusy(true)
    try{
      const out=await PDFDocument.create()
      for(const f of fs){const data=new Uint8Array(await f.arrayBuffer()); let img
        if(f.type==='image/png') img=await out.embedPng(data); else img=await out.embedJpg(data)
        const dims=img.scale(1); const maxW=595,maxH=842,ratio=Math.min(maxW/dims.width,maxH/dims.height,1)
        const p=out.addPage([maxW,maxH]); const w=dims.width*ratio,h=dims.height*ratio; p.drawImage(img,{x:(maxW-w)/2,y:(maxH-h)/2,width:w,height:h})
      }
      downloadBytes(await out.save(),'images.pdf');setStatus(`Converted ${fs.length} image${fs.length>1?'s':''} to PDF.`)
    }catch(err){setStatus(`Image conversion failed: ${err.message}`)}finally{setBusy(false);e.target.value=''}
  }

  const search = async () => {
    if(!pdf || !query.trim()) return
    setBusy(true); const found=[]
    for(let i=1;i<=pdf.numPages;i++){const p=await pdf.getPage(i), tc=await p.getTextContent(); const text=tc.items.map(x=>x.str).join(' '); if(text.toLowerCase().includes(query.toLowerCase())) found.push(i)}
    setMatches(found); setStatus(found.length?`Found “${query}” on page${found.length>1?'s':''} ${found.join(', ')}.`:`No matches for “${query}”.`); setBusy(false)
  }

  return <div className="app">
    <header><div className="brand"><div className="logo">PDF</div><div><b>PDF Workbench</b><span>Local-first • GitHub-ready</span></div></div><div className="status">{busy?'Working…':status}</div><label className="primary"><Upload size={17}/> Open PDF<input hidden type="file" accept="application/pdf" onChange={onFile}/></label></header>
    <aside>
      <button className="nav active"><Home/>Workspace</button>
      <div className="section">ANNOTATE</div>
      <button className={tool==='select'?'active':''} onClick={()=>setTool('select')}><Search/>Select / Read</button>
      <button className={tool==='highlight'?'active':''} onClick={()=>setTool('highlight')}><Highlighter/>Highlight</button>
      <button className={tool==='draw'?'active':''} onClick={()=>setTool('draw')}><PenLine/>Draw</button>
      <button className={tool==='text'?'active':''} onClick={()=>setTool('text')}><Type/>Add text</button>
      <button onClick={()=>setNotes(n=>({...n,[page]:[]}))}><Eraser/>Clear page marks</button>
      <div className="section">PAGE TOOLS</div>
      <button onClick={rotatePage} disabled={!pdf}><RotateCw/>Rotate page</button>
      <button onClick={extractPage} disabled={!pdf}><FileOutput/>Extract page</button>
      <button onClick={deletePage} disabled={!pdf || pdf?.numPages<=1}><Trash2/>Delete page</button>
      <div className="section">PDF TOOLS</div>
      <label className="side-label"><Files/>Merge PDFs<input hidden multiple type="file" accept="application/pdf" onChange={mergeFiles}/></label>
      <label className="side-label"><ImagePlus/>Images → PDF<input hidden multiple type="file" accept="image/png,image/jpeg" onChange={imageToPdf}/></label>
    </aside>
    <main>
      <div className="toolbar">
        <div className="group"><button disabled={!pdf||page<=1} onClick={()=>setPage(p=>p-1)}><ChevronLeft/></button><span>{pdf?`${page} / ${pdf.numPages}`:'— / —'}</span><button disabled={!pdf||page>=pdf.numPages} onClick={()=>setPage(p=>p+1)}><ChevronRight/></button></div>
        <div className="group"><button onClick={()=>setScale(s=>Math.max(.5,s-.15))}><ZoomOut/></button><span>{Math.round(scale*100)}%</span><button onClick={()=>setScale(s=>Math.min(3,s+.15))}><ZoomIn/></button></div>
        <div className="search"><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==='Enter'&&search()} placeholder="Search text…"/><button onClick={search}><Search/></button></div>
        <button className="save" disabled={!pdf} onClick={saveAnnotated}><Download/>Export edited PDF</button>
      </div>
      <div className="stage">
        {!pdf && <div className="empty"><div className="empty-icon"><Upload size={34}/></div><h1>Open a PDF</h1><p>Read, annotate, rotate, extract, merge and export PDFs entirely in your browser.</p><label className="primary big"><Plus/>Choose PDF<input hidden type="file" accept="application/pdf" onChange={onFile}/></label><div className="privacy">No server upload is required for the core tools.</div></div>}
        {pdf && <div className="page-wrap"><canvas ref={canvasRef}/><canvas ref={overlayRef} className={`overlay tool-${tool}`} onPointerDown={down} onPointerMove={move} onPointerUp={up}/></div>}
      </div>
    </main>
  </div>
}
