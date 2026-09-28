/**
 * CONSULTA ÀS BASES OPERACIONAIS - ALERTA DE CLIMA EXTREMO EM TEMPO REAL
 * Atualização periódica automática a cada 5 minutos (300 segundos)
 */

// Cores das regionais operacionais
const REGIONAL_COLORS = {
  "OPC": { bg: "bg-blue-600/20", border: "border-blue-500/50", text: "text-blue-400", badgeBg: "bg-blue-900/60", badgeText: "text-blue-200", hexColor: "#2563eb" },
  "OPNS": { bg: "bg-amber-600/20", border: "border-amber-500/50", text: "text-amber-400", badgeBg: "bg-amber-900/60", badgeText: "text-amber-200", hexColor: "#d97706" },
  "OPN": { bg: "bg-purple-600/20", border: "border-purple-500/50", text: "text-purple-400", badgeBg: "bg-purple-900/60", badgeText: "text-purple-200", hexColor: "#9333ea" },
  "OPSUL": { bg: "bg-emerald-600/20", border: "border-emerald-500/50", text: "text-emerald-400", badgeBg: "bg-emerald-900/60", badgeText: "text-emerald-200", hexColor: "#10b981" }
};

let suspendPopups = false;
let activeAlertBaseIds = new Set();
let currentAlertBaseId = null;
let defenseCivilAlertsInitialized = false;
let audioContext = null;
let alertOscillator = null;

// Calendário Agrícola (2026-2030)
const CROP_CALENDAR_DATA = [];

// Dados completos das bases operacionais
const BASE_OPERATIONAL_DATA_TSV = '';

const DEFAULT_OPERATIONAL_CENTERS = [];

function mergeOperationalCenters(savedCenters) {
  if (!Array.isArray(savedCenters)) return [];
  return savedCenters.filter(Boolean);
}

let operationalCenters = [];
window.operationalCenters = operationalCenters;

// Mapeamento cidade/UF para cada base
const BASE_CITY_MAP = {};

let inmetWeatherByBase = {};
window.inmetWeatherByBase = inmetWeatherByBase;

let currentRegionalFilter = "ALL";
let map = null;
let markersLayerGroup = null;

let REGIONAL_MANAGERS = {
  "OPC": { descricao: "Operações Centro-Oeste e Minas Gerais" },
  "OPNS": { descricao: "Operações Nordeste Setentrional e Oriental" },
  "OPN": { descricao: "Operações Norte e Amazônia" },
  "OPSUL": { descricao: "Operações Sul e Sudeste Litoral" }
};

let systemNotes = [];

// =========================================================================
// CRONÔMETRO DE ATUALIZAÇÃO AUTOMÁTICA A CADA 5 MINUTOS (300 SEGUNDOS)
// =========================================================================
const FIVE_MINUTES_SECONDS = 300;
let refreshCountdownSeconds = FIVE_MINUTES_SECONDS;
let weatherSyncTimer = null;
let countdownTimer = null;
let lastSyncTimestamp = new Date();

function start5MinuteSyncScheduler() {
  if (weatherSyncTimer) clearInterval(weatherSyncTimer);
  if (countdownTimer) clearInterval(countdownTimer);

  refreshCountdownSeconds = FIVE_MINUTES_SECONDS;
  updateCountdownDisplay();

  // Contador segundo a segundo
  countdownTimer = setInterval(() => {
    refreshCountdownSeconds--;
    if (refreshCountdownSeconds <= 0) {
      refreshCountdownSeconds = FIVE_MINUTES_SECONDS;
      triggerFullWeatherSync({ isAuto: true });
    }
    updateCountdownDisplay();
  }, 1000);

  // Gatilho principal de 5 minutos
  weatherSyncTimer = setInterval(() => {
    triggerFullWeatherSync({ isAuto: true });
  }, FIVE_MINUTES_SECONDS * 1000);
}

function updateCountdownDisplay() {
  const mins = Math.floor(refreshCountdownSeconds / 60);
  const secs = refreshCountdownSeconds % 60;
  const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  const headerBadge = document.getElementById('headerSyncCountdown');
  if (headerBadge) {
    headerBadge.textContent = `Atualização climática automática a cada 5 min (${timeStr})`;
  }

  const sidebarBadge = document.getElementById('sidebarTimerBadge');
  if (sidebarBadge) {
    sidebarBadge.textContent = timeStr;
  }

  const floatingBadge = document.getElementById('floatingPanelSyncCountdown');
  if (floatingBadge) {
    floatingBadge.textContent = `Sincroniza em ${timeStr}`;
  }
}

// Disparo imediato manual
window.triggerImmediate5MinRefresh = function() {
  refreshCountdownSeconds = FIVE_MINUTES_SECONDS;
  updateCountdownDisplay();
  triggerFullWeatherSync({ isAuto: false });
};

async function triggerFullWeatherSync({ isAuto = false } = {}) {
  const btn = document.getElementById('manualRefreshWeatherBtn');
  const btnIcon = document.getElementById('refreshWeatherBtnIcon');
  const btnText = document.getElementById('refreshWeatherBtnText');

  if (btn) btn.classList.add('opacity-75');
  if (btnIcon) btnIcon.classList.add('animate-spin');
  if (btnText) btnText.textContent = 'Atualizando...';

  try {
    // 1. Atualiza Alertas Oficiais INMET e Defesa Civil
    await refreshDefesaCivilAlerts();

    // 2. Atualiza Previsões em Tempo Real das bases e diagnóstico de extremos
    await syncRealtimeWeatherAndExtremeThresholds();

    // 3. Renderiza a barra lateral (SEM "NÃO INFORMADO"), mapa e painéis
    renderInmetWeatherNews();
    renderCenters();
    renderInmetAlertFloatingPanel();

    lastSyncTimestamp = new Date();
    const timeFormatted = lastSyncTimestamp.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    
    const statusEl = document.getElementById('defesaCivilNewsStatus');
    if (statusEl) {
      const alertCount = activeAlertBaseIds.size;
      statusEl.innerHTML = alertCount > 0
        ? `<span class="text-red-500 font-extrabold">🚨 ${alertCount} em alerta</span> • ${timeFormatted}`
        : `<span class="text-emerald-500 font-bold">🟢 Todas normais</span> • ${timeFormatted}`;
    }

    const lastUpdEl = document.getElementById('inmetSummaryLastUpdate');
    if (lastUpdEl) {
      lastUpdEl.textContent = `Atualizado às ${timeFormatted}`;
    }
  } catch (err) {
    console.warn('Erro durante a sincronização climática de 5 minutos:', err);
  } finally {
    if (btn) btn.classList.remove('opacity-75');
    if (btnIcon) btnIcon.classList.remove('animate-spin');
    if (btnText) btnText.textContent = 'Atualizar Clima (5m)';
  }
}

// =========================================================================
// MONITORAMENTO EM TEMPO REAL: INMET, DEFESA CIVIL E OPEN-METEO
// =========================================================================

