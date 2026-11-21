/**
 * PHOTO MOVIE - Cloudflare Worker
 * VERSÃO: 3.0.0
 *
 * CHANGELOG v3.0.0:
 * - NOVO: /stream com suporte real a Range (206) - vídeo e seek funcionam no iPhone
 * - NOVO: /login valida a senha no servidor (variável SENHA_MESTRA)
 * - NOVO: salvar/apagar exigem token de admin quando SENHA_MESTRA estiver configurada
 * - CORRIGIDO: listagem e exclusão de eventos com mais de 1000 arquivos (paginação)
 * - CORRIGIDO: ID do evento no telão não é mais injetado como texto no HTML
 * - TELÃO: tema preto/amarelo, tela sempre ligada, tela cheia, novos vídeos entram sozinhos
 */

async function listAll(env, prefix) {
  const out = []; let cursor;
  do { const r = await env.R2.list({ prefix, cursor }); out.push(...r.objects); cursor = r.truncated ? r.cursor : undefined; } while (cursor);
  return out;
}
function isAdmin(request, env) {
  const secret = env.ADMIN_TOKEN || env.SENHA_MESTRA;
  if (!secret) return true; // sem senha configurada = modo antigo (aberto)
  return request.headers.get("X-Admin-Token") === secret;
}

