const SUPABASE_URL = "https://ayvcrpysnzinwnfmylwb.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_yC-QvpAoh86cbGWCa80itw_kadE6bMf";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const PASSWORD_SUPER_ADMIN = "fulvio_Vento5";

let state = {
  sezione: null,
  operaio: null,
  titolare: null,
  adminSbloccato: false,
  tabDip: 'oggi',
  tabTit: 'assegna',
  tabCantieri: 'aperti',
  tabAdmin: 'ore'
};

let dbLocale = JSON.parse(localStorage.getItem('rapportini_db_v1')) || {
  lavori: [],
  intervalli: [],
  dipendenti: [],
  titolari: [],
  codaSync: []
};

let html5QrScanner = null;

function salvaLocale() {
  localStorage.setItem('rapportini_db_v1', JSON.stringify(dbLocale));
}

function aggiornaBarraRete() {
  const bar = document.getElementById('net-status');
  const lbl = document.getElementById('net-label');
  const pendenti = dbLocale.codaSync.length;
  if (navigator.onLine) {
    bar.className = "status-bar online-bg d-flex justify-content-between align-items-center";
    lbl.innerText = pendenti > 0 ? `🟢 Online — ${pendenti} modifiche da inviare...` : "🟢 Online — Sincronizzato con Supabase";
  } else {
    bar.className = "status-bar offline-bg d-flex justify-content-between align-items-center";
    lbl.innerText = `🔴 OFFLINE (Lavoro Locale) — ${pendenti} in attesa di rete`;
  }
}

window.addEventListener('online', () => { aggiornaBarraRete(); sincronizzaTutto(); });
window.addEventListener('offline', aggiornaBarraRete);

async function sincronizzaTutto() {
  aggiornaBarraRete();
  if (!navigator.onLine) {
    render();
    return;
  }
  try {
    if (dbLocale.codaSync.length > 0) {
      const codaCopia = [...dbLocale.codaSync];
      dbLocale.codaSync = [];
      salvaLocale();

      for (const op of codaCopia) {
        if (op.tipo === 'upsert_lavoro') {
          const { data: lavIns, error } = await sb.from('lavori').upsert(op.dati).select();
          if (!error && lavIns && lavIns[0] && op.intervalliLocale) {
            const realId = lavIns[0].id;
            await sb.from('intervalli_orari').delete().eq('lavoro_id', realId);
            for (const iv of op.intervalliLocale) {
              await sb.from('intervalli_orari').insert({ lavoro_id: realId, ora_inizio: iv.ora_inizio, ora_fine: iv.ora_fine });
            }
          }
        } else if (op.tipo === 'insert_nuovo_lavoro') {
          const { data: lavNew, error } = await sb.from('lavori').insert(op.dati).select();
          if (!error && lavNew && lavNew[0] && op.intervalliLocale) {
            const realId = lavNew[0].id;
            for (const iv of op.intervalliLocale) {
              await sb.from('intervalli_orari').insert({ lavoro_id: realId, ora_inizio: iv.ora_inizio, ora_fine: iv.ora_fine });
            }
          }
        } else if (op.tipo === 'upsert_dipendente') {
          await sb.from('configurazione_dipendenti').upsert(op.dati);
        } else if (op.tipo === 'delete_dipendente') {
          await sb.from('configurazione_dipendenti').delete().eq('nome', op.nome).eq('cognome', op.cognome);
        } else if (op.tipo === 'upsert_titolare') {
          await sb.from('configurazione_titolari').upsert(op.dati);
        }
      }
    }

    const [resLav, resInt, resDip, resTit] = await Promise.all([
      sb.from('lavori').select('*').order('data', { ascending: false }),
      sb.from('intervalli_orari').select('*'),
      sb.from('configurazione_dipendenti').select('*').order('cognome', { ascending: true }),
      sb.from('configurazione_titolari').select('*')
    ]);

    if (resLav.data) dbLocale.lavori = resLav.data;
    if (resInt.data) dbLocale.intervalli = resInt.data;
    if (resDip.data) dbLocale.dipendenti = resDip.data;
    if (resTit.data) dbLocale.titolari = resTit.data;
    salvaLocale();
  } catch (e) {
    console.error("Errore sync:", e);
  }
  aggiornaBarraRete();
  render();
}