function escapeHtmlSafe(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function normalizeText(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function normalizeSeverity(value) {
  const v = normalizeText(value);
  if (v.includes('vermelho') || v.includes('extreme') || v.includes('grande perigo') || v.includes('muito alto')) return 'VERMELHO';
  if (v.includes('amarelo') || v.includes('moderate') || v.includes('perigo potencial')) return 'AMARELO';
  if (v.includes('laranja') || v.includes('severe') || v.includes('perigo')) return 'LARANJA';
  return '';
}

function severityRank(value) {
  return ({ 'VERMELHO': 3, 'LARANJA': 2, 'AMARELO': 1 })[normalizeSeverity(value)] || 0;
}

function severityLabel(value) {
  const s = normalizeSeverity(value);
  return s === 'VERMELHO' ? 'GRANDE PERIGO' : s === 'LARANJA' ? 'PERIGO' : s === 'AMARELO' ? 'PERIGO POTENCIAL' : 'MONITORAMENTO NORMAL';
}

function getBaseCityInfo(base) {
  const raw = BASE_CITY_MAP[base?.centroVirtual];
  if (!raw) return { base: base?.base || 'Base', city: null, uf: null, display: 'Localidade Operacional' };
  return { base: raw[0], city: raw[1], uf: raw[2], display: raw[1] && raw[2] ? `${raw[1]} - ${raw[2]}` : 'Localidade Operacional' };
}

// Sincronização de Alertas INMET via API interna `/api/weather/alerts`
async function refreshDefesaCivilAlerts() {
  try {
    let alerts = [];
    
    // Tenta primeiro o servidor local (sem problemas de CORS)
    try {
      const resp = await fetch('/api/weather/alerts', { cache: 'no-store' });
      if (resp.ok) {
        const json = await resp.json();
        if (json.data) {
          alerts = flattenAndNormalizeAlerts(json.data);
        }
      }
    } catch (e) {
      console.warn('API local /api/weather/alerts indisponível, tentando fallback...', e);
    }

    // Se a API não retornou alertas, tenta fallback público
    if (alerts.length === 0) {
      try {
        const res = await fetch('https://apiprevmet3.inmet.gov.br/avisos/ativos', { cache: 'no-store' });
        if (res.ok) {
          const payload = await res.json();
          alerts = flattenAndNormalizeAlerts(payload);
        }
      } catch (_) {}
    }

    applyLiveAlertsToBases(alerts);
  } catch (err) {
    console.warn('Erro ao atualizar alertas Defesa Civil / INMET:', err);
  }
}

function flattenAndNormalizeAlerts(payload) {
  if (!payload) return [];
  const list = Array.isArray(payload) ? payload : (payload.data || payload.avisos || [payload]);
  return list.map(raw => {
    const sev = normalizeSeverity(raw.severidade || raw.severity || raw.nivel || '');
    return {
      id: raw.id || raw.identifier || `alert-${Math.random()}`,
      evento: raw.evento || raw.event || raw.tipo || 'Alerta Meteorológico',
      descricao: raw.descricao || raw.description || 'Condições meteorológicas adversas previstas.',
      severidade: sev,
      severidadeLabel: severityLabel(sev),
      areas: Array.isArray(raw.areas) ? raw.areas : [String(raw.areas || raw.municipios || '')],
      expires: raw.expires || raw.fim || null
    };
  }).filter(a => a.severidade !== '');
}

function applyLiveAlertsToBases(alerts) {
  const previousAlertIds = new Set(activeAlertBaseIds);
  const now = new Date().toISOString();

  operationalCenters.forEach(base => {
    const info = getBaseCityInfo(base);
    const baseText = normalizeText(`${base.base} ${base.endereco} ${info.city} ${info.uf}`);

    const matching = alerts.filter(alert => {
      const areasJoined = normalizeText(alert.areas.join(' '));
      return (info.city && areasJoined.includes(normalizeText(info.city))) ||
             (info.uf && areasJoined.includes(normalizeText(info.uf))) ||
             areasJoined.includes(normalizeText(base.base));
    });

    if (matching.length > 0) {
      matching.sort((a, b) => severityRank(b.severidade) - severityRank(a.severidade));
      const top = matching[0];
      base.climaExtremo = {
        ativo: true,
        tipo: top.evento,
        descricao: top.descricao,
        severidade: top.severidade,
        severidadeLabel: top.severidadeLabel,
        atualizadoEm: now,
        expires: top.expires,
        fonte: 'INMET / Defesa Civil'
      };
    } else if (base.climaExtremo && base.climaExtremo.fonte === 'INMET / Defesa Civil') {
      delete base.climaExtremo;
    }
  });

  activeAlertBaseIds = new Set(operationalCenters.filter(b => b.climaExtremo && b.climaExtremo.ativo).map(b => b.id));

  // Alerta sonoro / visual se houver novas bases em perigo
  const newAlerts = operationalCenters.filter(b => b.climaExtremo?.ativo && !previousAlertIds.has(b.id));
  if (newAlerts.length > 0 && defenseCivilAlertsInitialized && !suspendPopups) {
    showNewAlertsPopup(newAlerts);
  }
  defenseCivilAlertsInitialized = true;
}

// Sincronização de previsão em tempo real para todas as bases
async function syncRealtimeWeatherAndExtremeThresholds() {
  try {
    // Consulta lote no servidor
    const payloadBases = operationalCenters.map(b => ({ id: b.id, lat: b.lat, lng: b.lng }));
    let batchResults = [];

    try {
      const resp = await fetch('/api/weather/realtime-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bases: payloadBases })
      });
      if (resp.ok) {
        const json = await resp.json();
        batchResults = json.results || [];
      }
    } catch (_) {}

    // Aplica os resultados nos registros das bases
    batchResults.forEach(res => {
      const base = operationalCenters.find(b => b.id === res.baseId);
      if (!base) return;

      const c = res.current || {};
      const weatherDesc = weatherCodeToDescription(c.weatherCode);

      // Armazena dados meteorológicos completos
      inmetWeatherByBase[base.id] = {
        condition: weatherDesc,
        temperature: c.temperature,
        apparent: c.apparentTemperature,
        humidity: c.humidity,
        wind: c.windSpeed,
        windGusts: c.windGusts,
        precipitation: c.precipitation,
        summary: `Temp: ${Math.round(c.temperature)}°C • ${weatherDesc} • Vento: ${Math.round(c.windSpeed)} km/h • Umidade: ${Math.round(c.humidity)}%`,
        periods: res.periods || inmetWeatherByBase[base.id]?.periods || null,
        updatedAt: new Date().toISOString()
      };

      // Se detectou clima extremo em tempo real (vento, chuva torrencial, tempestade)
      if (res.isExtreme && (!base.climaExtremo || severityRank(res.extremeSeverity) >= severityRank(base.climaExtremo.severidade))) {
        base.climaExtremo = {
          ativo: true,
          tipo: res.extremeType,
          descricao: res.extremeDesc,
          severidade: res.extremeSeverity,
          severidadeLabel: severityLabel(res.extremeSeverity),
          atualizadoEm: new Date().toISOString(),
          fonte: 'Detecção em Tempo Real (Open-Meteo / Estação Local)'
        };
        activeAlertBaseIds.add(base.id);
      }
    });

    // Atualiza popup que estiver eventualmente aberto no mapa
    updateCurrentlyOpenPopupWeather();
  } catch (err) {
    console.warn('Erro ao consultar condições meteorológicas em tempo real:', err);
  }
}

function weatherCodeToDescription(code) {
  const c = Number(code);
  if (c === 0) return "Céu Limpo";
  if (c === 1) return "Predominantemente Limpo";
  if (c === 2) return "Parcialmente Nublado";
  if (c === 3) return "Encoberto";
  if ([45, 48].includes(c)) return "Neblina / Nevoeiro";
  if ([51, 53, 55].includes(c)) return "Garoa";
  if ([61, 63, 65].includes(c)) return "Chuva Moderada / Forte";
  if ([80, 81, 82].includes(c)) return "Pancadas de Chuva";
  if ([95, 96, 99].includes(c)) return "Tempestade com Raios";
  return "Condições Estáveis";
}

// =========================================================================
// RENDERIZAÇÃO DA BARRA ROLANTE LATERAL DIREITA: SEM "NÃO INFORMADO"
// =========================================================================
function renderInmetWeatherNews() {
  const container = document.getElementById('newsContainer');
  if (!container) return;

  const cards = operationalCenters.map(base => {
    const info = getBaseCityInfo(base);
    const weather = inmetWeatherByBase[base.id];
    const alert = base.climaExtremo;
    const hasAlert = alert && alert.ativo;

    let badgeText = '';
    let badgeColorClass = '';
    let cardBorderClass = '';
    let alertBannerHtml = '';
    let summaryText = '';

    if (hasAlert) {
      const sev = alert.severidade || 'LARANJA';
      if (sev === 'VERMELHO') {
        badgeText = `🚨 ALERTA: ${alert.tipo.toUpperCase()} (GRANDE PERIGO)`;
        badgeColorClass = 'bg-red-600 text-white font-black animate-pulse';
        cardBorderClass = 'severity-red border-red-500';
      } else if (sev === 'LARANJA') {
        badgeText = `⚠️ ALERTA: ${alert.tipo.toUpperCase()} (PERIGO)`;
        badgeColorClass = 'bg-orange-600 text-white font-black';
        cardBorderClass = 'severity-orange border-orange-500';
      } else {
        badgeText = `⚡ AVISO: ${alert.tipo.toUpperCase()}`;
        badgeColorClass = 'bg-amber-500 text-slate-950 font-black';
        cardBorderClass = 'severity-yellow border-amber-400';
      }

      alertBannerHtml = `
        <div class="mt-1.5 p-2 rounded-lg bg-red-600/15 border border-red-500/40 text-red-700 dark:text-red-300 space-y-0.5 text-[9px] font-semibold">
          <div class="flex items-center gap-1 font-bold">
            <i data-lucide="triangle-alert" class="w-3.5 h-3.5 text-red-500"></i>
            <span>AVISO DE CLIMA EXTREMO EMITIDO</span>
          </div>
          <p class="leading-tight">${escapeHtmlSafe(alert.descricao || 'Risco de chuvas e ventos fortes na localidade.')}</p>
        </div>
      `;

      summaryText = weather?.summary
        ? `${weather.summary} • Atenção redobrada nas operações de pátio.`
        : `Condições meteorológicas adversas registradas pelo INMET / Defesa Civil.`;
    } else {
      // NUNCA "NÃO INFORMADO": Mostra status monitorado positivo com métricas em tempo real
      badgeText = '🟢 CLIMA MONITORADO • SEM ALERTA ATIVO';
      badgeColorClass = 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40 font-bold';
      cardBorderClass = 'severity-none border-emerald-500/40';

      summaryText = weather?.summary ||
        `Condições meteorológicas monitoradas a cada 5 min • Operação em padrão regular na localidade de ${escapeHtmlSafe(info.display)}.`;
    }

    const cityLabel = info.display;

    return {
      base,
      info,
      weather,
      hasAlert,
      badgeText,
      badgeColorClass,
      cardBorderClass,
      alertBannerHtml,
      summaryText,
      cityLabel
    };
  });

  // Ordena para que bases com alertas fiquem no topo da rolagem!
  cards.sort((a, b) => {
    if (a.hasAlert && !b.hasAlert) return -1;
    if (!a.hasAlert && b.hasAlert) return 1;
    return a.base.base.localeCompare(b.base.base);
  });

  container.innerHTML = '';

  // Duplicação para permitir a rolagem infinita suave sem salto visual
  const renderList = [...cards, ...cards];

  renderList.forEach(item => {
    const card = document.createElement('div');
    card.onclick = () => focusBaseOnMap(item.base.id);
    card.className = `block p-3 rounded-xl border bg-white dark:bg-slate-800/90 hover:border-red-400 transition-all space-y-1.5 shadow-sm shrink-0 cursor-pointer inmet-weather-card ${item.cardBorderClass}`;

    card.innerHTML = `
      <div class="flex items-start justify-between gap-2">
        <div>
          <div class="inmet-city-title text-slate-900 dark:text-white flex items-center gap-1.5">
            <span>${escapeHtmlSafe(item.base.base)}</span>
            <span class="text-[9px] font-mono opacity-60">(${escapeHtmlSafe(item.base.centroVirtual)})</span>
          </div>
          <div class="text-[10px] font-semibold text-slate-500 dark:text-slate-300">
            ${escapeHtmlSafe(item.cityLabel)}
          </div>
        </div>
        <span class="text-[8px] uppercase px-2 py-0.5 rounded-md ${item.badgeColorClass}">
          ${escapeHtmlSafe(item.badgeText)}
        </span>
      </div>

      ${item.alertBannerHtml}

      <p class="inmet-weather-summary text-slate-700 dark:text-slate-200 mt-1">
        ${escapeHtmlSafe(item.summaryText)}
      </p>

      <div class="flex items-center justify-between text-[8px] text-slate-400 dark:text-slate-500 pt-1 border-t border-slate-100 dark:border-slate-800">
        <span>Ciclo de 5 min • Fonte: INMET / Open-Meteo</span>
        <span class="text-emerald-600 dark:text-emerald-400 font-bold">Clique para ver no mapa</span>
      </div>
    `;

    container.appendChild(card);
  });

  // Atualiza badge de contagem de alertas no painel esquerdo
  const alertCount = operationalCenters.filter(b => b.climaExtremo && b.climaExtremo.ativo).length;
  const alertBadge = document.getElementById('activeAlertCountBadge');
  if (alertBadge) {
    if (alertCount > 0) {
      alertBadge.textContent = `${alertCount} em alerta`;
      alertBadge.classList.remove('hidden');
    } else {
      alertBadge.classList.add('hidden');
    }
  }

  // Atualiza painel flutuante
  const floatingAlertsCount = document.getElementById('inmetSummaryAlertsCount');
  if (floatingAlertsCount) floatingAlertsCount.textContent = alertCount;

  lucide.createIcons();
}

// =========================================================================
// SISTEMA DE ALERTA VISUAL E SONORO
// =========================================================================

function showNewAlertsPopup(newAlerts) {
  if (suspendPopups || newAlerts.length === 0) return;
  currentAlertBaseId = newAlerts[0].id;
  const details = newAlerts.slice(0, 3).map(base =>
    `${base.base} (${base.climaExtremo.tipo || 'Clima severo'})`
  ).join(' • ');
  const remainder = newAlerts.length > 3 ? ` e mais ${newAlerts.length - 3} base(s)` : '';

  const titleEl = document.getElementById('extremeAlertTitle');
  const bodyEl = document.getElementById('extremeAlertBody');
  const boxEl = document.getElementById('extremeAlertBox');

  if (titleEl) titleEl.innerText = `${newAlerts.length} BASE${newAlerts.length > 1 ? 'S' : ''} EM ALERTA EXTREMO`;
  if (bodyEl) bodyEl.innerText = `Aviso em tempo real: ${details}${remainder}. Clique aqui para localizar no mapa.`;
  if (boxEl) boxEl.classList.remove('hidden');

  startContinuousAlertSound();
  speakVoiceAlert(newAlerts[0]);
}

function speakVoiceAlert(base) {
  try {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(
      `Atenção: Alerta de clima extremo para a ${base.base}. ${base.climaExtremo.tipo}. Siga as orientações de segurança.`
    );
    utterance.lang = 'pt-BR';
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  } catch (_) {}
}

function startContinuousAlertSound() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!audioContext) audioContext = new AudioContextClass();
    if (audioContext.state === 'suspended') audioContext.resume();
    if (alertOscillator) return;

    alertOscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    alertOscillator.type = 'sawtooth';
    alertOscillator.frequency.setValueAtTime(750, audioContext.currentTime);

    let high = true;
    const interval = setInterval(() => {
      if (alertOscillator) {
        alertOscillator.frequency.setValueAtTime(high ? 900 : 600, audioContext.currentTime);
        high = !high;
      } else {
        clearInterval(interval);
      }
    }, 300);

    gainNode.gain.setValueAtTime(0.15, audioContext.currentTime);
    alertOscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    alertOscillator.start();
  } catch (_) {}
}

