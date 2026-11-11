(() => {
  'use strict';

  const LS_KEY = 'moss.apiKey';
  const LS_BASE = 'moss.baseUrl';

  const $ = (id) => document.getElementById(id);
  const apiKeyInput = $('apiKey');
  const baseUrlInput = $('baseUrl');
  const healthEl = $('health');
  const ioJson = $('ioJson');
  const ioMeta = $('ioMeta');

  let inspectorPane = 'request';
  let lastRequestText = '尚未发送请求。';
  let lastResponseText = '尚未收到响应。';
  let lastMeta = '还没有请求';
  let chatAbort = null;
  const chatMessages = [];

  function redact(text) {
    if (text == null) return '';
    return String(text).replace(/sk-[A-Za-z0-9._-]{8,}/g, (m) => m.slice(0, 5) + '…' + m.slice(-4));
  }

  function pretty(value) {
    if (typeof value === 'string') {
      try {
        return JSON.stringify(JSON.parse(value), null, 2);
      } catch {
        return value;
      }
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  function showIO({ method, path, body, status, ms, response }) {
    lastRequestText = pretty({ method, path, body: body ?? null });
    lastResponseText = pretty(response);
    lastMeta = [method, path, status != null ? `HTTP ${status}` : '', ms != null ? `${ms} ms` : '']
      .filter(Boolean)
      .join('  ·  ');
    ioMeta.textContent = lastMeta;
    ioJson.textContent = redact(inspectorPane === 'request' ? lastRequestText : lastResponseText);
  }

  function flashCopy(ok) {
    const btn = $('copyJson');
    const prev = btn.textContent;
    btn.textContent = ok ? '已复制' : '复制失败';
    setTimeout(() => {
      btn.textContent = prev;
    }, 1200);
  }

  function loadSettings() {
    apiKeyInput.value = localStorage.getItem(LS_KEY) || '';
    baseUrlInput.value = localStorage.getItem(LS_BASE) || '';
  }

  function saveSettings() {
    localStorage.setItem(LS_KEY, apiKeyInput.value.trim());
    localStorage.setItem(LS_BASE, baseUrlInput.value.trim());
    healthEl.textContent = '设置已保存到 localStorage';
    probeHealth();
  }

  function baseUrl() {
    return (baseUrlInput.value || '').trim().replace(/\/+$/, '');
  }

  function apiUrl(pathAndQuery) {
    const p = pathAndQuery.startsWith('/') ? pathAndQuery : '/' + pathAndQuery;
    const b = baseUrl();
    return b ? b + p : p;
  }

  function authHeaders() {
    const key = apiKeyInput.value.trim();
    return key ? { Authorization: 'Bearer ' + key } : {};
  }

  async function probeHealth() {
    const b = baseUrl();
    // Direct official origin cannot work in the browser (CORS 403).
    if (/api\.mosi\.cn$/i.test(b.replace(/^https?:\/\//, '').split('/')[0])) {
      healthEl.textContent = '直连官方 API 会被 CORS 拦截，请改用本地代理（Base URL 留空）';
      healthEl.className = 'health bad';
      return;
    }
    const url = b ? b + '/health' : '/health';
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const keyHint = data.hasEnvKey ? '代理已配置环境变量密钥' : (apiKeyInput.value.trim() ? '将使用页面中的密钥' : '尚未提供密钥');
      healthEl.textContent = `代理正常 · 上游 ${data.upstream || '?'} · ${keyHint}`;
      healthEl.className = 'health ok';
    } catch {
      if (!b) {
        healthEl.textContent = '未检测到本地代理。请运行 node server.js 后打开 http://127.0.0.1:8787';
      } else {
        healthEl.textContent = '无法连接 Base URL 上的 /health，若这是自定义网关可忽略';
      }
      healthEl.className = 'health bad';
    }
  }

  async function readErrorBody(res) {
    const text = await res.text();
    try {
      return { raw: text, json: JSON.parse(text) };
    } catch {
      return { raw: text, json: null };
    }
  }

  function errorMessage(status, parsed) {
    const err = parsed && (parsed.error || parsed);
    const code = err && (err.code || err.type);
    const msg = err && err.message;
    const bits = [`HTTP ${status}`];
    if (code) bits.push(String(code));
    if (msg) bits.push(String(msg));
    if (status === 402) bits.push('积分不足（该接口为付费能力）');
    return bits.join(' · ');
  }

  async function apiFetch(path, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const started = performance.now();
    const headers = { ...authHeaders(), ...(options.headers || {}) };
    const displayBody = options.displayBody !== undefined ? options.displayBody : options.json || null;

    showIO({ method, path, body: displayBody, status: null, ms: null, response: '请求中…' });

    const init = { method, headers };
    if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.json);
    } else if (options.body !== undefined) {
      init.body = options.body;
    }

    let res;
    try {
      res = await fetch(apiUrl(path), init);
    } catch (err) {
      const ms = Math.round(performance.now() - started);
      const response = { error: { type: 'network_error', message: String(err && err.message || err) } };
      showIO({ method, path, body: displayBody, status: 0, ms, response });
      throw Object.assign(new Error('网络错误: ' + (err && err.message || err)), { parsed: response, status: 0 });
    }

    const ms = Math.round(performance.now() - started);
    if (options.raw) {
      showIO({
        method,
        path,
        body: displayBody,
        status: res.status,
        ms,
        response: {
          status: res.status,
          contentType: res.headers.get('content-type'),
          note: options.rawNote || '二进制或流式响应，详见页面结果区',
        },
      });
      return { res, ms, started };
    }

    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    showIO({ method, path, body: displayBody, status: res.status, ms, response: json });
    if (!res.ok) {
      throw Object.assign(new Error(errorMessage(res.status, typeof json === 'object' ? json : null)), {
        status: res.status,
        parsed: json,
      });
    }
    return { res, json, text, ms, started };
  }

  /* ---------------- tabs ---------------- */
  function switchTab(name) {
    document.querySelectorAll('.tab').forEach((tab) => {
      const on = tab.dataset.tab === name;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('.panel').forEach((panel) => {
      const on = panel.id === 'panel-' + name;
      panel.classList.toggle('is-active', on);
      panel.hidden = !on;
    });
    if (name === 'tts' && !$('ttsVoice').value) {
      loadVoices().catch(() => {});
    }
    if (name === 'asr') syncAsrDiarize();
  }

  /* ---------------- chat ---------------- */
  function renderThread() {
    const root = $('chatThread');
    root.innerHTML = '';
    if (!chatMessages.length) {
      const empty = document.createElement('div');
      empty.className = 'metrics';
      empty.textContent = '从下面输入一句话开始。nex-n2.6 目前限时免费。';
      root.appendChild(empty);
      return;
    }
    for (const m of chatMessages) {
      const el = document.createElement('div');
      el.className = 'msg ' + m.role + (m.error ? ' error' : '');
      const role = document.createElement('span');
      role.className = 'role';
      role.textContent = m.role === 'user' ? '你' : '模型';
      el.appendChild(role);
      if (m.reasoning) {
        const think = document.createElement('div');
        think.className = 'think';
        think.textContent = m.reasoning;
        el.appendChild(think);
      }
      el.appendChild(document.createTextNode(m.content || (m.pending ? '…' : '')));
      root.appendChild(el);
    }
    root.scrollTop = root.scrollHeight;
  }

  function setChatMetrics({ latency, ttft, usage, model, streamed }) {
    const parts = [];
    if (model) parts.push(`模型 <b>${model}</b>`);
    if (latency != null) parts.push(`总延迟 <b>${latency} ms</b>`);
    if (ttft != null) parts.push(`首 token <b>${ttft} ms</b>`);
    else if (streamed) parts.push('首 token <b>—</b>');
    if (usage) {
      const p = usage.prompt_tokens;
      const c = usage.completion_tokens;
      const t = usage.total_tokens;
      const r =
        (usage.completion_tokens_details && usage.completion_tokens_details.reasoning_tokens) ||
        usage.reasoning_tokens;
      const bits = [];
      if (p != null) bits.push(`prompt ${p}`);
      if (c != null) bits.push(`completion ${c}`);
      if (t != null) bits.push(`total ${t}`);
      if (r) bits.push(`reasoning ${r}`);
      if (bits.length) parts.push(`用量 <b>${bits.join(' / ')}</b>`);
    }
    $('chatMetrics').innerHTML = parts.join('<span>·</span>') || '尚未发送请求';
  }

  function buildChatPayload() {
    const model = $('chatModel').value;
    const system = $('chatSystem').value.trim();
    const temperature = Number($('chatTemp').value);
    const maxTokens = Number($('chatMaxTokens').value) || 1024;
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    for (const m of chatMessages) {
      if (m.role === 'assistant' && m.error) continue;
      if (m.pending) continue;
      messages.push({ role: m.role, content: m.content || '' });
    }
    return {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    };
  }

  async function sendChat(ev) {
    ev.preventDefault();
    const text = $('chatInput').value.trim();
    if (!text) return;
    if (chatAbort) {
      chatAbort.abort();
      chatAbort = null;
    }
    $('chatInput').value = '';
    chatMessages.push({ role: 'user', content: text });
    const assistant = { role: 'assistant', content: '', reasoning: '', pending: true };
    chatMessages.push(assistant);
    renderThread();

    const streamed = $('chatStream').checked;
    const payload = buildChatPayload();
    if (streamed) {
      payload.stream = true;
      payload.stream_options = { include_usage: true };
    }

    $('chatSend').disabled = true;
    const ac = new AbortController();
    chatAbort = ac;
    const started = performance.now();
    let ttft = null;
    let usage = null;
    let model = payload.model;

    const markFirst = () => {
      if (ttft == null) ttft = Math.round(performance.now() - started);
    };

    try {
      if (!streamed) {
        const { json, ms } = await apiFetch('/v1/chat/completions', { method: 'POST', json: payload });
        const choice = (json && json.choices && json.choices[0]) || {};
        const msg = choice.message || {};
        assistant.content = msg.content || '';
        assistant.reasoning = msg.reasoning_content || '';
        assistant.pending = false;
        usage = json.usage || null;
        model = (json && json.model) || model;
        setChatMetrics({ latency: ms, ttft: ms, usage, model, streamed: false });
        renderThread();
        return;
      }

      showIO({ method: 'POST', path: '/v1/chat/completions', body: payload, status: null, ms: null, response: '流式输出中…' });
      const res = await fetch(apiUrl('/v1/chat/completions'), {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ac.signal,
      });

      if (!res.ok) {
        const { json, raw } = await readErrorBody(res);
        const ms = Math.round(performance.now() - started);
        showIO({ method: 'POST', path: '/v1/chat/completions', body: payload, status: res.status, ms, response: json || raw });
        throw Object.assign(new Error(errorMessage(res.status, json)), { parsed: json });
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const chunks = [];
      let doneSeen = false;

      const handleData = (dataLine) => {
        const payloadText = dataLine.replace(/^data:\s?/, '').trim();
        if (!payloadText) return;
        if (payloadText === '[DONE]') {
          doneSeen = true;
          return;
        }
        let ev;
        try {
          ev = JSON.parse(payloadText);
        } catch {
          return;
        }
        chunks.push(ev);
        if (ev.model) model = ev.model;
        if (ev.usage) usage = ev.usage;
        for (const choice of ev.choices || []) {
          const delta = choice.delta || {};
          if (delta.reasoning_content) {
            assistant.reasoning = (assistant.reasoning || '') + delta.reasoning_content;
            markFirst();
          }
          if (delta.content) {
            assistant.content += delta.content;
            markFirst();
          }
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split(/\r?\n/);
        buffer = parts.pop() || '';
        for (const line of parts) {
          if (line.startsWith('data:')) handleData(line);
        }
        renderThread();
        setChatMetrics({
          latency: Math.round(performance.now() - started),
          ttft,
          usage,
          model,
          streamed: true,
        });
      }
      if (buffer.startsWith('data:')) handleData(buffer);

      const ms = Math.round(performance.now() - started);
      assistant.pending = false;
      showIO({
        method: 'POST',
        path: '/v1/chat/completions',
        body: payload,
        status: res.status,
        ms,
        response: { streamed: true, done: doneSeen, usage, model, text: assistant.content, events: chunks.length },
      });
      setChatMetrics({ latency: ms, ttft, usage, model, streamed: true });
      renderThread();
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      assistant.pending = false;
      assistant.error = true;
      assistant.content = String(err && err.message || err);
      renderThread();
      setChatMetrics({ latency: Math.round(performance.now() - started), ttft, usage, model, streamed });
    } finally {
      $('chatSend').disabled = false;
      if (chatAbort === ac) chatAbort = null;
    }
  }

  /* ---------------- TTS ---------------- */
  async function loadVoices() {
    const sel = $('ttsVoice');
    sel.disabled = true;
    try {
      const all = [];
      let after = '';
      for (let i = 0; i < 10; i++) {
        const q = new URLSearchParams({ limit: '150' });
        if (after) q.set('after', after);
        const { json } = await apiFetch('/v1/audio/voices?' + q.toString());
        const data = (json && json.data) || [];
        all.push(...data);
        if (!json || !json.has_more || !json.next_cursor) break;
        after = json.next_cursor;
      }
      sel.innerHTML = '';
      if (!all.length) {
        sel.innerHTML = '<option value="">（当前账号没有可用音色）</option>';
        return;
      }
      for (const v of all) {
        const opt = document.createElement('option');
        opt.value = v.id;
        const name = v.name || '未命名音色';
        const tail = String(v.id || '').slice(-4);
        opt.textContent = `${name}  ·  …${tail}`;
        sel.appendChild(opt);
      }
    } catch (err) {
      sel.innerHTML = `<option value="">加载失败：${redact(err.message)}</option>`;
    } finally {
      sel.disabled = false;
    }
  }

  async function runTts() {
    const result = $('ttsResult');
    const input = $('ttsInput').value.trim();
    const voice_id = $('ttsVoice').value;
    if (!input) {
      result.innerHTML = '<div class="error">请填写要合成的文本。</div>';
      return;
    }
    if (!voice_id) {
      result.innerHTML = '<div class="error">请先刷新并选择一个音色。</div>';
      return;
    }
    const body = {
      model: $('ttsModel').value,
      input,
      voice_id,
      response_format: $('ttsFormat').value,
      delivery_method: 'url',
    };
    $('ttsRun').disabled = true;
    result.textContent = '正在合成…';
    try {
      const { json } = await apiFetch('/v1/audio/speech', { method: 'POST', json: body });
      const url = json && json.url;
      if (!url) {
        result.innerHTML = '<div class="error">响应中没有音频 URL。</div>';
        return;
      }
      result.innerHTML = '';
      const note = document.createElement('div');
      note.textContent = `状态 ${json.status || 'SUCCESS'} · 格式 ${json.response_format || body.response_format}`;
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.src = url;
      audio.autoplay = true;
      result.append(note, audio);
    } catch (err) {
      result.innerHTML = `<div class="error">${redact(err.message)}</div>`;
    } finally {
      $('ttsRun').disabled = false;
    }
  }

  /* ---------------- ASR ---------------- */
  function syncAsrDiarize() {
    const on = $('asrModel').value.includes('diarize');
    $('asrDiarizeWrap').hidden = !on;
  }

  async function runAsr() {
    const result = $('asrResult');
    const file = $('asrFile').files[0];
    const url = $('asrUrl').value.trim();
    if (!file && !url) {
      result.innerHTML = '<div class="error">请上传音频文件，或填写公网 URL。</div>';
      return;
    }
    if (file && url) {
      result.innerHTML = '<div class="error">文件和 URL 只能选一种。</div>';
      return;
    }
    const model = $('asrModel').value;
    $('asrRun').disabled = true;
    result.textContent = '正在转写…';
    try {
      let out;
      if (file) {
        const form = new FormData();
        form.append('model', model);
        form.append('file', file, file.name);
        form.append('response_format', 'json');
        if (model.includes('diarize') && $('asrDiarize').checked) {
          form.append('diarize', 'true');
        }
        out = await apiFetch('/v1/audio/transcriptions', {
          method: 'POST',
          body: form,
          displayBody: { model, file: file.name, size: file.size, response_format: 'json' },
        });
      } else {
        const json = { model, url, response_format: 'json' };
        if (model.includes('diarize') && $('asrDiarize').checked) json.diarize = true;
        out = await apiFetch('/v1/audio/transcriptions', { method: 'POST', json });
      }
      const data = out.json || {};
      const text = data.text || '';
      const segs = data.segments || [];
      let html = `<p>${escapeHtml(text) || '（没有识别文本）'}</p>`;
      if (segs.length) {
        html += '<ol>' + segs.map((s) => {
          const who = s.speaker ? `${s.speaker} ` : '';
          const t = s.start != null ? `${s.start}s–${s.end}s ` : '';
          return `<li><code>${escapeHtml(who + t)}</code>${escapeHtml(s.text || '')}</li>`;
        }).join('') + '</ol>';
      }
      result.innerHTML = html;
    } catch (err) {
      result.innerHTML = `<div class="error">${redact(err.message)}</div>`;
    } finally {
      $('asrRun').disabled = false;
    }
  }

  /* ---------------- VL ---------------- */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  $('vlFile').addEventListener('change', () => {
    const file = $('vlFile').files[0];
    const box = $('vlPreview');
    box.innerHTML = '';
    if (!file) {
      box.hidden = true;
      return;
    }
    const img = document.createElement('img');
    img.alt = file.name;
    img.src = URL.createObjectURL(file);
    box.appendChild(img);
    box.hidden = false;
  });

  function extractVlText(json) {
    const chunks = [];
    for (const item of (json && json.output) || []) {
      for (const c of item.content || []) {
        if (c && (c.type === 'output_text' || c.text)) chunks.push(c.text || '');
      }
    }
    return chunks.join('\n').trim();
  }

  async function runVl() {
    const result = $('vlResult');
    const prompt = $('vlPrompt').value.trim();
    const file = $('vlFile').files[0];
    const url = $('vlUrl').value.trim();
    if (!prompt) {
      result.innerHTML = '<div class="error">请填写提示词。</div>';
      return;
    }
    if (!file && !url) {
      result.innerHTML = '<div class="error">请上传图片，或填写公网图片 URL。</div>';
      return;
    }
    $('vlRun').disabled = true;
    result.textContent = '正在理解…';
    try {
      const content = [{ type: 'input_text', text: prompt }];
      if (file) {
        const form = new FormData();
        form.append('purpose', 'image');
        form.append('file', file, file.name);
        const up = await apiFetch('/v1/files', {
          method: 'POST',
          body: form,
          displayBody: { purpose: 'image', file: file.name, size: file.size },
        });
        const fileId = up.json && (up.json.id || up.json.file_id);
        if (!fileId) throw new Error('上传成功但未返回 file_id');
        content.push({ type: 'input_image', file_id: fileId });
      } else {
        content.push({ type: 'input_image', image_url: url });
      }
      const body = {
        model: $('vlModel').value,
        input: [{ role: 'user', content }],
        max_output_tokens: Number($('vlMaxTokens').value) || 1024,
      };
      const { json } = await apiFetch('/v1/responses', { method: 'POST', json: body });
      const text = extractVlText(json) || '（没有文本输出）';
      const usage = json && json.usage;
      const extra = usage
        ? `<p class="metrics">status <b>${escapeHtml(json.status || '')}</b> · tokens <b>${usage.input_tokens || 0} / ${usage.output_tokens || 0} / ${usage.total_tokens || 0}</b></p>`
        : '';
      result.innerHTML = extra + `<p>${escapeHtml(text)}</p>`;
    } catch (err) {
      result.innerHTML = `<div class="error">${redact(err.message)}</div>`;
    } finally {
      $('vlRun').disabled = false;
    }
  }

  /* ---------------- image gen ---------------- */
  async function runImage() {
    const result = $('imgResult');
    const prompt = $('imgPrompt').value.trim();
    if (!prompt) {
      result.innerHTML = '<div class="error">请填写提示词。</div>';
      return;
    }
    const body = {
      model: $('imgModel').value,
      prompt,
      negative_prompt: $('imgNegative').value.trim() || undefined,
      prompt_enhance: $('imgEnhance').checked,
      size: $('imgSize').value,
      n: 1,
      response_format: 'url',
      output_watermark: { enabled: true },
    };
    $('imgRun').disabled = true;
    result.textContent = '正在生成（可能需要较长时间）…';
    try {
      const { json } = await apiFetch('/v1/images/generations', { method: 'POST', json: body });
      const url = json && json.data && json.data[0] && json.data[0].url;
      if (!url) {
        result.innerHTML = '<div class="error">响应中没有图片 URL。</div>';
        return;
      }
      const img = document.createElement('img');
      img.alt = '生成结果';
      img.src = url;
      result.innerHTML = '';
      result.appendChild(img);
    } catch (err) {
      result.innerHTML = `<div class="error">${redact(err.message)}</div>`;
    } finally {
      $('imgRun').disabled = false;
    }
  }

  /* ---------------- wire up ---------------- */
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });
  document.querySelectorAll('.seg').forEach((btn) => {
    btn.addEventListener('click', () => {
      inspectorPane = btn.dataset.pane;
      document.querySelectorAll('.seg').forEach((b) => b.classList.toggle('is-active', b === btn));
      ioJson.textContent = redact(inspectorPane === 'request' ? lastRequestText : lastResponseText);
    });
  });
  $('copyJson').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(ioJson.textContent || '');
      flashCopy(true);
    } catch {
      flashCopy(false);
    }
  });
  $('saveSettings').addEventListener('click', saveSettings);
  $('toggleKey').addEventListener('click', () => {
    const hide = apiKeyInput.type === 'password';
    apiKeyInput.type = hide ? 'text' : 'password';
    $('toggleKey').textContent = hide ? '隐藏' : '显示';
  });
  $('chatTemp').addEventListener('input', () => {
    $('tempVal').textContent = $('chatTemp').value;
  });
  $('chatForm').addEventListener('submit', sendChat);
  $('chatInput').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      $('chatForm').requestSubmit();
    }
  });
  $('chatClear').addEventListener('click', () => {
    if (chatAbort) chatAbort.abort();
    chatMessages.length = 0;
    renderThread();
    $('chatMetrics').textContent = '尚未发送请求';
  });
  $('ttsLoadVoices').addEventListener('click', () => loadVoices());
  $('ttsRun').addEventListener('click', runTts);
  $('asrModel').addEventListener('change', syncAsrDiarize);
  $('asrRun').addEventListener('click', runAsr);
  $('vlRun').addEventListener('click', runVl);
  $('imgRun').addEventListener('click', runImage);

  loadSettings();
  $('tempVal').textContent = $('chatTemp').value;
  renderThread();
  ioJson.textContent = '发送任意请求后，这里会显示 JSON（密钥会被打码）。';
  probeHealth();
})();