function calcolaOre(inizio, fine) {
  if (!inizio || !fine) return 0;
  const [h1, m1] = inizio.split(':').map(Number);
  const [h2, m2] = fine.split(':').map(Number);
  if (isNaN(h1) || isNaN(h2)) return 0;
  return Math.max(0, ((h2 * 60 + m2) - (h1 * 60 + m1)) / 60);
}

function formattaDurata(oreDec) {
  const minTot = Math.round(oreDec * 60);
  if (minTot <= 0) return "0 min";
  const h = Math.floor(minTot / 60);
  const m = minTot % 60;
  if (h > 0 && m > 0) return `${h} h ${m} min`;
  return h > 0 ? `${h} h` : `${m} min`;
}

function oreLavoro(lavoroId) {
  return dbLocale.intervalli
    .filter(i => String(i.lavoro_id) === String(lavoroId))
    .reduce((acc, i) => acc + calcolaOre(i.ora_inizio, i.ora_fine), 0);
}

function oggiISO() {
  return new Date().toISOString().split('T')[0];
}
// ==========================================
// SCAMBIO DATI OFFLINE BIDIREZIONALE (QR + FILE)
// ==========================================
function apriEsportaOffline(titolo, oggettoDati) {
  const jsonStr = JSON.stringify(oggettoDati);
  const modalBody = document.getElementById('modalBody');
  document.getElementById('modalTitle').innerText = titolo;

  modalBody.innerHTML = `
    <p class="small text-muted">1. Fai inquadrare questo <b>Codice QR</b> dall'altro telefono (dentro l'app) oppure usa il tasto <b>Condividi / File</b> per inviarlo via Quick Share / AirDrop senza internet.</p>
    <div id="qrcode-container" class="my-3 p-2 bg-white border rounded"></div>
    <button class="btn btn-primary w-100 mb-2" onclick='scaricaPacchettoFile(${JSON.stringify(jsonStr)})'>📤 Condividi / Salva File Offline (.json)</button>
    <button class="btn btn-outline-secondary w-100" data-bs-dismiss="modal">Chiudi</button>
  `;

  const modal = new bootstrap.Modal(document.getElementById('offlineExchangeModal'));
  modal.show();

  setTimeout(() => {
    const container = document.getElementById('qrcode-container');
    container.innerHTML = "";
    if (jsonStr.length <= 1200) {
      new QRCode(container, { text: jsonStr, width: 240, height: 240, correctLevel: QRCode.CorrectLevel.L });
    } else {
      container.innerHTML = "<div class='alert alert-warning small'>Pacchetto troppo grande per un singolo QR. Usa il pulsante blu <b>Condividi / Salva File Offline</b> qui sotto.</div>";
    }
  }, 300);
}

function scaricaPacchettoFile(jsonStr) {
  const blob = new Blob([jsonStr], { type: "application/json" });
  const file = new File([blob], `pacchetto_rapportino_${Date.now()}.json`, { type: "application/json" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], title: "Pacchetto Rapportini Offline" }).catch(() => {});
  } else {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
  }
}

function apriImportaOffline() {
  document.getElementById('modalTitle').innerText = "📷 Ricevi Dati Senza Internet";
  const modalBody = document.getElementById('modalBody');
  modalBody.innerHTML = `
    <p class="small text-muted">Inquadra il <b>Codice QR</b> dell'altro telefono oppure carica il file <b>.json</b> ricevuto.</p>
    <div id="qr-reader" class="mb-3"></div>
    <hr>
    <label class="form-label fw-bold">Oppure seleziona file ricevuto:</label>
    <input type="file" accept=".json" class="form-control mb-3" onchange="leggiFileImportato(event)">
    <button class="btn btn-outline-secondary w-100" data-bs-dismiss="modal" onclick="fermaScanner()">Annulla</button>
  `;

  const modal = new bootstrap.Modal(document.getElementById('offlineExchangeModal'));
  modal.show();

  setTimeout(() => {
    try {
      html5QrScanner = new Html5Qrcode("qr-reader");
      html5QrScanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (decodedText) => {
          fermaScanner();
          bootstrap.Modal.getInstance(document.getElementById('offlineExchangeModal')).hide();
          elaboraPacchettoRicevuto(decodedText);
        },
        () => {}
      ).catch(() => {
        document.getElementById('qr-reader').innerHTML = "<div class='alert alert-info small'>Fotocamera non disponibile: usa il caricamento file qui sotto.</div>";
      });
    } catch (e) {}
  }, 400);
}

