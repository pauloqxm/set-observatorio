/**
 * Cadeado das abas internas (CONDEC e Estatísticas CAGED).
 * O token vive no servidor (RESTRICTED_ACCESS_TOKEN); o cookie httpOnly
 * é gravado depois que o código confere.
 */
window.obsAcesso = (function () {
  const ABAS = new Set(["condec", "caged_estatisticas"]);
  const ROTULOS = {
    condec: "RAIS e CONDEC",
    caged_estatisticas: "Estatísticas CAGED",
  };

  const EVENTOS_ATIVIDADE = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "wheel"];
  const RENOVACAO_MS = 60 * 1000;
  let idleMinutos = 15;
  let carga = null;
  let modal = null;
  let aviso = null;
  let idleTimer = null;
  let ociosidadeLigada = false;
  let ultimaRenovacao = 0;
  let onEncerrar = null;

  const estado = { ativo: false, liberado: false };

  function cadeadoHtml(aba) {
    if (!precisaCadeado(aba)) return "";
    return '<span class="menu-item__cadeado" title="Acesso restrito"><i class="fa-solid fa-lock"></i></span>';
  }

  function precisaCadeado(aba) {
    return estado.ativo && !estado.liberado && ABAS.has(aba);
  }

  function carregar() {
    if (carga) return carga;
    carga = fetch("/api/acesso", { cache: "no-store", credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : { ativo: false, liberado: true }))
      .then((dados) => {
        estado.ativo = !!dados.ativo;
        estado.liberado = !!dados.liberado;
        if (dados.idle_minutos) idleMinutos = dados.idle_minutos;
        sincronizarOciosidade();
        return estado;
      })
      .catch(() => {
        estado.ativo = false;
        estado.liberado = true;
        return estado;
      });
    return carga;
  }

  function garantirModal() {
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "acesso-modal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="acesso-modal__fundo" data-acesso-fechar></div>
      <div class="acesso-modal__caixa" role="dialog" aria-modal="true" aria-labelledby="acessoModalTitulo">
        <span class="acesso-modal__icone" aria-hidden="true"><i class="fa-solid fa-lock"></i></span>
        <h2 class="acesso-modal__titulo" id="acessoModalTitulo">Acesso restrito</h2>
        <p class="acesso-modal__texto" id="acessoModalTexto">Esta aba contém dados internos. Digite o código de acesso.</p>
        <p class="acesso-modal__idle" id="acessoModalIdle"></p>
        <form class="acesso-modal__form" id="acessoModalForm">
          <label class="acesso-modal__rotulo" for="acessoModalToken">Código de acesso</label>
          <input id="acessoModalToken" class="acesso-modal__input" type="password" autocomplete="off" required>
          <p class="acesso-modal__erro" id="acessoModalErro" hidden></p>
          <div class="acesso-modal__acoes">
            <button type="button" class="acesso-modal__btn acesso-modal__btn--ghost" data-acesso-fechar>Cancelar</button>
            <button type="submit" class="acesso-modal__btn acesso-modal__btn--ok">Liberar</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelectorAll("[data-acesso-fechar]").forEach((el) => {
      el.addEventListener("click", () => fecharModal(false));
    });
    modal.querySelector("#acessoModalForm").addEventListener("submit", onEnviar);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal && !modal.hidden) fecharModal(false);
    });
    return modal;
  }

  let resolverPedido = null;

  function fecharModal(ok) {
    if (!modal) return;
    modal.hidden = true;
    const resolve = resolverPedido;
    resolverPedido = null;
    if (resolve) resolve(ok);
  }

  async function onEnviar(e) {
    e.preventDefault();
    const input = modal.querySelector("#acessoModalToken");
    const erro = modal.querySelector("#acessoModalErro");
    const btn = modal.querySelector(".acesso-modal__btn--ok");
    erro.hidden = true;
    btn.disabled = true;
    try {
      const res = await fetch("/api/acesso", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: input.value || "" }),
      });
      if (!res.ok) {
        erro.textContent = "Código inválido. Confira e tente de novo.";
        erro.hidden = false;
        input.focus();
        input.select();
        return;
      }
      estado.liberado = true;
      atualizarCadeados();
      sincronizarOciosidade();
      fecharModal(true);
    } catch {
      erro.textContent = "Não foi possível validar o código. Tente novamente.";
      erro.hidden = false;
    } finally {
      btn.disabled = false;
    }
  }

  function pedir(aba) {
    if (!precisaCadeado(aba)) return Promise.resolve(true);
    garantirModal();
    const texto = modal.querySelector("#acessoModalTexto");
    const nome = ROTULOS[aba] || "esta aba";
    texto.textContent = `${nome} contém dados internos. Digite o código de acesso para liberar o menu.`;
    const idle = modal.querySelector("#acessoModalIdle");
    if (idle) idle.textContent = `A sessão encerra após ${idleMinutos} minutos sem mouse ou teclado.`;
    modal.querySelector("#acessoModalErro").hidden = true;
    modal.querySelector("#acessoModalToken").value = "";
    modal.hidden = false;
    setTimeout(() => modal.querySelector("#acessoModalToken").focus(), 40);
    return new Promise((resolve) => {
      resolverPedido = resolve;
    });
  }

  function atualizarCadeados() {
    document.querySelectorAll("[data-aba-restrita]").forEach((el) => {
      const aba = el.getAttribute("data-aba-restrita");
      const marca = el.querySelector(".menu-item__cadeado");
      if (marca) marca.hidden = !precisaCadeado(aba);
    });
  }

  function prenderLinks() {
    document.querySelectorAll("a[href*='aba=']").forEach((a) => {
      let aba = "";
      try {
        aba = new URL(a.getAttribute("href"), location.origin).searchParams.get("aba") || "";
      } catch {
        return;
      }
      if (!ABAS.has(aba)) return;
      a.setAttribute("data-aba-restrita", aba);
      if (!a.querySelector(".menu-item__cadeado")) {
        a.insertAdjacentHTML("beforeend", '<span class="menu-item__cadeado" hidden title="Acesso restrito"><i class="fa-solid fa-lock"></i></span>');
      }
      a.addEventListener("click", async (e) => {
        if (!precisaCadeado(aba)) return;
        e.preventDefault();
        const ok = await pedir(aba);
        if (ok) location.href = a.href;
      });
    });
    atualizarCadeados();
  }

  function marcarAtividade() {
    if (!estado.ativo || !estado.liberado) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(encerrarPorIdle, idleMinutos * 60 * 1000);
    const agora = Date.now();
    if (agora - ultimaRenovacao < RENOVACAO_MS) return;
    ultimaRenovacao = agora;
    fetch("/api/acesso/renovar", { method: "POST", credentials: "same-origin" }).then((res) => {
      if (res.status === 401) encerrarPorIdle();
    }).catch(() => {});
  }

  function ligarOciosidade() {
    if (ociosidadeLigada) {
      marcarAtividade();
      return;
    }
    ociosidadeLigada = true;
    EVENTOS_ATIVIDADE.forEach((ev) => {
      window.addEventListener(ev, marcarAtividade, { passive: true });
    });
    marcarAtividade();
  }

  function desligarOciosidade() {
    clearTimeout(idleTimer);
    idleTimer = null;
    if (!ociosidadeLigada) return;
    EVENTOS_ATIVIDADE.forEach((ev) => {
      window.removeEventListener(ev, marcarAtividade);
    });
    ociosidadeLigada = false;
  }

  function sincronizarOciosidade() {
    if (estado.ativo && estado.liberado) ligarOciosidade();
    else desligarOciosidade();
  }

  function mostrarAviso() {
    if (!aviso) {
      aviso = document.createElement("div");
      aviso.className = "acesso-aviso";
      aviso.setAttribute("role", "status");
      document.body.appendChild(aviso);
    }
    aviso.textContent = `Sessão encerrada por inatividade (${idleMinutos} min sem movimento).`;
    aviso.hidden = false;
    clearTimeout(mostrarAviso._t);
    mostrarAviso._t = setTimeout(() => {
      aviso.hidden = true;
    }, 6000);
  }

  async function encerrarPorIdle() {
    if (!estado.liberado) return;
    desligarOciosidade();
    estado.liberado = false;
    try {
      await fetch("/api/acesso/sair", { method: "POST", credentials: "same-origin" });
    } catch {
      /* o cadeado no menu já volta mesmo se a rede falhar */
    }
    atualizarCadeados();
    mostrarAviso();
    if (typeof onEncerrar === "function") onEncerrar();
  }

  function iniciarPagina() {
    return carregar().then(() => {
      prenderLinks();
      return estado;
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iniciarPagina);
  } else {
    iniciarPagina();
  }

  return {
    estado,
    carregar,
    precisaCadeado,
    cadeadoHtml,
    pedir,
    iniciarPagina,
    atualizarCadeados,
    get onEncerrar() {
      return onEncerrar;
    },
    set onEncerrar(fn) {
      onEncerrar = fn;
    },
  };
})();