function stopContinuousAlertSound() {
  if (alertOscillator) {
    try { alertOscillator.stop(); alertOscillator.disconnect(); } catch (_) {}
    alertOscillator = null;
  }
}

window.goToAlertBaseLocation = function() {
  if (currentAlertBaseId) {
    focusBaseOnMap(currentAlertBaseId);
    closeExtremeAlertBox();
  }
};

window.closeExtremeAlertBox = function() {
  const box = document.getElementById('extremeAlertBox');
  if (box) box.classList.add('hidden');
  stopContinuousAlertSound();
};

window.toggleAlertPopups = function() {
  suspendPopups = !suspendPopups;
  const text = document.getElementById('dropdownToggleAlertPopupsText');
  if (text) text.innerText = suspendPopups ? "Reativar Pop-ups" : "Suspender Pop-ups";
  if (suspendPopups) closeExtremeAlertBox();
};

// =========================================================================
// MAPA E PINOS COM INDICADORES DE ALERTA EXTREMO
// =========================================================================

function initMap() {
  const osmStandard = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 });
  map = L.map('map', { center: [-15.798, -47.975], zoom: 4, layers: [osmStandard] });
  markersLayerGroup = L.layerGroup().addTo(map);

  map.on('popupopen', function(e) {
    const popupEl = e.popup.getElement();
    if (!popupEl) return;
    const weatherEl = popupEl.querySelector('.map-popup-weather');
    if (weatherEl) {
      const baseId = weatherEl.getAttribute('data-base-id');
      const lat = weatherEl.getAttribute('data-weather-lat');
      const lng = weatherEl.getAttribute('data-weather-lng');
      fetchAndPopulatePopupWeather(weatherEl, baseId, lat, lng);
    }
    lucide.createIcons();
  });
}