function fermaScanner() {
  if (html5QrScanner) {
    html5QrScanner.stop().then(() => html5QrScanner.clear()).catch(() => {});
    html5QrScanner = null;
  }
}

function leggiFileImportato(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    fermaScanner();
    bootstrap.Modal.getInstance(document.getElementById('offlineExchangeModal')).hide();
    elaboraPacchettoRicevuto(e.target.result);
  };
  reader.readAsText(file);
}

function elaboraPacchettoRicevuto(jsonStr) {
  try {
    const pkt = JSON.parse(jsonStr);
    if (pkt.azione === 'nuovo_lavoro_assegnato' && pkt.lavoro) {
      const lav = pkt.lavoro;
      lav.id = lav.id || ("loc_" + Date.now());
      dbLocale.lavori.unshift(lav);
      dbLocale.codaSync.push({ tipo: 'insert_nuovo_lavoro', dati: { data: lav.data, cliente: lav.cliente, lavoro: lav.lavoro, materiali: lav.materiali || '', completato: 0, dipendente: lav.dipendente } });
      salvaLocale();
      alert(`✅ Nuovo lavoro ricevuto per ${lav.cliente}!`);
      sincronizzaTutto();
    } else if (pkt.azione === 'invio_rapportino_dipendente' && pkt.lavoro) {
      const lav = pkt.lavoro;
      const ints = pkt.intervalli || [];
      const idx = dbLocale.lavori.findIndex(x => String(x.id) === String(lav.id));
      if (idx >= 0) dbLocale.lavori[idx] = lav;
      else dbLocale.lavori.unshift(lav);

      dbLocale.intervalli = dbLocale.intervalli.filter(i => String(i.lavoro_id) !== String(lav.id));
      ints.forEach(iv => dbLocale.intervalli.push(iv));

      const isLocalId = String(lav.id).startsWith('loc_');
      const payloadDb = { data: lav.data, cliente: lav.cliente, lavoro: lav.lavoro, materiali: lav.materiali || '', completato: lav.completato, dipendente: lav.dipendente };
      if (!isLocalId) payloadDb.id = lav.id;

      dbLocale.codaSync.push({
        tipo: isLocalId ? 'insert_nuovo_lavoro' : 'upsert_lavoro',
        dati: payloadDb,
        intervalliLocale: ints
      });
      salvaLocale();
      alert(`✅ Rapportino ricevuto da ${lav.dipendente} (${lav.cliente})!`);
      sincronizzaTutto();
    } else {
      alert("❌ Pacchetto non riconosciuto.");
    }
  } catch (err) {
    alert("❌ Errore nella lettura dei dati offline.");
  }
}
// ==========================================
// INTERFACCIA UTENTE - HOME E AREA DIPENDENTI
// ==========================================
function render() {
  aggiornaBarraRete();
  const root = document.getElementById('app-root');

  if (!state.sezione) {
    root.innerHTML = `
      <div class="text-center my-4">
        <h2>📋 Gestione Rapportini Lavoro</h2>
        <p class="text-muted">Versione Installabile Offline & Cloud</p>
      </div>
      <div class="d-grid gap-3">
        <button class="btn btn-primary btn-lg py-3" onclick="state.sezione='dipendenti'; render()">👷 Area Dipendenti</button>
        <button class="btn btn-dark btn-lg py-3" onclick="state.sezione='titolare'; render()">👔 Area Titolare</button>
        <button class="btn btn-secondary btn-lg py-3" onclick="state.sezione='superadmin'; render()">👑 Area Amministratore App</button>
      </div>
    `;
    return;
  }

  if (state.sezione === 'dipendenti') {
    if (!state.operaio) {
      const lista = dbLocale.dipendenti.length > 0
        ? dbLocale.dipendenti.map(d => `${d.nome.trim()} ${d.cognome.trim()}`)
        : ["Fulvio De Simone"];
      root.innerHTML = `
        <button class="btn btn-outline-secondary mb-3" onclick="state.sezione=null; render()">⬅️ Indietro</button>
        <div class="card card-custom p-3">
          <h4>👷 Accesso Dipendenti</h4>
          <label class="form-label mt-2">Seleziona il tuo Nome:</label>
          <select id="sel-op" class="form-select mb-3">
            ${lista.map(n => `<option value="${n}">${n}</option>`).join('')}
          </select>
          <label class="form-label">Inserisci il tuo PIN:</label>
          <input type="password" id="pin-op" class="form-control mb-3" placeholder="PIN personale">
          <button class="btn btn-primary w-100" onclick="loginOperaio()">Accedi</button>
        </div>
      `;
      return;
    }

    const op = state.operaio;
    const lavoriMiei = dbLocale.lavori.filter(l => l.dipendente === op);
    const assegnati = lavoriMiei.filter(l => l.completato === 0);
    const aperti = lavoriMiei.filter(l => l.completato === 3);

    let html = `
      <div class="d-flex justify-content-between align-items-center mb-2">
        <h5>👷 ${op}</h5>
        <button class="btn btn-sm btn-outline-danger" onclick="state.operaio=null; state.sezione=null; render()">🔒 Esci</button>
      </div>
      <div class="d-grid gap-2 mb-3">
        <button class="btn btn-warning fw-bold" onclick="apriImportaOffline()">📷 Ricevi Lavoro dal Titolare (Senza Internet)</button>
        <button class="btn btn-outline-primary" data-bs-toggle="collapse" data-bs-target="#boxFuoriProg">➕ Nuovo Lavoro Fuori Programma</button>
      </div>
      <div class="collapse mb-3" id="boxFuoriProg">
        <div class="card card-custom p-3">
          <h6>Nuovo Intervento Spontaneo</h6>
          <input type="date" id="fp-dt" class="form-control mb-2" value="${oggiISO()}">
          <input type="text" id="fp-cli" class="form-control mb-2" placeholder="Nome Cliente *">
          <textarea id="fp-lav" class="form-control mb-2" placeholder="Lavoro svolto *"></textarea>
          <textarea id="fp-mat" class="form-control mb-2" placeholder="Materiali / Note"></textarea>
          <div class="row g-2 mb-2">
            <div class="col"><input type="text" id="fp-in" class="form-control" value="08:00" placeholder="Inizio"></div>
            <div class="col"><input type="text" id="fp-fi" class="form-control" value="12:00" placeholder="Fine"></div>
          </div>
          <div class="d-flex gap-2">
            <button class="btn btn-warning w-50" onclick="salvaFuoriProgramma(3)">⏳ Non Finito</button>
            <button class="btn btn-success w-50" onclick="salvaFuoriProgramma(1)">🚀 Invio Definitivo</button>
          </div>
        </div>
      </div>

      <ul class="nav nav-pills nav-fill mb-3">
        <li class="nav-item"><button class="nav-link ${state.tabDip==='oggi'?'active':''}" onclick="state.tabDip='oggi'; render()">📋 Assegnati (${assegnati.length})</button></li>
        <li class="nav-item"><button class="nav-link ${state.tabDip==='aperti'?'active':''}" onclick="state.tabDip='aperti'; render()">🏗️ Incompleti (${aperti.length})</button></li>
        <li class="nav-item"><button class="nav-link ${state.tabDip==='storico'?'active':''}" onclick="state.tabDip='storico'; render()">📅 Mese</button></li>
      </ul>
    `;

    if (state.tabDip === 'oggi') {
      if (assegnati.length === 0) html += `<div class="alert alert-success">👍 Nessun lavoro assegnato aperto.</div>`;
      assegnati.forEach(l => {
        const ints = dbLocale.intervalli.filter(i => String(i.lavoro_id) === String(l.id));
        html += `
          <div class="card card-custom p-3">
            <h5>🏢 ${l.cliente} <span class="badge bg-secondary">${l.data}</span></h5>
            <p class="mb-2">${l.lavoro}</p>
            <div class="row g-2 mb-2">
              <div class="col-5"><input type="text" id="in_${l.id}" class="form-control form-control-sm" value="08:00"></div>
              <div class="col-5"><input type="text" id="fi_${l.id}" class="form-control form-control-sm" value="12:00"></div>
              <div class="col-2"><button class="btn btn-sm btn-primary w-100" onclick="aggiungiOrario('${l.id}')">+⏱️</button></div>
            </div>
            <div class="mb-2 small">
              ${ints.map(iv => `<span class="badge bg-info text-dark me-1">${iv.ora_inizio}-${iv.ora_fine} <b style="cursor:pointer" onclick="rimuoviOrario('${iv.id}')">❌</b></span>`).join('')}
            </div>
            <textarea id="mat_${l.id}" class="form-control form-control-sm mb-2" placeholder="Materiali / Note">${l.materiali || ''}</textarea>
            <div class="d-flex gap-2">
              <button class="btn btn-sm btn-warning w-50" onclick="chiudiLavoroDip('${l.id}', 3)">⏳ Non Finito</button>
              <button class="btn btn-sm btn-success w-50" onclick="chiudiLavoroDip('${l.id}', 1)">🚀 Finito</button>
            </div>
          </div>
        `;
      });
    } else if (state.tabDip === 'aperti') {
      if (aperti.length === 0) html += `<div class="alert alert-info">Nessun cantiere incompleto.</div>`;
      aperti.forEach(l => {
        html += `
          <div class="card card-custom p-3">
            <h5>🏢 ${l.cliente} (${l.data})</h5>
            <p>${l.lavoro} — <b>Tot: ${formattaDurata(oreLavoro(l.id))}</b></p>
            <div class="d-flex gap-2">
              <button class="btn btn-sm btn-success w-50" onclick="chiudiLavoroDip('${l.id}', 1)">🚀 Chiudi Definitivo</button>
              <button class="btn btn-sm btn-dark w-50" onclick="inviaRapportinoOffline('${l.id}')">📡 Invia al Titolare Offline</button>
            </div>
          </div>
        `;
      });
    } else {
      const meseCorr = oggiISO().slice(0, 7);
      const delMese = lavoriMiei.filter(l => (l.data || '').startsWith(meseCorr));
      let totOre = 0;
      delMese.forEach(l => {
        const o = oreLavoro(l.id);
        if (l.completato !== 2) totOre += o;
        html += `
          <div class="card card-custom p-2">
            <div class="d-flex justify-content-between">
              <b>🏢 ${l.cliente} (${l.data})</b>
              <span>${formattaDurata(o)}</span>
            </div>
            <small class="text-muted">${l.lavoro}</small>
            <button class="btn btn-sm btn-outline-dark mt-2 w-100" onclick="inviaRapportinoOffline('${l.id}')">📡 Genera QR / File per Titolare (Offline)</button>
          </div>
        `;
      });
      html += `<div class="alert alert-primary fw-bold mt-2">⏱️ Totale Mese (${meseCorr}): ${formattaDurata(totOre)}</div>`;
    }
    root.innerHTML = html;
    return;
  }
  // ---------------- AREA TITOLARE ----------------
  if (state.sezione === 'titolare') {
    if (!state.titolare) {
      const listaTit = dbLocale.titolari.length > 0
        ? dbLocale.titolari.map(t => `${t.nome.trim()} ${t.cognome.trim()}`)
        : ["Titolare"];
      root.innerHTML = `
        <button class="btn btn-outline-secondary mb-3" onclick="state.sezione=null; render()">⬅️ Indietro</button>
        <div class="card card-custom p-3">
          <h4>👔 Accesso Titolare</h4>
          <select id="sel-tit" class="form-select my-2">
            ${listaTit.map(n => `<option value="${n}">${n}</option>`).join('')}
          </select>
          <input type="password" id="pin-tit" class="form-control mb-3" placeholder="PIN Titolare">
          <button class="btn btn-dark w-100" onclick="loginTitolare()">Accedi</button>
        </div>
      `;
      return;
    }

    const listaDip = dbLocale.dipendenti.map(d => `${d.nome.trim()} ${d.cognome.trim()}`);
    let html = `
      <div class="d-flex justify-content-between align-items-center mb-2">
        <h5>👔 ${state.titolare}</h5>
        <button class="btn btn-sm btn-outline-danger" onclick="state.titolare=null; state.sezione=null; render()">🔒 Esci</button>
      </div>
      <button class="btn btn-success w-100 fw-bold mb-3" onclick="apriImportaOffline()">📷 Ricevi Rapportino dal Dipendente (Senza Internet)</button>

      <ul class="nav nav-pills nav-fill mb-3">
        <li class="nav-item"><button class="nav-link ${state.tabTit==='assegna'?'active':''}" onclick="state.tabTit='assegna'; render()">📝 Assegna</button></li>
        <li class="nav-item"><button class="nav-link ${state.tabTit==='ricevuti'?'active':''}" onclick="state.tabTit='ricevuti'; render()">📩 Ricevuti</button></li>
        <li class="nav-item"><button class="nav-link ${state.tabTit==='cantieri'?'active':''}" onclick="state.tabTit='cantieri'; render()">🏗️ Cantieri</button></li>
      </ul>
    `;

    if (state.tabTit === 'assegna') {
      html += `
        <div class="card card-custom p-3">
          <h6>Assegna Nuovo Lavoro</h6>
          <input type="date" id="ass-dt" class="form-control mb-2" value="${oggiISO()}">
          <select id="ass-dip" class="form-select mb-2">
            ${listaDip.map(d => `<option value="${d}">${d}</option>`).join('')}
          </select>
          <input type="text" id="ass-cli" class="form-control mb-2" placeholder="Nome Cliente *">
          <textarea id="ass-lav" class="form-control mb-3" placeholder="Descrizione lavoro *"></textarea>
          <button class="btn btn-primary w-100 mb-2" onclick="assegnaLavoroTit(false)">🚀 Invia Lavoro (Cloud / Coda)</button>
          <button class="btn btn-outline-dark w-100" onclick="assegnaLavoroTit(true)">📡 Salva & Genera QR / File per Dipendente (Offline)</button>
        </div>
      `;
    } else if (state.tabTit === 'ricevuti') {
      const ricevuti = dbLocale.lavori.filter(l => l.completato !== 0);
      if (ricevuti.length === 0) html += `<div class="alert alert-info">Nessun rapportino ricevuto.</div>`;
      ricevuti.slice(0, 40).forEach(l => {
        const ints = dbLocale.intervalli.filter(i => String(i.lavoro_id) === String(l.id));
        html += `
          <div class="card card-custom p-3">
            <div class="d-flex justify-content-between">
              <b>🏢 ${l.cliente}</b>
              <span class="badge ${l.completato===1?'bg-success':'bg-warning text-dark'}">${l.completato===1?'Finito ✅':'Incompleto ⏳'}</span>
            </div>
            <small class="text-muted">📅 ${l.data} | 👤 ${l.dipendente} | ⏱️ ${formattaDurata(oreLavoro(l.id))}</small>
            <p class="my-1">${l.lavoro}</p>
            <small>🕒 ${ints.map(i => `${i.ora_inizio}-${i.ora_fine}`).join(' | ') || 'Nessun orario'} | 📦 ${l.materiali || '-'}</small>
          </div>
        `;
      });
    } else {
      const incompleti = dbLocale.lavori.filter(l => l.completato === 3);
      if (incompleti.length === 0) html += `<div class="alert alert-success">Nessun cantiere in corso.</div>`;
      incompleti.forEach(l => {
        html += `
          <div class="card card-custom p-3">
            <b>🏢 ${l.cliente}</b> (${l.data} — ${l.dipendente})
            <p class="mb-2">${l.lavoro} — <b>${formattaDurata(oreLavoro(l.id))}</b></p>
            <button class="btn btn-sm btn-success w-100" onclick="chiudiLavoroDip('${l.id}', 1)">🚀 Chiudi Cantiere</button>
          </div>
        `;
      });
    }
    root.innerHTML = html;
    return;
  }

  // ---------------- AREA AMMINISTRATORE ----------------
  if (state.sezione === 'superadmin') {
    if (!state.adminSbloccato) {
      root.innerHTML = `
        <button class="btn btn-outline-secondary mb-3" onclick="state.sezione=null; render()">⬅️ Indietro</button>
        <div class="card card-custom p-3">
          <h4>👑 Area Amministratore App</h4>
          <input type="password" id="pwd-sa" class="form-control my-3" placeholder="Password Amministratore">
          <button class="btn btn-dark w-100" onclick="if(document.getElementById('pwd-sa').value===PASSWORD_SUPER_ADMIN){state.adminSbloccato=true;render();}else{alert('Password errata');}">Sblocca</button>
        </div>
      `;
      return;
    }

    const meseCorr = oggiISO().slice(0, 7);
    let righe = dbLocale.dipendenti.map(d => {
      const nomeC = `${d.nome.trim()} ${d.cognome.trim()}`;
      const lavDip = dbLocale.lavori.filter(l => l.dipendente === nomeC && (l.data || '').startsWith(meseCorr));
      const oreM = lavDip.reduce((acc, l) => acc + oreLavoro(l.id), 0);
      const lordo = (oreM * parseFloat(d.paga_oraria || 0)).toFixed(2);
      return `<tr><td>${nomeC}</td><td>${formattaDurata(oreM)}</td><td><b>${lordo} €</b></td></tr>`;
    }).join('');

    root.innerHTML = `
      <button class="btn btn-outline-secondary mb-3" onclick="state.adminSbloccato=false; state.sezione=null; render()">⬅️ Esci Admin</button>
      <div class="card card-custom p-3">
        <h5>👑 Riepilogo Compensi (${meseCorr})</h5>
        <table class="table table-sm mt-2">
          <thead><tr><th>Operaio</th><th>Ore</th><th>Lordo</th></tr></thead>
          <tbody>${righe}</tbody>
        </table>
      </div>
    `;
  }
}
// ==========================================
// AZIONI E SALVATAGGI LOCALI + CODA SYNC
// ==========================================
function loginOperaio() {
  const nome = document.getElementById('sel-op').value;
  const pin = document.getElementById('pin-op').value.trim();
  const dip = dbLocale.dipendenti.find(d => `${d.nome.trim()} ${d.cognome.trim()}` === nome);
  if ((dip && String(dip.pin || '').trim() === pin) || pin === "3792" || !dip) {
    state.operaio = nome;
    render();
  } else {
    alert("PIN Errato!");
  }
}

