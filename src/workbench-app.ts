export function workbenchHtml(nonce: string): string {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Seekah 本機工作台</title>
  <style nonce="${nonce}">
    :root{color-scheme:light dark;--bg:#f5f7fb;--panel:#fff;--text:#172033;--muted:#667085;--line:#d7dce5;--accent:#3157d5;--danger:#b42318;--ok:#067647} @media(prefers-color-scheme:dark){:root{--bg:#111827;--panel:#1f2937;--text:#f3f4f6;--muted:#a8b0bd;--line:#425066;--accent:#7595ff;--danger:#ff8a80;--ok:#6ce9a6}}
    *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 ui-sans-serif,system-ui,sans-serif} main{max-width:1180px;margin:auto;padding:18px} h1{font-size:22px;margin:0} h2{font-size:17px;margin:0 0 10px}.subtitle,.meta{color:var(--muted)}.subtitle{margin:3px 0 16px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px;min-width:0}.wide{grid-column:1/-1}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.row>*{min-width:0}input,select,textarea,button{font:inherit;color:inherit}input,select,textarea{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:9px}input[type=search],input[type=text],input[type=password]{flex:1 1 180px}textarea{width:100%;min-height:85px;resize:vertical}button{border:1px solid var(--line);border-radius:8px;background:var(--panel);padding:8px 11px;cursor:pointer}button.primary{background:var(--accent);border-color:var(--accent);color:white}button.danger{color:var(--danger)}button:disabled{opacity:.48;cursor:not-allowed}.status{min-height:22px;margin:8px 0;color:var(--muted)}.status.error{color:var(--danger)}.status.ok{color:var(--ok)}.list{display:grid;gap:7px;max-height:330px;overflow:auto}.item{display:grid;grid-template-columns:auto 1fr auto;gap:9px;align-items:start;border:1px solid var(--line);border-radius:9px;padding:9px}.item .title{font-weight:650;overflow-wrap:anywhere}.snippet{white-space:pre-wrap;overflow-wrap:anywhere;color:var(--muted);margin-top:4px}.drop{border:2px dashed var(--line);border-radius:10px;padding:24px;text-align:center;cursor:pointer}.drop.active{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 8%,transparent)}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:360px;overflow:auto;background:var(--bg);border:1px solid var(--line);border-radius:9px;padding:11px}.notice{border-left:4px solid var(--accent);padding:8px 10px;background:var(--bg);margin:9px 0}.confirm{display:flex;gap:8px;align-items:flex-start;margin:10px 0}@media(max-width:800px){.grid{grid-template-columns:1fr}.wide{grid-column:auto}}
  </style>
</head>
<body>
<main>
  <h1>Seekah 本機工作台</h1>
  <p class="subtitle">搜尋索引、拖曳臨時文件、預覽精確上下文；只有你確認後才會送至選定的 AI API。</p>
  <div class="grid">
    <section class="panel">
      <h2>1. 搜尋既有索引</h2>
      <form id="search-form" class="row"><input id="query" type="search" maxlength="1000" placeholder="搜尋文件文字" required><select id="mode"><option value="phrase">完整片語</option><option value="all-terms">全部詞</option></select><button class="primary">搜尋</button></form>
      <div id="search-status" class="status" role="status">讀取本機狀態…</div>
      <div id="results" class="list"></div>
      <div class="row"><button id="prev" type="button" disabled>上一頁</button><span id="page" class="meta">尚未搜尋</span><button id="next" type="button" disabled>下一頁</button><span id="selected-count" class="meta">已選 0 / 20</span></div>
    </section>
    <section class="panel">
      <h2>2. 拖曳本次文件</h2>
      <div id="drop" class="drop" tabindex="0" role="button">把檔案拖到這裡，或點擊選取<br><span class="meta">只在本機解析；關閉工作台後清除，不加入永久索引</span></div>
      <input id="files" type="file" multiple hidden>
      <div id="file-status" class="status" role="status"></div>
      <div id="file-list" class="list"></div>
    </section>
    <section class="panel">
      <h2>3. AI Provider（選填）</h2>
      <div class="notice">ChatGPT 訂閱與 OpenAI API 分開計費；Grok 訂閱與 xAI API 也分開計費。本工具不擷取 cookie 或代登入。</div>
      <div class="row"><select id="provider"><option value="openai">OpenAI API</option><option value="xai">xAI API</option></select><input id="model" type="text" maxlength="128" aria-label="model id"><input id="api-key" type="password" maxlength="4096" autocomplete="off" placeholder="本次工作階段 API Key"><button id="save-key" type="button">套用 Key</button></div>
      <div id="provider-status" class="status"></div>
      <label for="question">問題</label><textarea id="question" maxlength="8000" placeholder="例如：請比較這些文件的驗收條件。"></textarea>
    </section>
    <section class="panel">
      <h2>4. 預覽、複製或送出</h2>
      <div class="row"><button id="preview" class="primary" type="button">產生精確預覽</button><button id="copy" type="button" disabled>複製上下文</button></div>
      <div id="preview-status" class="status">尚未產生預覽。</div>
      <label class="confirm"><input id="confirm" type="checkbox" disabled><span>我已檢查下方內容，並確認公司政策允許把這些文字與問題送到所選 AI Provider。</span></label>
      <button id="ask" class="primary" type="button" disabled>確認並送出</button>
    </section>
    <section class="panel wide"><h2>實際上下文預覽</h2><pre id="context">尚無</pre></section>
    <section class="panel wide"><h2>AI 回答</h2><pre id="answer">尚無</pre></section>
  </div>