function updateCurrentlyOpenPopupWeather() {
  if (!map) return;
  const weatherEl = document.querySelector('.leaflet-popup .map-popup-weather');
  if (weatherEl) {
    const baseId = weatherEl.getAttribute('data-base-id');
    const lat = weatherEl.getAttribute('data-weather-lat');
    const lng = weatherEl.getAttribute('data-weather-lng');
    fetchAndPopulatePopupWeather(weatherEl, baseId, lat, lng);
  }
}

async function fetchAndPopulatePopupWeather(containerEl, baseId, lat, lng) {
  if (!containerEl) return;
  const cached = inmetWeatherByBase[baseId];
  if (cached && cached.periods) {
    applyPeriodsToElement(containerEl, cached.periods, cached.temperature);
    return;
  }

  try {
    const resp = await fetch(`/api/weather/base?lat=${lat}&lng=${lng}&id=${baseId}`);
    if (resp.ok) {
      const data = await resp.json();
      if (data && data.periods) {
        if (!inmetWeatherByBase[baseId]) inmetWeatherByBase[baseId] = {};
        inmetWeatherByBase[baseId].periods = data.periods;
        if (data.current) {
          inmetWeatherByBase[baseId].temperature = data.current.temperature;
        }
        applyPeriodsToElement(containerEl, data.periods, data.current?.temperature);
      }
    }
  } catch (err) {
    console.warn('Erro ao atualizar previsão no popup:', err);
  }
}

function applyPeriodsToElement(containerEl, periods, temp) {
  if (!containerEl || !periods) return;
  const mad = containerEl.querySelector('.mw-madrugada');
  const man = containerEl.querySelector('.mw-manha');
  const tar = containerEl.querySelector('.mw-tarde');
  const noi = containerEl.querySelector('.mw-noite');
  const statusEl = containerEl.querySelector('.map-popup-weather-status');

  if (mad && periods.madrugada) mad.textContent = periods.madrugada;
  if (man && periods.manha) man.textContent = periods.manha;
  if (tar && periods.tarde) tar.textContent = periods.tarde;
  if (noi && periods.noite) noi.textContent = periods.noite;

  if (statusEl) {
    statusEl.textContent = temp !== undefined ? `${Math.round(temp)}°C • Atualizado` : 'Atualizado';
  }
}

function createCustomMarkerIcon(item) {
  const regColor = REGIONAL_COLORS[item.regional] || { hexColor: "#10b981" };
  const displaySigla = item.centroVirtual || item.centro || "BASE";
  const hasAlert = activeAlertBaseIds.has(item.id) || (item.climaExtremo && item.climaExtremo.ativo);
  const alertSeverity = normalizeSeverity(item.climaExtremo?.severidade || '');
  const alertColor = alertSeverity === 'VERMELHO' ? '#ef4444' : alertSeverity === 'LARANJA' ? '#f97316' : '#facc15';
  const alertGlow = alertSeverity === 'VERMELHO' ? 'rgba(239,68,68,.9)' : 'rgba(249,115,22,.9)';

  const alertDotHtml = hasAlert
    ? `<span class="alert-dot-indicator" title="ALERTA ATIVO: ${escapeHtmlSafe(item.climaExtremo?.tipo || 'Clima Extremo')}" style="background-color:${alertColor};--weather-glow:${alertGlow};"></span>`
    : '';

  const html = `
    <div class="relative flex flex-col items-center group" data-base="${escapeHtmlSafe(item.id)}">
      <div class="flex items-center gap-1">
        <div class="px-1.5 py-0.5 text-[10px] font-black rounded-md text-white shadow-md border border-white/40 uppercase whitespace-nowrap tracking-tighter" style="background-color: ${regColor.hexColor};">
          ${displaySigla}
        </div>
        ${alertDotHtml}
      </div>
      <div class="w-4 h-4 rounded-full border-2 border-white shadow-lg flex items-center justify-center animate-pulse" style="background-color: ${hasAlert ? alertColor : regColor.hexColor};">
        <div class="w-1.5 h-1.5 bg-white rounded-full"></div>
      </div>
    </div>
  `;

  return L.divIcon({ html: html, className: 'custom-base-pin', iconSize: [40, 40], iconAnchor: [20, 36] });
}