export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Admin-Token, Range",
      "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
      "Access-Control-Max-Age": "86400",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const jsonH = { ...corsHeaders, "Content-Type": "application/json" };

    if (path === "/login" && request.method === "POST") {
      try {
        const { senha } = await request.json();
        const real = env.SENHA_MESTRA;
        const ok = real ? senha === real : senha === "1234";
        return new Response(JSON.stringify({ ok, protegido: !!real, token: ok ? (env.ADMIN_TOKEN || real || "") : "" }), { status: ok ? 200 : 401, headers: jsonH });
      } catch (e) { return new Response(JSON.stringify({ ok: false }), { status: 400, headers: jsonH }); }
    }
    if (["/salvar-evento", "/deletar", "/deletar-evento-completo"].includes(path) && !isAdmin(request, env)) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), { status: 401, headers: jsonH });
    }

    // ==================== ROTA: TELÃO ====================
    if (path === "/telao") {
      const eventoId = url.searchParams.get("evento") || "";
      return new Response(htmlTelao(eventoId), { 
        headers: { 
          ...corsHeaders, 
          "Content-Type": "text/html",
          "Cache-Control": "no-cache, no-store, must-revalidate"
        } 
      });
    }

    // ==================== ROTA: LISTAR EVENTOS ====================
    if (path === "/listar-eventos") {
      try {
        const { results } = await env.DB.prepare("SELECT * FROM eventos ORDER BY id DESC").all();
        return new Response(JSON.stringify(results), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
      }
    }

    // ==================== ROTA: SALVAR EVENTO ====================
    if (path === "/salvar-evento" && request.method === "POST") {
      try {
        const dados = await request.json();
        
        await env.DB.prepare(
          "INSERT OR REPLACE INTO eventos (id, nome, data, molduraUrl, musicaUrl, musicaTrim, tempo, efeitosVideo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(
          dados.id, 
          dados.nome, 
          dados.data || "",
          dados.molduraUrl || "", 
          dados.musicaUrl || "",
          dados.musicaTrim || "0",
          dados.tempo || "10",
          dados.efeitosVideo || ""
        ).run();
        
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
      }
    }

    // ==================== ROTA: UPLOAD ====================
    if (path === "/upload" && request.method === "POST") {
      try {
        const formData = await request.formData();
        const file = formData.get("file");
        const evento = formData.get("evento");
        const uuid = formData.get("uuid");

        if (!file || !evento || !uuid) {
          return new Response(JSON.stringify({ error: "Faltam campos" }), { status: 400, headers: corsHeaders });
        }

        const fullPath = `${evento}/${uuid}`;
        const buffer = await file.arrayBuffer();
        
        let contentType = file.type;
        if (uuid.endsWith('.mp4')) contentType = "video/mp4";
        else if (uuid.endsWith('.webm')) contentType = "video/webm";
        else if (uuid.endsWith('.png')) contentType = "image/png";
        else if (uuid.endsWith('.jpg') || uuid.endsWith('.jpeg')) contentType = "image/jpeg";
        else if (uuid.endsWith('.mp3')) contentType = "audio/mpeg";

        await env.R2.put(fullPath, buffer, {
          httpMetadata: { contentType, contentLength: buffer.byteLength }
        });

        return new Response(JSON.stringify({ success: true, path: fullPath }), { 
          status: 200,
          headers: { 
            ...corsHeaders, 
            "Content-Type": "application/json",
            "Content-Encoding": "identity" 
          } 
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
      }
    }

    // ==================== ROTA: LISTAR GALERIA ====================
    if (path === "/listar-galeria") {
      try {
        const evento = url.searchParams.get("evento");
        if (!evento) {
          return new Response(JSON.stringify({ error: "Evento não especificado" }), { status: 400, headers: corsHeaders });
        }

        console.log("📂 Listando galeria do evento:", evento);
        
        const objs = await listAll(env, `${evento}/`);
        const files = objs.map(obj => ({
          path: obj.key,
          size: obj.size,
          uploaded: obj.uploaded
        }));

        console.log("✅ Arquivos encontrados:", files.length);
        files.forEach(f => console.log("  -", f.path));

        return new Response(JSON.stringify(files), { 
          headers: { 
            ...corsHeaders, 
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
          } 
        });
      } catch (error) {
        console.error("❌ Erro ao listar galeria:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
      }
    }

    // ==================== ROTA: STREAM ====================
    if (path === "/stream") {
      try {
        const id = url.searchParams.get("id");
        if (!id) {
          return new Response("ID não especificado", { status: 400, headers: corsHeaders });
        }

        const decodedId = decodeURIComponent(id);
        console.log("🎬 Streaming:", decodedId);
        
        const range = request.headers.get("Range");
        const object = await env.R2.get(decodedId, range ? { range: request.headers } : undefined);
        if (!object) {
          return new Response("Arquivo não encontrado", { status: 404, headers: { ...corsHeaders, "Content-Type": "text/plain" } });
        }
        const headers = new Headers(corsHeaders);
        object.writeHttpMetadata(headers);
        if (!headers.get("Content-Type")) headers.set("Content-Type", decodedId.endsWith(".jpg") ? "image/jpeg" : "video/mp4");
        headers.set("Accept-Ranges", "bytes");
        headers.set("ETag", object.httpEtag);
        headers.set("Cache-Control", "public, max-age=86400");
        let status = 200;
        if (range && object.range && object.range.offset !== undefined) {
          const { offset, length } = object.range;
          status = 206;
          headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
          headers.set("Content-Length", String(length));
        } else {
          headers.set("Content-Length", String(object.size));
        }
        return new Response(object.body, { status, headers });
      } catch (error) {
        console.error("❌ Erro no stream:", error);
        return new Response(JSON.stringify({ error: error.message }), { 
          status: 500, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
      }
    }

    // ==================== ROTA: DELETAR ====================
    if (path === "/deletar" && request.method === "POST") {
      try {
        const { path: filePath } = await request.json();
        if (!filePath) return new Response(JSON.stringify({ error: "Path não especificado" }), { status: 400, headers: corsHeaders });
        await env.R2.delete(filePath);
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
      }
    }

    // ==================== ROTA: DELETAR EVENTO COMPLETO ====================
    if (path === "/deletar-evento-completo" && request.method === "POST") {
      try {
        const { id, evento } = await request.json();
        if (!id || !evento) return new Response(JSON.stringify({ error: "ID e nome são obrigatórios" }), { status: 400, headers: corsHeaders });

        await env.DB.prepare("DELETE FROM eventos WHERE id = ?").bind(id).run();
        const keys = (await listAll(env, `${evento}/`)).map(o => o.key);
        for (let i = 0; i < keys.length; i += 1000) await env.R2.delete(keys.slice(i, i + 1000));

        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
      }
    }

    return new Response("PHOTO MOVIE API v3.0.0", { headers: corsHeaders });
  }
};

// ==================== FUNÇÃO DO TELÃO - PHOTO MOVIE ====================
function htmlTelao(eventoIdInicial) {
    return `<!DOCTYPE html>
<html lang="pt-br">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>PHOTO MOVIE - TELÃO</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            background: #000;
            height: 100vh;
            overflow: hidden;
            font-family: 'Segoe UI', sans-serif;
            cursor: none;
        }

        #main-video {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            object-fit: contain;
            background: #000;
            z-index: 1;
        }

        #controls-bar {
            position: fixed;
            bottom: 30px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.8);
            border: 1px solid rgba(255, 208, 0, 0.3);
            border-radius: 50px;
            padding: 15px 25px;
            display: flex;
            gap: 20px;
            align-items: center;
            z-index: 100;
            transition: opacity 0.5s ease;
            opacity: 1;
        }

        #controls-bar.hidden {
            opacity: 0;
            pointer-events: none;
        }

        .control-btn {
            background: rgba(255, 208, 0, 0.2);
            border: 1px solid #FFD000;
            color: #FFD000;
            width: 60px;
            height: 60px;
            border-radius: 50%;
            cursor: pointer;
            font-size: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        #video-counter {
            color: rgba(255, 255, 255, 0.7);
            font-size: 14px;
            min-width: 50px;
            text-align: center;
            font-weight: bold;
        }

        #loading-screen {
            position: fixed;
            inset: 0;
            background: #000;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 1000;
        }

        #loading-screen.hidden {
            display: none;
        }

        .loading-text {
            color: #FFD000;
            font-size: 18px;
            letter-spacing: 3px;
            margin-top: 20px;
        }

        .error-message {
            color: #ff4d4d;
            font-size: 18px;
            text-align: center;
            padding: 20px;
        }
    </style>
</head>
<body>

    <div id="loading-screen">
        <div style="color: #FFD000; font-size: 48px;">🎬</div>
        <div class="loading-text">PHOTO MOVIE</div>
    </div>

    <video id="main-video" playsinline webkit-playsinline autoplay muted></video>

    <div id="controls-bar">
        <button class="control-btn" onclick="videoAnterior()">⏮</button>
        <button class="control-btn" onclick="toggleSom()" id="btn-sound">🔇</button>
        <button class="control-btn" onclick="proximoVideo()">⏭</button>
        <button class="control-btn" onclick="toggleTela()">⛶</button>
        <span id="video-counter">0/0</span>
    </div>

<script>
    const WORKER_URL = "https://photomovie.maxprimefotovideo.workers.dev";
    const EVENTO_INICIAL = ${JSON.stringify(eventoIdInicial).replace(/</g, "\\u003c")};
    let videos = [];
    let videoAtual = 0;
    let comSom = false; // Começa mudo para autoplay funcionar
    let timeoutControles;

    async function iniciarTelao() {
        try {
            let eventoId = EVENTO_INICIAL;
            
            if (!eventoId) {
                const config = JSON.parse(localStorage.getItem('config_atual'));
                if (config && config.id) {
                    eventoId = config.id;
                }
            }
            
            if (!eventoId) {
                const res = await fetch(WORKER_URL + '/listar-eventos');
                const eventos = await res.json();
                if (eventos && eventos.length > 0) {
                    eventoId = eventos[0].id;
                }
            }
            
            window.EVENTO_ATUAL = eventoId;
            console.log("PHOTO MOVIE - Evento:", eventoId);
            
            if (!eventoId) {
                mostrarErro("Nenhum evento encontrado");
                return;
            }
            
            // Buscar vídeos
            const url = WORKER_URL + '/listar-galeria?evento=' + encodeURIComponent(eventoId);
            console.log("PHOTO MOVIE - URL:", url);
            
            const res = await fetch(url);
            const dados = await res.json();
            
            console.log("PHOTO MOVIE - Dados:", dados);
            
            // Filtrar vídeos finais
            videos = dados.filter(f => {
                const filename = (f.path || "").split('/').pop();
                return filename.startsWith('final_') && filename.endsWith('.mp4');
            });
            
            console.log("PHOTO MOVIE - Vídeos:", videos.length);
            
            if (videos.length === 0) {
                mostrarErro("Nenhum vídeo encontrado");
                return;
            }
            
            // Ordenar
            videos.sort((a, b) => new Date(a.uploaded || 0) - new Date(b.uploaded || 0));
            
            // Mostrar primeiro vídeo
            document.getElementById('loading-screen').classList.add('hidden');
            carregarVideo(0);
            
        } catch (error) {
            console.error("PHOTO MOVIE - Erro:", error);
            mostrarErro("Erro: " + error.message);
        }
    }

    function carregarVideo(index) {
        if (videos.length === 0) return;
        
        videoAtual = index;
        const video = document.getElementById('main-video');
        const videoUrl = WORKER_URL + '/stream?id=' + encodeURIComponent(videos[index].path);
        
        console.log("PHOTO MOVIE - Carregando:", videoUrl);
        
        video.src = videoUrl;
        video.muted = !comSom;
        video.load();
        
        video.oncanplay = () => {
            console.log("PHOTO MOVIE - Pode reproduzir");
            video.play().catch(err => {
                console.error("PHOTO MOVIE - Erro play:", err);
            });
        };
        
        video.onplaying = () => {
            console.log("PHOTO MOVIE - Reproduzindo!");
            atualizarContador();
            mostrarControles();
        };
        
        video.onended = () => {
            console.log("PHOTO MOVIE - Terminou");
            proximoVideo();
        };
        
        video.onerror = (e) => {
            console.error("PHOTO MOVIE - Erro vídeo:", e);
            setTimeout(() => proximoVideo(), 1000);
        };
    }

    function proximoVideo() {
        if (videos.length === 0) return;
        carregarVideo((videoAtual + 1) % videos.length);
    }

    function videoAnterior() {
        if (videos.length === 0) return;
        carregarVideo((videoAtual - 1 + videos.length) % videos.length);
    }

    function toggleSom() {
        comSom = !comSom;
        const video = document.getElementById('main-video');
        video.muted = !comSom;
        document.getElementById('btn-sound').textContent = comSom ? '🔊' : '🔇';
        mostrarControles();
    }

    function atualizarContador() {
        document.getElementById('video-counter').textContent = (videoAtual + 1) + '/' + videos.length;
    }

    function mostrarControles() {
        const controls = document.getElementById('controls-bar');
        controls.classList.remove('hidden');
        clearTimeout(timeoutControles);
        timeoutControles = setTimeout(() => {
            controls.classList.add('hidden');
        }, 3000);
    }

    function mostrarErro(mensagem) {
        document.getElementById('loading-screen').innerHTML = 
            '<div style="color: #ff4d4d; font-size: 48px;">❌</div>' +
            '<div class="error-message">' + mensagem + '</div>';
    }

    document.addEventListener('mousemove', mostrarControles);
    document.addEventListener('touchstart', mostrarControles);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') proximoVideo();
        if (e.key === 'ArrowLeft') videoAnterior();
        if (e.key === ' ') { e.preventDefault(); toggleSom(); }
    });

    function toggleTela() {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen().catch(function () {});
        mostrarControles();
    }
    async function manterTelaLigada() {
        try { if (navigator.wakeLock) await navigator.wakeLock.request('screen'); } catch (e) {}
    }
    document.addEventListener('visibilitychange', function () { if (!document.hidden) manterTelaLigada(); });
    async function atualizarLista() {
        if (!window.EVENTO_ATUAL || videos.length === 0) return;
        try {
            const r = await fetch(WORKER_URL + '/listar-galeria?evento=' + encodeURIComponent(window.EVENTO_ATUAL) + '&t=' + Date.now());
            const d = await r.json();
            const novos = d.filter(function (f) {
                const n = (f.path || "").split('/').pop();
                return n.startsWith('final_') && n.endsWith('.mp4');
            }).sort(function (a, b) { return new Date(a.uploaded || 0) - new Date(b.uploaded || 0); });
            if (novos.length === 0) return;
            const atual = videos[videoAtual] && videos[videoAtual].path;
            videos = novos;
            const i = videos.findIndex(function (v) { return v.path === atual; });
            videoAtual = i >= 0 ? i : 0;
            atualizarContador();
        } catch (e) {}
    }
    window.onload = function () { iniciarTelao(); manterTelaLigada(); setInterval(atualizarLista, 20000); };
<\/script>
</body>
</html>`;
}