</main>
<script nonce="${nonce}">
(()=>{'use strict';
  const token=decodeURIComponent(location.hash.slice(1));
  const selected=new Map(), imported=new Map(); let page=1,pageCount=1,previewId=''; let providers={};
  const $=id=>document.getElementById(id); const query=$('query'),mode=$('mode'),results=$('results'),drop=$('drop'),files=$('files'),fileList=$('file-list'),provider=$('provider'),model=$('model'),question=$('question'),context=$('context'),answer=$('answer'),confirm=$('confirm'),ask=$('ask');
  function status(id,text,kind){const el=$(id);el.textContent=text;el.className='status'+(kind?' '+kind:'')}
  function invalidate(){previewId='';confirm.checked=false;confirm.disabled=true;ask.disabled=true;$('copy').disabled=true;status('preview-status','資料已變更，請重新產生預覽。','')}
  async function api(path,options={}){const headers=new Headers(options.headers||{});headers.set('X-LocalDocSearch-Token',token);if(options.body&&!(options.body instanceof Blob)&&typeof options.body!=='string') {headers.set('content-type','application/json');options.body=JSON.stringify(options.body)}const response=await fetch(path,{...options,headers});let data;try{data=await response.json()}catch{data={error:'本機服務回應格式錯誤。'}}if(!response.ok)throw new Error(data.error||'本機服務拒絕要求。');return data}
  function addText(parent,className,value){const el=document.createElement('div');el.className=className;el.textContent=value;parent.appendChild(el)}
  function updateCount(){const count=selected.size+Array.from(imported.values()).filter(x=>x.selected).length;$('selected-count').textContent='已選 '+count+' / 20'}
  function renderResults(data){results.replaceChildren();page=data.page;pageCount=data.pageCount;$('page').textContent='第 '+page+' / '+pageCount+' 頁，共 '+data.total+' 筆';$('prev').disabled=page<=1;$('next').disabled=page>=pageCount;(data.results||[]).forEach(item=>{const row=document.createElement('label');row.className='item';const box=document.createElement('input');box.type='checkbox';box.checked=selected.has(item.reference);const body=document.createElement('div');addText(body,'title',item.path);addText(body,'meta',[item.reference,item.extension,item.location,item.reason].filter(Boolean).join(' · '));addText(body,'snippet',item.snippet||'');box.addEventListener('change',()=>{if(box.checked&&selected.size+Array.from(imported.values()).filter(x=>x.selected).length>=20){box.checked=false;status('search-status','索引與拖曳文件合計最多選 20 份。','error');return}if(box.checked)selected.set(item.reference,{query:data.query,reference:item.reference});else selected.delete(item.reference);updateCount();invalidate()});row.append(box,body);results.appendChild(row)});updateCount()}
  async function search(target){status('search-status','搜尋中…','');try{const data=await api('/api/search',{method:'POST',body:{query:query.value,mode:mode.value,page:target,pageSize:20}});renderResults(data);status('search-status','搜尋完成；請勾選要加入上下文的文件。','ok')}catch(error){status('search-status',error.message,'error')}}
  function renderFiles(){fileList.replaceChildren();for(const item of imported.values()){const row=document.createElement('div');row.className='item';const box=document.createElement('input');box.type='checkbox';box.checked=item.selected;box.disabled=item.status!=='indexed';box.addEventListener('change',()=>{const total=selected.size+Array.from(imported.values()).filter(x=>x.selected).length;if(box.checked&&total>=20){box.checked=false;status('file-status','索引與拖曳文件合計最多選 20 份。','error');return}item.selected=box.checked;updateCount();invalidate()});const body=document.createElement('div');addText(body,'title',item.filename);addText(body,'meta',item.extension+' · '+item.sizeBytes+' bytes · '+item.status);if(item.errorMessage)addText(body,'snippet',item.errorMessage);const remove=document.createElement('button');remove.type='button';remove.className='danger';remove.textContent='移除';remove.addEventListener('click',async()=>{try{await api('/api/files/'+encodeURIComponent(item.id),{method:'DELETE'});imported.delete(item.id);renderFiles();invalidate()}catch(error){status('file-status',error.message,'error')}});row.append(box,body,remove);fileList.appendChild(row)}updateCount()}
  async function upload(list){for(const file of list){status('file-status','解析 '+file.name+'…','');try{const data=await api('/api/files',{method:'POST',headers:{'X-File-Name':encodeURIComponent(file.name),'content-type':'application/octet-stream'},body:file});const total=selected.size+Array.from(imported.values()).filter(x=>x.selected).length;data.selected=data.status==='indexed'&&total<20;imported.set(data.id,data);renderFiles();status('file-status',file.name+' 已在本機解析。',data.status==='indexed'?'ok':'error')}catch(error){status('file-status',file.name+'：'+error.message,'error')}}invalidate()}
  function updateProvider(){const state=providers[provider.value]||{};model.value=state.defaultModel||'';status('provider-status',state.configured?'已設定（'+(state.source==='environment'?'環境變數':'本次工作階段')+'）。':'尚未設定 API Key。',state.configured?'ok':'');invalidate()}
  function requestBody(){return{provider:provider.value,model:model.value.trim(),question:question.value.trim(),mode:mode.value,selections:Array.from(selected.values()),fileIds:Array.from(imported.values()).filter(x=>x.selected).map(x=>x.id)}}
  async function makePreview(){status('preview-status','正在重新驗證與建立預覽…','');try{const data=await api('/api/preview',{method:'POST',body:requestBody()});previewId=data.previewId;context.textContent=data.context;status('preview-status','預覽完成：'+data.bytes+' bytes'+(data.truncated?'（拖曳內容已截短）':''),'ok');confirm.disabled=false;$('copy').disabled=false;ask.disabled=!confirm.checked}catch(error){context.textContent='尚無';status('preview-status',error.message,'error')}}
  $('search-form').addEventListener('submit',event=>{event.preventDefault();void search(1)});$('prev').addEventListener('click',()=>void search(page-1));$('next').addEventListener('click',()=>void search(page+1));mode.addEventListener('change',()=>{selected.clear();results.replaceChildren();updateCount();invalidate()});
  drop.addEventListener('click',()=>files.click());drop.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();files.click()}});files.addEventListener('change',()=>{void upload(files.files);files.value=''});for(const name of ['dragenter','dragover'])drop.addEventListener(name,event=>{event.preventDefault();drop.classList.add('active')});for(const name of ['dragleave','drop'])drop.addEventListener(name,event=>{event.preventDefault();drop.classList.remove('active')});drop.addEventListener('drop',event=>void upload(event.dataTransfer.files));
  provider.addEventListener('change',updateProvider);for(const el of [model,question])el.addEventListener('input',invalidate);$('save-key').addEventListener('click',async()=>{const key=$('api-key');try{const data=await api('/api/providers',{method:'POST',body:{provider:provider.value,key:key.value}});key.value='';providers=data.providers;updateProvider();status('provider-status','API Key 已套用；只保留在本次本機程序記憶體。','ok')}catch(error){key.value='';status('provider-status',error.message,'error')}});
  $('preview').addEventListener('click',()=>void makePreview());$('copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(context.textContent);status('preview-status','已複製目前預覽到本機剪貼簿。','ok')}catch{status('preview-status','瀏覽器拒絕剪貼簿權限；請手動複製。','error')}});confirm.addEventListener('change',()=>{ask.disabled=!confirm.checked||!previewId});ask.addEventListener('click',async()=>{ask.disabled=true;answer.textContent='等待 AI API…';try{const data=await api('/api/ask',{method:'POST',body:{...requestBody(),previewId,confirmed:confirm.checked}});answer.textContent=data.answer;status('preview-status','AI 回答完成。','ok')}catch(error){answer.textContent='尚無';status('preview-status',error.message,'error')}finally{ask.disabled=!confirm.checked||!previewId}});
  api('/api/state').then(data=>{providers=data.providers;updateProvider();status('search-status',data.indexAvailable?'本機索引可用。':'尚無索引；仍可拖曳文件。',data.indexAvailable?'ok':'')}).catch(error=>status('search-status',error.message,'error'));
})();
</script>
</body>
</html>`;
}