function renderCenters() {
  const listContainer = document.getElementById('centersList');
  if (!listContainer || !map) return;
  listContainer.innerHTML = '';
  markersLayerGroup.clearLayers();

  const searchVal = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();

  const filtered = operationalCenters.filter(item => {
    const matchesRegional = (currentRegionalFilter === "ALL") || (item.regional === currentRegionalFilter);
    const matchesSearch = !searchVal ||
      item.base.toLowerCase().includes(searchVal) ||
      item.centroVirtual.toLowerCase().includes(searchVal) ||
      item.centro.toLowerCase().includes(searchVal) ||
      item.supervisorLoge.toLowerCase().includes(searchVal) ||
      (item.gerenteBase && item.gerenteBase.toLowerCase().includes(searchVal));
    return matchesRegional && matchesSearch;
  });

  const counterEl = document.getElementById('centerCounter');
  if (counterEl) counterEl.innerText = `${filtered.length} bases`;

  const bounds = [];

  filtered.forEach(item => {
    const regTheme = REGIONAL_COLORS[item.regional] || REGIONAL_COLORS["OPSUL"];
    const hasAlert = activeAlertBaseIds.has(item.id) || (item.climaExtremo && item.climaExtremo.ativo);

    const card = document.createElement('div');
    card.className = `p-3 rounded-2xl border transition-all cursor-pointer bg-white dark:bg-[#0f1512] ${hasAlert ? 'border-red-500 shadow-md ring-1 ring-red-500/50' : regTheme.border} hover:border-emerald-400 shadow-sm space-y-2 relative`;
    card.onclick = () => focusBaseOnMap(item.id);



    let alertSnippetHtml = '';
    if (hasAlert) {
      alertSnippetHtml = `
        <div class="px-2 py-1 rounded-md bg-red-600/15 border border-red-500 text-red-600 dark:text-red-400 text-[10px] font-black flex items-center gap-1">
          <i data-lucide="triangle-alert" class="w-3 h-3 animate-bounce"></i>
          <span>ALERTA EXTREMO: ${escapeHtmlSafe(item.climaExtremo?.tipo || 'Aviso Ativo')}</span>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="flex items-center justify-between">
        <span class="px-2 py-0.5 rounded-lg text-[10px] font-extrabold ${regTheme.badgeBg} ${regTheme.badgeText}">
          ${item.regional} - ${item.centroVirtual}
        </span>
        <span class="text-[10px] font-mono font-bold text-gray-400">Cód: ${item.centro}</span>
      </div>
      <div>
        <h4 class="text-xs font-bold text-slate-900 dark:text-white leading-tight">${item.base}</h4>
        <p class="text-[11px] text-slate-500 dark:text-gray-400 truncate mt-0.5">${item.endereco}${item.cep ? ` • CEP ${item.cep}` : ''}</p>
      </div>
      ${alertSnippetHtml}
      <div class="pt-1.5 border-t border-slate-100 dark:border-green-900/30 flex flex-col gap-1 text-[10px]">
        <span class="text-slate-500 dark:text-gray-400 font-medium">Supervisor: <strong class="text-slate-700 dark:text-gray-200">${item.supervisorLoge || 'Não informado'}</strong></span>
        <span class="text-slate-500 dark:text-gray-400 font-medium">Ger. Base: <strong class="text-emerald-700 dark:text-emerald-400">${item.gerenteBase || 'Não informado'}</strong></span>
      </div>
    `;
    listContainer.appendChild(card);

    if (item.lat && item.lng) {
      const markerIcon = createCustomMarkerIcon(item);
      const marker = L.marker([item.lat, item.lng], { icon: markerIcon });

      let weatherAlertHtml = '';
      if (hasAlert) {
        weatherAlertHtml = `
          <div class="p-2 rounded-xl bg-red-600/20 border border-red-500 text-red-700 dark:text-red-300 space-y-1">
            <div class="flex items-center gap-1 font-bold text-[11px]">
              <i data-lucide="triangle-alert" class="w-3.5 h-3.5 text-red-500 animate-bounce"></i>
              <span>ALERTA CLIMÁTICO ATIVO: ${escapeHtmlSafe(item.climaExtremo?.tipo || 'Condição Extrema')}</span>
            </div>
            <p class="text-[10px] leading-tight">${escapeHtmlSafe(item.climaExtremo?.descricao || 'Risco de chuvas e ventos intensos.')}</p>
          </div>
        `;
      }

      // Previsão já sincronizada para esta base
      const weatherData = inmetWeatherByBase[item.id];
      const periods = weatherData?.periods || null;
      const tempVal = weatherData?.temperature !== undefined ? `${Math.round(weatherData.temperature)}°C • ` : '';
      const statusText = periods ? `${tempVal}Atualizado` : 'Sincronizando...';

      const madVal = periods?.madrugada || 'Carregando...';
      const manVal = periods?.manha || 'Carregando...';
      const tarVal = periods?.tarde || 'Carregando...';
      const noiVal = periods?.noite || 'Carregando...';

      const popupContent = `
        <div class="custom-popup text-xs space-y-2 p-1 text-slate-800 dark:text-slate-100">
          <div class="flex items-center justify-between border-b border-slate-200 dark:border-green-800/60 pb-1">
            <span class="font-extrabold text-emerald-700 dark:text-emerald-400 uppercase text-[10px] tracking-wider">${item.regional} | ${item.centroVirtual}</span>
            <span class="text-[10px] font-mono font-bold text-slate-500 dark:text-slate-400">Cód: ${item.centro}</span>
          </div>
          <div>
            <h3 class="font-extrabold text-sm leading-snug text-slate-900 dark:text-white">${item.base}</h3>
            <p class="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed mt-0.5">${item.endereco}${item.cep ? ` • CEP ${item.cep}` : ''}</p>
          </div>
          
          ${weatherAlertHtml}

          <div class="map-popup-weather" data-base-id="${item.id}" data-weather-lat="${item.lat}" data-weather-lng="${item.lng}">
            <div class="map-popup-weather-head">
              <span class="flex items-center gap-1 font-bold">
                <i data-lucide="cloud-sun" class="w-3.5 h-3.5"></i>
                <span>Previsão e Clima em Tempo Real</span>
              </span>
              <span class="map-popup-weather-status">${statusText}</span>
            </div>
            <div class="map-popup-weather-grid">
              <div><b>🌙 Madrugada</b><span class="mw-value mw-madrugada">${madVal}</span></div>
              <div><b>☀️ Manhã</b><span class="mw-value mw-manha">${manVal}</span></div>
              <div><b>🌤️ Tarde</b><span class="mw-value mw-tarde">${tarVal}</span></div>
              <div><b>🌙 Noite</b><span class="mw-value mw-noite">${noiVal}</span></div>
            </div>
            <div class="map-popup-weather-source">Fonte: INMET / Open-Meteo • Atualiza a cada 5 min</div>
          </div>

          <div class="space-y-1 pt-1.5 text-[11px] border-t border-slate-200 dark:border-green-800/60 text-slate-600 dark:text-slate-300">
            <p><strong class="text-slate-800 dark:text-white">Supervisor:</strong> ${item.supervisorLoge} (${item.contatoSupLoge})</p>
            <p><strong class="text-slate-800 dark:text-white">Gerente da Base:</strong> <span class="text-emerald-700 dark:text-emerald-400 font-bold">${item.gerenteBase}</span> (${item.contatoGerBase || 'Não informado'})</p>
          </div>
        </div>
      `;

      marker.bindPopup(popupContent, {
        className: 'custom-base-popup',
        maxWidth: 380,
        minWidth: 285,
        autoPan: true
      });
      markersLayerGroup.addLayer(marker);
      bounds.push([item.lat, item.lng]);
    }
  });

  if (currentRegionalFilter === "ALL") {
    map.fitBounds([[-34.0, -74.5], [5.5, -34.0]], { padding: [30, 30] });
  } else if (bounds.length > 0) {
    map.fitBounds(bounds, { padding: [50, 50] });
  }

  lucide.createIcons();
}

function getCropCalendarForBase(centroVirtual) {
  if (!centroVirtual) return null;
  const code = centroVirtual.toUpperCase();
  return CROP_CALENDAR_DATA.find(p => p.bases.some(b => b.toUpperCase() === code));
}

window.focusBaseOnMap = function(id) {
  const item = operationalCenters.find(b => b.id === id);
  if (item && item.lat && item.lng && map) {
    map.setView([item.lat, item.lng], 13, { animate: true });
    markersLayerGroup.eachLayer(layer => {
      if (layer.getLatLng && layer.getLatLng().lat === item.lat && layer.getLatLng().lng === item.lng) {
        layer.openPopup();
      }
    });
  }
};

window.setRegional = function(reg) {
  currentRegionalFilter = reg;
  document.querySelectorAll('.reg-btn').forEach(btn => {
    if (btn.getAttribute('data-reg') === reg) {
      btn.classList.add('ring-2', 'ring-emerald-400');
    } else {
      btn.classList.remove('ring-2', 'ring-emerald-400');
    }
  });
  renderCenters();
};

window.handleSearchInput = function() {
  renderCenters();
};

window.toggleSidebar = function() {
  const sidebar = document.getElementById('sidebarPanel');
  if (sidebar) {
    sidebar.classList.toggle('hidden');
    const textEl = document.getElementById('toggleSidebarText');
    if (textEl) textEl.innerText = sidebar.classList.contains('hidden') ? "Exibir Painel" : "Ocultar Painel";
  }
};

window.toggleNewsSidebar = function() {
  const panel = document.getElementById('newsSidebar');
  if (panel) panel.classList.toggle('hidden');
};

window.toggleFullScreen = function() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen();
  } else if (document.exitFullscreen) {
    document.exitFullscreen();
  }
};