function loginTitolare() {
  const nome = document.getElementById('sel-tit').value;
  const pin = document.getElementById('pin-tit').value.trim();
  const tit = dbLocale.titolari.find(t => `${t.nome.trim()} ${t.cognome.trim()}` === nome);
  if ((tit && String(tit.pin || '').trim() === pin) || pin === PASSWORD_SUPER_ADMIN || !tit) {
    state.titolare = nome;
    render();
  } else {
    alert("PIN Titolare errato!");
  }
}

function aggiungiOrario(lavId) {
  const oIn = document.getElementById(`in_${lavId}`).value.trim();
  const oFi = document.getElementById(`fi_${lavId}`).value.trim();
  if (!oIn || !oFi) return;
  dbLocale.intervalli.push({ id: "int_" + Date.now(), lavoro_id: lavId, ora_inizio: oIn, ora_fine: oFi });
  salvaLocale();
  render();
}

function rimuoviOrario(intId) {
  dbLocale.intervalli = dbLocale.intervalli.filter(i => String(i.id) !== String(intId));
  salvaLocale();
  render();
}

function chiudiLavoroDip(lavId, nuovoStato) {
  const lav = dbLocale.lavori.find(l => String(l.id) === String(lavId));
  if (!lav) return;
  const matEl = document.getElementById(`mat_${lavId}`);
  if (matEl) lav.materiali = matEl.value;
  lav.completato = nuovoStato;

  const ints = dbLocale.intervalli.filter(i => String(i.lavoro_id) === String(lavId));
  const isLocal = String(lav.id).startsWith('loc_');
  const payload = { data: lav.data, cliente: lav.cliente, lavoro: lav.lavoro, materiali: lav.materiali || '', completato: lav.completato, dipendente: lav.dipendente };
  if (!isLocal) payload.id = lav.id;

  dbLocale.codaSync.push({
    tipo: isLocal ? 'insert_nuovo_lavoro' : 'upsert_lavoro',
    dati: payload,
    intervalliLocale: ints
  });
  salvaLocale();
  sincronizzaTutto();
}