window.toggleThemeMode = function() {
  const html = document.documentElement;
  const themeLabel = document.getElementById('themeLabel');
  const themeIcon = document.getElementById('themeIcon');
  if (html.classList.contains('dark')) {
    html.classList.remove('dark');
    if (themeLabel) themeLabel.innerText = "Modo Claro";
    if (themeIcon) themeIcon.setAttribute('data-lucide', 'sun');
  } else {
    html.classList.add('dark');
    if (themeLabel) themeLabel.innerText = "Modo Black";
    if (themeIcon) themeIcon.setAttribute('data-lucide', 'moon');
  }
  lucide.createIcons();
  renderCenters();
  renderInmetWeatherNews();
};

window.toggleHeaderButtonsMenu = function() {
  const group = document.getElementById('headerButtonsGroup');
  const icon = document.getElementById('toggleHeaderMenuIcon');
  if (group && icon) {
    if (group.classList.contains('hidden')) {
      group.classList.remove('hidden');
      icon.setAttribute('data-lucide', 'chevron-up');
    } else {
      group.classList.add('hidden');
      icon.setAttribute('data-lucide', 'chevron-down');
    }
    lucide.createIcons();
  }
};

window.toggleConfigDropdown = function(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('configDropdownMenu');
  if (menu) menu.classList.toggle('hidden');
};

// =========================================================================
// MODAIS E RECURSOS ADICIONAIS
// =========================================================================

window.openCropCalendarModal = function(centroVirtual, baseNome) {
  const polo = getCropCalendarForBase(centroVirtual);
  if (!polo) return;

  const titleEl = document.getElementById('cropCalendarModalTitle');
  const subEl = document.getElementById('cropCalendarModalSub');
  const content = document.getElementById('cropCalendarModalContent');

  if (titleEl) titleEl.innerText = `Calendário Agrícola (2026-2030) - ${baseNome}`;
  if (subEl) subEl.innerText = `Polo Agrícola: ${polo.polo}`;

  if (content) {
    content.innerHTML = `
      <div class="p-3 rounded-2xl bg-slate-100 dark:bg-black/40 border border-slate-200 dark:border-slate-800 space-y-3">
        <h4 class="text-xs font-bold text-emerald-600 dark:text-emerald-400">Culturas e Janelas Sazonais Recorrentes (2026 a 2030)</h4>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs border-collapse">
            <thead>
              <tr class="border-b border-gray-700 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-gray-300">
                <th class="p-2.5">Cultura</th>
                <th class="p-2.5">Janela Típica (Plantio / Colheita)</th>
                <th class="p-2.5">Ciclo Repetido (2026-2030)</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-800">
              ${polo.culturas.map(c => `
                <tr>
                  <td class="p-2.5 font-bold text-emerald-700 dark:text-emerald-300">${c.nome}</td>
                  <td class="p-2.5">${c.janela}</td>
                  <td class="p-2.5 font-mono text-[11px]">${c.ciclo}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  const modal = document.getElementById('cropCalendarModal');
  if (modal) modal.classList.remove('hidden');
  lucide.createIcons();
};

window.closeCropCalendarModal = function() {
  const modal = document.getElementById('cropCalendarModal');
  if (modal) modal.classList.add('hidden');
};

window.openRegionalsModal = function() {
  const grid = document.getElementById('regionalsGrid');
  if (!grid) return;
  grid.innerHTML = '';

  Object.keys(REGIONAL_MANAGERS).forEach(regKey => {
    const mgr = REGIONAL_MANAGERS[regKey];
    const card = document.createElement('div');
    card.className = "p-4 rounded-2xl bg-slate-100 dark:bg-black/40 border border-slate-200 dark:border-green-800/40 space-y-2";

    card.innerHTML = `
      <div class="flex items-center justify-between">
        <span class="font-extrabold text-emerald-600 dark:text-emerald-400 text-sm uppercase">${regKey}</span>
        <button onclick="zoomToRegionalBases('${regKey}')" class="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[10px] font-bold">
          Ver no Mapa
        </button>
      </div>
      <div class="text-xs space-y-1">
        <p><strong class="text-slate-700 dark:text-gray-300">Gerente:</strong> ${mgr.gerente}</p>
        <p><strong class="text-slate-700 dark:text-gray-300">Contato:</strong> ${mgr.contato}</p>
      </div>
    `;
    grid.appendChild(card);
  });

  const modal = document.getElementById('regionalsModal');
  if (modal) modal.classList.remove('hidden');
};

window.closeRegionalsModal = function() {
  const modal = document.getElementById('regionalsModal');
  if (modal) modal.classList.add('hidden');
};

window.zoomToRegionalBases = function(reg) {
  closeRegionalsModal();
  setRegional(reg);
};

window.openSupervisorsModal = function() {
  const grid = document.getElementById('supervisorsGrid');
  if (!grid) return;
  grid.innerHTML = '';

  operationalCenters
    .slice()
    .sort((a, b) => a.base.localeCompare(b.base, 'pt-BR'))
    .forEach(base => {
      const card = document.createElement('div');
      card.className = 'p-3 rounded-2xl bg-slate-100 dark:bg-black/40 border border-slate-200 dark:border-indigo-800/50 space-y-2';
      card.innerHTML = `
        <div class="flex items-start justify-between gap-2">
          <div>
            <p class="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase">${base.regional} • ${base.centroVirtual}</p>
            <h4 class="text-xs font-extrabold text-slate-800 dark:text-white">${base.base}</h4>
          </div>
          <button onclick="focusBaseOnMap('${base.id}'); closeSupervisorsModal()" class="p-1 text-indigo-500 hover:text-indigo-400" title="Ver no mapa"><i data-lucide="map-pin" class="w-4 h-4"></i></button>
        </div>
        <div class="pt-2 border-t border-slate-200 dark:border-slate-800 text-xs space-y-1">
          <p><strong>Supervisor:</strong> ${base.supervisorLoge || 'Não informado'}</p>
          <p><strong>Contato:</strong> ${base.contatoSupLoge || 'Não informado'}</p>
        </div>
      `;
      grid.appendChild(card);
    });

  const modal = document.getElementById('supervisorsModal');
  if (modal) modal.classList.remove('hidden');
  lucide.createIcons();
};

window.closeSupervisorsModal = function() {
  const modal = document.getElementById('supervisorsModal');
  if (modal) modal.classList.add('hidden');
};

window.filterSupervisors = function(query) {
  const q = String(query || '').trim().toLowerCase();
  const grid = document.getElementById('supervisorsGrid');
  if (!grid) return;
  Array.from(grid.children).forEach(card => {
    const haystack = (card.textContent || '').toLowerCase();
    card.style.display = (!q || haystack.includes(q)) ? '' : 'none';
  });
};

function renderInmetAlertFloatingPanel() {
  const baseCount = document.getElementById('inmetSummaryBaseCount');
  const alertCountEl = document.getElementById('inmetSummaryAlertsCount');
  const lastUpdate = document.getElementById('inmetSummaryLastUpdate');

  const alertCount = operationalCenters.filter(base => base.climaExtremo && base.climaExtremo.ativo).length;
  if (baseCount) baseCount.textContent = operationalCenters.length;
  if (alertCountEl) alertCountEl.textContent = alertCount;
  if (lastUpdate) {
    lastUpdate.textContent = `Atualizado às ${lastSyncTimestamp.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  }
}

window.openAllInmetForecastModal = function() {
  const modal = document.getElementById('inmetDetailModal');
  const body = document.getElementById('inmetDetailBody');
  if (!modal || !body) return;

  const cardsHtml = operationalCenters.map(base => {
    const info = getBaseCityInfo(base);
    const weather = inmetWeatherByBase[base.id];
    const alert = base.climaExtremo;
    const hasAlert = alert && alert.ativo;

    const riskColor = hasAlert ? (alert.severidade === 'VERMELHO' ? '#ef4444' : '#f97316') : '#22c55e';
    const riskLabel = hasAlert ? alert.tipo : 'CONDIÇÕES NORMAIS';

    return `
      <div class="inmet-detail-base p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-black/30 space-y-2" onclick="focusBaseOnMap('${base.id}'); closeInmetDetailModal();">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="text-sm font-black uppercase text-slate-900 dark:text-white">${escapeHtmlSafe(base.base)}</div>
            <div class="text-[10px] text-slate-500">${escapeHtmlSafe(info.display)}</div>
          </div>
          <span class="text-[8px] font-black uppercase px-2 py-1 rounded-lg" style="color:${riskColor}; background:${riskColor}18">
            ${escapeHtmlSafe(riskLabel)}
          </span>
        </div>
        <p class="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
          ${escapeHtmlSafe(weather?.summary || 'Monitoramento em tempo real a cada 5 min.')}
        </p>
        ${hasAlert ? `<div class="p-2 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 text-[10px] font-semibold">${escapeHtmlSafe(alert.descricao)}</div>` : ''}
      </div>
    `;
  });

  body.innerHTML = `<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">${cardsHtml.join('')}</div>`;
  modal.classList.remove('hidden');
  lucide.createIcons();
};

window.closeInmetDetailModal = function() {
  const modal = document.getElementById('inmetDetailModal');
  if (modal) modal.classList.add('hidden');
};

window.filterMeteorologicalForecasts = function(query) {
  const q = String(query || '').trim().toLowerCase();
  const body = document.getElementById('inmetDetailBody');
  if (!body) return;
  Array.from(body.querySelectorAll('.inmet-detail-base')).forEach(card => {
    const text = (card.textContent || '').toLowerCase();
    card.style.display = (!q || text.includes(q)) ? '' : 'none';
  });
};

// =========================================================================
// MODO EDIÇÃO E PERSISTÊNCIA (INDEXEDDB / LOCALSTORAGE)
// =========================================================================

const EDIT_MODE_PASSWORD = 'VibR@Exent777';
let editModeUnlocked = false;

window.requestEditAccess = function() {
  if (editModeUnlocked) {
    openEditBasesModal();
    return;
  }
  const password = window.prompt('Acesso restrito\nDigite a senha para liberar o Modo Edição:');
  if (password === EDIT_MODE_PASSWORD) {
    editModeUnlocked = true;
    openEditBasesModal();
  } else if (password !== null) {
    alert('Senha incorreta. O Modo Edição permanece bloqueado.');
  }
};

function openEditBasesModal() {
  renderEditBaseManagersSection();
  renderEditBaseSupervisorsSection();
  renderEditBasesTable();
  const modal = document.getElementById('editBasesModal');
  if (modal) modal.classList.remove('hidden');
  lucide.createIcons();
}

window.closeEditBasesModal = function() {
  const modal = document.getElementById('editBasesModal');
  if (modal) modal.classList.add('hidden');
};

function renderEditBaseManagersSection() {
  const container = document.getElementById('editBaseManagersContainer');
  if (!container) return;
  container.innerHTML = '';

  operationalCenters.slice().sort((a,b) => String(a.base).localeCompare(String(b.base), 'pt-BR')).forEach(base => {
    const card = document.createElement('div');
    card.className = 'p-3 rounded-xl bg-white dark:bg-black/30 border border-slate-200 dark:border-slate-700 space-y-2';
    card.innerHTML = `
      <div>
        <p class="text-[10px] font-bold text-amber-600 dark:text-amber-400">${escapeHtmlSafe(base.regional)} • ${escapeHtmlSafe(base.centroVirtual)}</p>
        <p class="text-xs font-extrabold text-slate-800 dark:text-white truncate">${escapeHtmlSafe(base.base)}</p>
      </div>
      <div>
        <label class="text-[9px] text-gray-500 block font-bold">Gerente da Base</label>
        <input id="base-manager-name-${base.id}" type="text" value="${escapeHtmlSafe(base.gerenteBase || '')}" class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2 py-1 text-xs outline-none focus:border-amber-500">
      </div>
      <div>
        <label class="text-[9px] text-gray-500 block font-bold">Contato do Gerente</label>
        <input id="base-manager-contact-${base.id}" type="text" value="${escapeHtmlSafe(base.contatoGerBase || '')}" class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2 py-1 text-xs outline-none focus:border-amber-500">
      </div>
      <button onclick="saveBaseManager('${base.id}')" class="w-full px-2 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-bold">Salvar Gerente</button>
    `;
    container.appendChild(card);
  });
}

window.saveBaseManager = function(id) {
  const base = operationalCenters.find(item => item.id === id);
  if (!base) return;
  const nameInput = document.getElementById(`base-manager-name-${id}`);
  const contactInput = document.getElementById(`base-manager-contact-${id}`);
  base.gerenteBase = nameInput ? nameInput.value.trim() : '';
  base.contatoGerBase = contactInput ? contactInput.value.trim() : '';
  autoSaveToIndexedDB();
  renderCenters();
  renderEditBasesTable();
};

function renderEditBaseSupervisorsSection() {
  const container = document.getElementById('editBaseSupervisorsContainer');
  if (!container) return;
  container.innerHTML = '';
  operationalCenters.forEach(base => {
    const card = document.createElement('div');
    card.className = 'p-3 rounded-xl bg-white dark:bg-black/30 border border-slate-200 dark:border-slate-700 space-y-2';
    card.innerHTML = `
      <div>
        <p class="text-[10px] font-bold text-indigo-600 dark:text-indigo-400">${base.regional} • ${base.centroVirtual}</p>
        <p class="text-xs font-extrabold text-slate-800 dark:text-white truncate">${base.base}</p>
      </div>
      <div>
        <label class="text-[9px] text-gray-500 block font-bold">Supervisor</label>
        <input id="base-supervisor-name-${base.id}" type="text" value="${base.supervisorLoge || ''}" class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2 py-1 text-xs outline-none focus:border-indigo-500">
      </div>
      <div>
        <label class="text-[9px] text-gray-500 block font-bold">Contato</label>
        <input id="base-supervisor-contact-${base.id}" type="text" value="${base.contatoSupLoge || ''}" class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2 py-1 text-xs outline-none focus:border-indigo-500">
      </div>
      <button onclick="saveBaseSupervisor('${base.id}')" class="w-full px-2 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold">Salvar Supervisor</button>
    `;
    container.appendChild(card);
  });
}

window.saveBaseSupervisor = function(id) {
  const base = operationalCenters.find(item => item.id === id);
  if (!base) return;
  base.supervisorLoge = document.getElementById(`base-supervisor-name-${id}`).value.trim();
  base.contatoSupLoge = document.getElementById(`base-supervisor-contact-${id}`).value.trim();
  autoSaveToIndexedDB();
  renderCenters();
  renderEditBasesTable();
};

function renderEditBasesTable() {
  const tbody = document.getElementById('editBasesTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  operationalCenters.forEach(item => {
    const tr = document.createElement('tr');
    tr.className = "hover:bg-black/5 dark:hover:bg-white/5 transition-colors";
    tr.innerHTML = `
      <td class="p-2 font-mono">${escapeHtmlSafe(item.centro)}</td>
      <td class="p-2 font-bold">${escapeHtmlSafe(item.base)} (${escapeHtmlSafe(item.centroVirtual)})</td>
      <td class="p-2">${escapeHtmlSafe(item.regional)}</td>
      <td class="p-2 min-w-[200px]">
        <input id="table-manager-name-${item.id}" type="text" value="${escapeHtmlSafe(item.gerenteBase || '')}" placeholder="Nome do gerente" class="w-full mb-1 bg-white dark:bg-slate-900 border rounded px-2 py-1 text-[11px]">
        <input id="table-manager-contact-${item.id}" type="text" value="${escapeHtmlSafe(item.contatoGerBase || '')}" placeholder="Contato" class="w-full bg-white dark:bg-slate-900 border rounded px-2 py-1 text-[11px]">
        <button onclick="saveBaseManagerFromTable('${item.id}')" class="mt-1 px-2 py-1 bg-amber-600 text-white rounded text-[10px] font-bold">Salvar</button>
      </td>
      <td class="p-2">${escapeHtmlSafe(item.supervisorLoge || 'Não informado')}</td>
      <td class="p-2">${escapeHtmlSafe(item.endereco || '')}</td>
      <td class="p-2 font-mono text-[10px]">${item.lat}, ${item.lng}</td>
      <td class="p-2 text-center">
        <button onclick="deleteBaseManual('${item.id}')" class="p-1 text-red-500 hover:text-red-400"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

window.saveBaseManagerFromTable = function(id) {
  const base = operationalCenters.find(item => item.id === id);
  if (!base) return;
  base.gerenteBase = document.getElementById(`table-manager-name-${id}`).value.trim();
  base.contatoGerBase = document.getElementById(`table-manager-contact-${id}`).value.trim();
  autoSaveToIndexedDB();
  renderCenters();
  renderEditBasesTable();
};

window.addNewBaseManual = function() {
  const newId = `manual-${Date.now()}`;
  const newBase = {
    id: newId,
    regional: "OPC",
    centro: "9999",
    centroVirtual: "BANEW",
    base: "Nova Base Operacional",
    supervisorLoge: "Não informado",
    contatoSupLoge: "-",
    gerenteBase: "Não informado",
    contatoGerBase: "-",
    endereco: "Endereço da Base - UF",
    lat: -15.7988,
    lng: -47.9757
  };
  operationalCenters.unshift(newBase);
  autoSaveToIndexedDB();
  renderCenters();
  renderEditBasesTable();
};

window.deleteBaseManual = function(id) {
  if (confirm("Tem certeza que deseja remover esta base do sistema?")) {
    operationalCenters = operationalCenters.filter(b => b.id !== id);
    autoSaveToIndexedDB();
    renderCenters();
    renderEditBasesTable();
  }
};

// Notas Rápidas
window.toggleKdeNotesWidget = function() {
  const widget = document.getElementById('kdeNotesWidget');
  if (widget) {
    widget.classList.toggle('hidden');
    renderWidgetNotes();
  }
};

window.addNoteFromWidget = function() {
  const input = document.getElementById('widgetNoteInput');
  const val = input?.value.trim();
  if (!val) return;

  systemNotes.unshift({
    id: Date.now(),
    date: new Date().toLocaleDateString('pt-BR'),
    text: val
  });

  input.value = '';
  autoSaveToIndexedDB();
  renderWidgetNotes();
};

window.deleteNoteFromWidget = function(id) {
  systemNotes = systemNotes.filter(n => n.id !== id);
  autoSaveToIndexedDB();
  renderWidgetNotes();
};

function renderWidgetNotes() {
  const container = document.getElementById('widgetNotesList');
  if (!container) return;
  container.innerHTML = '';

  if (systemNotes.length === 0) {
    container.innerHTML = `<p class="text-[11px] text-gray-400 italic text-center py-4">Nenhuma nota gravada.</p>`;
    return;
  }

  systemNotes.forEach(note => {
    const item = document.createElement('div');
    item.className = "kde-note-paper p-2.5 rounded-xl flex items-start justify-between gap-2 text-xs font-semibold";
    item.innerHTML = `
      <div>
        <span class="text-[9px] font-bold text-amber-800 uppercase block">${note.date}</span>
        <span>${escapeHtmlSafe(note.text)}</span>
      </div>
      <button onclick="deleteNoteFromWidget(${note.id})" class="text-red-700 hover:text-red-900 p-0.5">
        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
      </button>
    `;
    container.appendChild(item);
  });
  lucide.createIcons();
}

// Persistência com IndexedDB e LocalStorage
const LOCAL_STATE_KEY = "basesOperacionais_state_v8";

function autoSaveToIndexedDB() {
  try {
    const payload = {
      operationalCenters,
      regionalManagers: REGIONAL_MANAGERS,
      notes: systemNotes,
      lastUpdated: new Date().toISOString()
    };
    localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(payload));
  } catch (_) {}
}

function loadPersistedState() {
  try {
    const raw = localStorage.getItem(LOCAL_STATE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (Array.isArray(data.operationalCenters)) {
        operationalCenters = mergeOperationalCenters(data.operationalCenters);
        window.operationalCenters = operationalCenters;
      }
      if (data.regionalManagers) REGIONAL_MANAGERS = data.regionalManagers;
      if (Array.isArray(data.notes)) systemNotes = data.notes;
    }
  } catch (_) {}
}

window.downloadSystemData = function() {
  const payload = {
    operationalCenters,
    regionalManagers: REGIONAL_MANAGERS,
    notes: systemNotes,
    lastUpdated: new Date().toISOString()
  };
  const dataStr = "data:application/json;charset=utf-8," + encodeURIComponent(JSON.stringify(payload, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.href = dataStr;
  downloadAnchor.download = `backup_bases_operacionais_${Date.now()}.json`;
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
};

window.uploadSystemData = function(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(event) {
    try {
      const parsed = JSON.parse(event.target.result);
      if (Array.isArray(parsed.operationalCenters)) {
        operationalCenters = mergeOperationalCenters(parsed.operationalCenters);
        window.operationalCenters = operationalCenters;
      }
      autoSaveToIndexedDB();
      renderCenters();
      renderInmetWeatherNews();
      alert("Backup restaurado com sucesso!");
    } catch (_) {
      alert("Arquivo de backup inválido.");
    }
  };
  reader.readAsText(file);
};

window.changeLogoImage = function(e) {
  const file = e?.target?.files?.[0];
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = function(event) {
    const dataUrl = event.target.result;
    localStorage.setItem('vibraCustomLogo', dataUrl);
    const container = document.getElementById('logoContainer');
    if (container) container.innerHTML = `<img src="${dataUrl}" class="h-8 w-auto object-contain" alt="Logo">`;
  };
  reader.readAsDataURL(file);
};

// =========================================================================
// INICIALIZAÇÃO GERAL DO SISTEMA
// =========================================================================
window.onload = async function() {
  loadPersistedState();
  initMap();
  renderCenters();
  renderInmetWeatherNews();

  // Carrega logo salva
  const savedLogo = localStorage.getItem('vibraCustomLogo');
  if (savedLogo) {
    const container = document.getElementById('logoContainer');
    if (container) container.innerHTML = `<img src="${savedLogo}" class="h-8 w-auto object-contain" alt="Logo">`;
  }

  // Inicializa cronômetro de 5 minutos
  start5MinuteSyncScheduler();

  // Executa a primeira verificação completa em tempo real
  await triggerFullWeatherSync({ isAuto: false });

  lucide.createIcons();
};