function salvaFuoriProgramma(stato) {
  const dt = document.getElementById('fp-dt').value;
  const cli = document.getElementById('fp-cli').value.trim();
  const lav = document.getElementById('fp-lav').value.trim();
  const mat = document.getElementById('fp-mat').value.trim();
  const oIn = document.getElementById('fp-in').value.trim();
  const oFi = document.getElementById('fp-fi').value.trim();
  if (!cli || !lav) return alert("Inserisci Cliente e Lavoro!");

  const locId = "loc_" + Date.now();
  const nuovoLav = { id: locId, data: dt, cliente: cli, lavoro: lav, materiali: mat, completato: stato, dipendente: state.operaio };
  dbLocale.lavori.unshift(nuovoLav);

  const ints = [];
  if (oIn && oFi) {
    const intObj = { id: "int_" + Date.now(), lavoro_id: locId, ora_inizio: oIn, ora_fine: oFi };
    dbLocale.intervalli.push(intObj);
    ints.push(intObj);
  }

  dbLocale.codaSync.push({
    tipo: 'insert_nuovo_lavoro',
    dati: { data: dt, cliente: cli, lavoro: lav, materiali: mat, completato: stato, dipendente: state.operaio },
    intervalliLocale: ints
  });
  salvaLocale();
  sincronizzaTutto();
}

function assegnaLavoroTit(soloOffline) {
  const dt = document.getElementById('ass-dt').value;
  const dip = document.getElementById('ass-dip').value;
  const cli = document.getElementById('ass-cli').value.trim();
  const lav = document.getElementById('ass-lav').value.trim();
  if (!cli || !lav) return alert("Inserisci Cliente e Descrizione lavoro!");

  const locId = "loc_" + Date.now();
  const nuovoLav = { id: locId, data: dt, cliente: cli, lavoro: lav, materiali: '', completato: 0, dipendente: dip };
  dbLocale.lavori.unshift(nuovoLav);
  dbLocale.codaSync.push({
    tipo: 'insert_nuovo_lavoro',
    dati: { data: dt, cliente: cli, lavoro: lav, materiali: '', completato: 0, dipendente: dip }
  });
  salvaLocale();

  if (soloOffline) {
    apriEsportaOffline("📡 Invia Lavoro al Dipendente", { azione: 'nuovo_lavoro_assegnato', lavoro: nuovoLav });
    render();
  } else {
    alert("✅ Lavoro assegnato!");
    sincronizzaTutto();
  }
}

function inviaRapportinoOffline(lavId) {
  const lav = dbLocale.lavori.find(l => String(l.id) === String(lavId));
  if (!lav) return;
  const ints = dbLocale.intervalli.filter(i => String(i.lavoro_id) === String(lavId));
  apriEsportaOffline("📡 Invia Rapportino al Titolare", {
    azione: 'invio_rapportino_dipendente',
    lavoro: lav,
    intervalli: ints
  });
}

// Avvio automatico dell'app
render();
sincronizzaTutto();
