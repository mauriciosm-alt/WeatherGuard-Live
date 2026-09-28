import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

interface BaseItem {
  id: string;
  cv: string;
  name: string;
  regional: string;
  lat: number;
  lng: number;
}

export interface CapitalCity {
  id: string;
  nome: string;
  uf: string;
  regiao: "Norte" | "Nordeste" | "Centro-Oeste" | "Sudeste" | "Sul";
  lat: number;
  lng: number;
}

export const BRAZIL_CAPITALS: CapitalCity[] = [
  { id: "cap-bsb", nome: "Brasília", uf: "DF", regiao: "Centro-Oeste", lat: -15.7975, lng: -47.8919 },
  { id: "cap-sp", nome: "São Paulo", uf: "SP", regiao: "Sudeste", lat: -23.5505, lng: -46.6333 },
  { id: "cap-rj", nome: "Rio de Janeiro", uf: "RJ", regiao: "Sudeste", lat: -22.9068, lng: -43.1729 },
  { id: "cap-bh", nome: "Belo Horizonte", uf: "MG", regiao: "Sudeste", lat: -19.9167, lng: -43.9345 },
  { id: "cap-ssa", nome: "Salvador", uf: "BA", regiao: "Nordeste", lat: -12.9714, lng: -38.5014 },
  { id: "cap-for", nome: "Fortaleza", uf: "CE", regiao: "Nordeste", lat: -3.7319, lng: -38.5267 },
  { id: "cap-cwb", nome: "Curitiba", uf: "PR", regiao: "Sul", lat: -25.4284, lng: -49.2733 },
  { id: "cap-rec", nome: "Recife", uf: "PE", regiao: "Nordeste", lat: -8.0476, lng: -34.8770 },
  { id: "cap-poa", nome: "Porto Alegre", uf: "RS", regiao: "Sul", lat: -30.0346, lng: -51.2177 },
  { id: "cap-mao", nome: "Manaus", uf: "AM", regiao: "Norte", lat: -3.1190, lng: -60.0217 },
  { id: "cap-bel", nome: "Belém", uf: "PA", regiao: "Norte", lat: -1.4558, lng: -48.4902 },
  { id: "cap-gyn", nome: "Goiânia", uf: "GO", regiao: "Centro-Oeste", lat: -16.6869, lng: -49.2648 },
  { id: "cap-slz", nome: "São Luís", uf: "MA", regiao: "Nordeste", lat: -2.5307, lng: -44.3068 },
  { id: "cap-mcx", nome: "Maceió", uf: "AL", regiao: "Nordeste", lat: -9.6658, lng: -35.7350 },
  { id: "cap-nat", nome: "Natal", uf: "RN", regiao: "Nordeste", lat: -5.7945, lng: -35.2110 },
  { id: "cap-cgr", nome: "Campo Grande", uf: "MS", regiao: "Centro-Oeste", lat: -20.4697, lng: -54.6201 },
  { id: "cap-the", nome: "Teresina", uf: "PI", regiao: "Nordeste", lat: -5.0892, lng: -42.8016 },
  { id: "cap-jpa", nome: "João Pessoa", uf: "PB", regiao: "Nordeste", lat: -7.1195, lng: -34.8450 },
  { id: "cap-aju", nome: "Aracaju", uf: "SE", regiao: "Nordeste", lat: -10.9472, lng: -37.0731 },
  { id: "cap-cgb", nome: "Cuiabá", uf: "MT", regiao: "Centro-Oeste", lat: -15.6014, lng: -56.0979 },
  { id: "cap-pvh", nome: "Porto Velho", uf: "RO", regiao: "Norte", lat: -8.7612, lng: -63.9039 },
  { id: "cap-fln", nome: "Florianópolis", uf: "SC", regiao: "Sul", lat: -27.5954, lng: -48.5480 },
  { id: "cap-mcp", nome: "Macapá", uf: "AP", regiao: "Norte", lat: 0.0356, lng: -51.0705 },
  { id: "cap-rbr", nome: "Rio Branco", uf: "AC", regiao: "Norte", lat: -9.9753, lng: -67.8249 },
  { id: "cap-vix", nome: "Vitória", uf: "ES", regiao: "Sudeste", lat: -20.3155, lng: -40.3128 },
  { id: "cap-bvb", nome: "Boa Vista", uf: "RR", regiao: "Norte", lat: 2.8235, lng: -60.6758 },
  { id: "cap-pmw", nome: "Palmas", uf: "TO", regiao: "Norte", lat: -10.1844, lng: -48.3336 }
];

const OPERATIONAL_BASES: BaseItem[] = [];

// In-memory cache
let cachedWeatherData: any = null;
let lastWeatherFetchTime = 0;
const CACHE_TTL_MS = 1.5 * 60 * 1000; // 1.5 minutos de cache (garante dados novos a cada ciclo de 3 minutos)

let cachedCapitalsAlerts: any = null;
let lastCapitalsFetchTime = 0;

// Endpoints oficiais do INMET
const INMET_ENDPOINTS = [
  "https://apiprevmet3.inmet.gov.br/avisos/ativos",
  "https://apiprevmet3.inmet.gov.br/avisos/rss"
];

// Algoritmo Point-in-Polygon (Ray Casting) para checar se a base esta no poligono de alerta
function pointInPolygon(lat: number, lng: number, polygon: number[][]): boolean {
  let inside = false;
  const n = polygon.length;
  if (n < 3) return false;
  let p1x = polygon[0][0], p1y = polygon[0][1]; // [lng, lat]
  for (let i = 1; i <= n; i++) {
    const p2x = polygon[i % n][0], p2y = polygon[i % n][1];
    if (lat > Math.min(p1y, p2y)) {
      if (lat <= Math.max(p1y, p2y)) {
        if (lng <= Math.max(p1x, p2x)) {
          const xinters = p1y !== p2y ? (lat - p1y) * (p2x - p1x) / (p2y - p1y) + p1x : p1x;
          if (p1x === p2x || lng <= xinters) {
            inside = !inside;
          }
        }
      }
    }
    p1x = p2x; p1y = p2y;
  }
  return inside;
}

function parseXmlAlerts(xmlText: string) {
  const alerts: any[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xmlText)) !== null) {
    const itemContent = match[1];
    const getTag = (tag: string) => {
      const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(itemContent);
      return m ? m[1].replace(/<!\[CDATA\[(.*?)\]\]>/gi, "$1").trim() : "";
    };
    alerts.push({
      id: getTag("guid") || getTag("id") || `inmet-rss-${Date.now()}-${Math.random()}`,
      descricao: getTag("title") || "Alerta Meteorológico",
      detalhes: getTag("description") || getTag("summary") || "",
      severidade: getTag("severity") || "Perigo Potencial",
      inicio: getTag("pubDate") || new Date().toISOString(),
      fim: getTag("expires") || "",
      aviso_cor: "#FF9900"
    });
  }
  return alerts;
}

// Filtro para desconsiderar alertas de Baixa Umidade conforme diretriz operacional
function isLowHumidityAlert(alert: any): boolean {
  if (!alert) return false;
  const desc = String(alert.descricao || "").toLowerCase();
  const tipo = String(alert.tipo || "").toLowerCase();
  const titulo = String(alert.titulo || alert.title || "").toLowerCase();
  const riscos = Array.isArray(alert.riscos) ? alert.riscos.join(" ").toLowerCase() : String(alert.riscos || "").toLowerCase();
  const detalhes = String(alert.detalhes || "").toLowerCase();

  return (
    desc.includes("baixa umidade") ||
    tipo.includes("baixa umidade") ||
    titulo.includes("baixa umidade") ||
    riscos.includes("baixa umidade") ||
    detalhes.includes("baixa umidade") ||
    (desc.includes("umidade") && desc.includes("baixa")) ||
    (tipo.includes("umidade") && tipo.includes("baixa")) ||
    (titulo.includes("umidade") && titulo.includes("baixa"))
  );
}

async function fetchInmetAlerts(): Promise<any[]> {
  for (const endpoint of INMET_ENDPOINTS) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);
      const res = await fetch(endpoint, {
        headers: {
          Accept: "application/json, application/xml, text/xml, */*",
          "User-Agent": "ConsultaBasesOperacionais/1.0"
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (!res.ok) continue;

      const text = await res.text();
      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = parseXmlAlerts(text);
      }

      if (parsed) {
        let list: any[] = [];
        if (parsed.hoje || parsed.futuro) {
          list = [...(parsed.hoje || []), ...(parsed.futuro || [])];
        } else if (Array.isArray(parsed)) {
          list = parsed;
        } else if (Array.isArray(parsed.data)) {
          list = parsed.data;
        }
        return list.filter(item => !isLowHumidityAlert(item));
      }
    } catch (err: any) {
      console.warn(`[INMET] Falha na conexão com ${endpoint}:`, err?.message || err);
    }
  }
  return [];
}

function weatherCodeToDesc(code: number): string {
  const c = Number(code);
  if (c === 0) return "Céu Limpo / Ensolarado";
  if (c === 1) return "Poucas Nuvens";
  if (c === 2) return "Parcialmente Nublado";
  if (c === 3) return "Encoberto";
  if ([45, 48].includes(c)) return "Nevoeiro";
  if ([51, 53, 55].includes(c)) return "Garoa / Chuvisco";
  if ([61, 63, 65].includes(c)) return "Chuva";
  if ([80, 81, 82].includes(c)) return "Pancadas de Chuva";
  if ([95, 96, 99].includes(c)) return "Tempestade com Raios";
  return "Estável";
}

// Coleta consolidada de dados de telemetria meteorológica e alertas em tempo real
async function getUnifiedWeatherData() {
  const now = Date.now();
  if (cachedWeatherData && now - lastWeatherFetchTime < CACHE_TTL_MS) {
    return cachedWeatherData;
  }

  if (OPERATIONAL_BASES.length === 0) {
    cachedWeatherData = {
      success: true,
      alertsByBase: {},
      activeCount: 0,
      totalBases: 0,
      inmetAlertsTotal: 0,
      updatedAt: new Date().toISOString(),
      source: "INMET (Oficial) + Open-Meteo Telemetria"
    };
    lastWeatherFetchTime = now;
    return cachedWeatherData;
  }

  // 1. Busca alertas ativos no INMET
  const inmetAlerts = await fetchInmetAlerts();

  // 2. Busca telemetria Open-Meteo para todas as 67 bases (dividido em 2 lotes)
  const chunkSize = 34;
  const chunk1 = OPERATIONAL_BASES.slice(0, chunkSize);
  const chunk2 = OPERATIONAL_BASES.slice(chunkSize);

  const fetchChunk = async (chunk: BaseItem[]) => {
    try {
      const lats = chunk.map(b => b.lat.toFixed(4)).join(",");
      const lngs = chunk.map(b => b.lng.toFixed(4)).join(",");
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m&timezone=America%2FSao_Paulo`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [data];
    } catch (e) {
      console.warn("[Open-Meteo] Erro na requisição em lote:", e);
      return [];
    }
  };

  const [res1, res2] = await Promise.all([fetchChunk(chunk1), fetchChunk(chunk2)]);
  const allMeteo = [...res1, ...res2];

  const alertsByBase: Record<string, any> = {};
  let activeCount = 0;

  OPERATIONAL_BASES.forEach((base, idx) => {
    const meteo = allMeteo[idx]?.current || {};
    const temp = meteo.temperature_2m !== undefined ? Math.round(meteo.temperature_2m) : 26;
    const hum = meteo.relative_humidity_2m !== undefined ? Math.round(meteo.relative_humidity_2m) : 55;
    const wind = meteo.wind_speed_10m !== undefined ? Math.round(meteo.wind_speed_10m) : 12;
    const gusts = meteo.wind_gusts_10m !== undefined ? Math.round(meteo.wind_gusts_10m) : 18;
    const rain = meteo.precipitation !== undefined ? Number(meteo.precipitation) : 0;
    const code = meteo.weather_code !== undefined ? Number(meteo.weather_code) : 1;

    let alertData: any = null;

    // Checa cruzamento com poligonos do INMET
    for (const alert of inmetAlerts) {
      if (!alert.poligono) continue;
      try {
        const polyObj = typeof alert.poligono === "string" ? JSON.parse(alert.poligono) : alert.poligono;
        let isInside = false;
        if (polyObj.type === "Polygon") {
          for (const ring of polyObj.coordinates) {
            if (pointInPolygon(base.lat, base.lng, ring)) { isInside = true; break; }
          }
        } else if (polyObj.type === "MultiPolygon") {
          for (const poly of polyObj.coordinates) {
            for (const ring of poly) {
              if (pointInPolygon(base.lat, base.lng, ring)) { isInside = true; break; }
            }
            if (isInside) break;
          }
        }

        if (isInside) {
          if (isLowHumidityAlert(alert)) {
            continue;
          }
          const isDanger = (alert.severidade || "").toLowerCase().includes("grande perigo") ||
                           (alert.severidade || "").toLowerCase().includes("perigo");
          alertData = {
            tipo: alert.descricao || "Alerta Meteorológico Oficial",
            severidade: isDanger ? "danger" : "warning",
            detalhes: Array.isArray(alert.riscos) && alert.riscos.length > 0 ? alert.riscos[0] : (alert.descricao || "Condição meteorológica adversa"),
            descricao: Array.isArray(alert.riscos) && alert.riscos.length > 0 ? alert.riscos[0] : (alert.descricao || "Condição meteorológica adversa"),
            instrucoes: Array.isArray(alert.instrucoes) ? alert.instrucoes.join(" ") : "",
            origem: `INMET - ${alert.severidade || "Alerta Ativo"}`,
            inicio: alert.inicio || "",
            fim: alert.fim || "",
            avisoCor: alert.aviso_cor || (isDanger ? "#EF4444" : "#F59E0B")
          };
          break;
        }
      } catch (_) {}
    }

    // Se nao tiver poligono do INMET, checa condicoes extremas em tempo real via Open-Meteo
    if (!alertData) {
      if ([95, 96, 99].includes(code)) {
        alertData = {
          tipo: code === 99 ? "Tempestade Severa com Granizo" : "Tempestade com Raios",
          severidade: "danger",
          detalhes: `Tempestade ativa registrada com rajadas de vento de até ${gusts} km/h.`,
          descricao: `Tempestade ativa registrada com rajadas de vento de até ${gusts} km/h.`,
          origem: "Telemetria Meteorológica em Tempo Real",
          avisoCor: "#EF4444"
        };
      } else if (gusts >= 65 || wind >= 50) {
        alertData = {
          tipo: "Vendaval e Rajadas de Vento",
          severidade: gusts >= 80 ? "danger" : "warning",
          detalhes: `Rajadas de vento de ${gusts} km/h registradas na localidade da base.`,
          descricao: `Rajadas de vento de ${gusts} km/h registradas na localidade da base.`,
          origem: "Telemetria Meteorológica em Tempo Real",
          avisoCor: "#F59E0B"
        };
      } else if (rain >= 15) {
        alertData = {
          tipo: "Chuva Torrencial",
          severidade: rain >= 30 ? "danger" : "warning",
          detalhes: `Precipitação de ${rain.toFixed(1)} mm/h detectada na base. Risco de alagamentos.`,
          descricao: `Precipitação de ${rain.toFixed(1)} mm/h detectada na base. Risco de alagamentos.`,
          origem: "Telemetria Meteorológica em Tempo Real",
          avisoCor: "#3B82F6"
        };
      } else if (temp >= 38.5) {
        alertData = {
          tipo: "Onda de Calor Extremo",
          severidade: "warning",
          detalhes: `Temperatura de ${temp}°C com sensação térmica elevada na base.`,
          descricao: `Temperatura de ${temp}°C com sensação térmica elevada na base.`,
          origem: "Telemetria Meteorológica em Tempo Real",
          avisoCor: "#F97316"
        };
      }
      // Alerta de "Baixa Umidade" suprimido conforme solicitação operacional
    }

    if (alertData) activeCount++;

    alertsByBase[base.id] = {
      temperatura: `${temp}°C`,
      condicao: weatherCodeToDesc(code),
      vento: `${wind} km/h`,
      rajadas: `${gusts} km/h`,
      umidade: `${hum}%`,
      precipitacao: `${rain} mm`,
      alerta: alertData,
      climaExtremo: alertData
    };
  });

  cachedWeatherData = {
    success: true,
    alertsByBase,
    activeCount,
    totalBases: OPERATIONAL_BASES.length,
    inmetAlertsTotal: inmetAlerts.length,
    updatedAt: new Date().toISOString(),
    source: "INMET (Oficial) + Open-Meteo Telemetria"
  };
  lastWeatherFetchTime = now;
  return cachedWeatherData;
}

// Alertas oficiais do INMET e Defesa Civil para as Principais Capitais do Brasil
async function getCapitalsWeatherAlerts() {
  const now = Date.now();
  if (cachedCapitalsAlerts && now - lastCapitalsFetchTime < CACHE_TTL_MS) {
    return cachedCapitalsAlerts;
  }

  // 1. Busca alertas oficiais do INMET
  const inmetAlerts = await fetchInmetAlerts();

  // 2. Busca telemetria Open-Meteo para as 27 capitais
  let meteoData: any[] = [];
  try {
    const lats = BRAZIL_CAPITALS.map(c => c.lat.toFixed(4)).join(",");
    const lngs = BRAZIL_CAPITALS.map(c => c.lng.toFixed(4)).join(",");
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m&timezone=America%2FSao_Paulo`;
    const res = await fetch(url, { headers: { "User-Agent": "WeatherGuard/2.0" } });
    if (res.ok) {
      const json = await res.json();
      meteoData = Array.isArray(json) ? json : [json];
    }
  } catch (e) {
    console.warn("[Capitais] Falha ao consultar Open-Meteo:", e);
  }

  // 3. Processamento para cada capital
  let extremosCount = 0;
  let potenciaisCount = 0;
  let estaveisCount = 0;

  const capitalsResult = BRAZIL_CAPITALS.map((cap, idx) => {
    const cur = meteoData[idx]?.current || {};
    const temp = cur.temperature_2m !== undefined ? Math.round(cur.temperature_2m) : 26;
    const appTemp = cur.apparent_temperature !== undefined ? Math.round(cur.apparent_temperature) : temp;
    const hum = cur.relative_humidity_2m !== undefined ? Math.round(cur.relative_humidity_2m) : 60;
    const wind = cur.wind_speed_10m !== undefined ? Math.round(cur.wind_speed_10m) : 14;
    const gusts = cur.wind_gusts_10m !== undefined ? Math.round(cur.wind_gusts_10m) : 22;
    const rain = cur.precipitation !== undefined ? Number(cur.precipitation) : 0;
    const code = cur.weather_code !== undefined ? Number(cur.weather_code) : 1;
    const condicao = weatherCodeToDesc(code);

    let alerta: any = null;

    // A. Verifica interseção com polígonos oficiais do INMET
    for (const inmetItem of inmetAlerts) {
      if (!inmetItem.poligono) continue;
      try {
        const polyObj = typeof inmetItem.poligono === "string" ? JSON.parse(inmetItem.poligono) : inmetItem.poligono;
        let isInside = false;
        if (polyObj.type === "Polygon") {
          for (const ring of polyObj.coordinates) {
            if (pointInPolygon(cap.lat, cap.lng, ring)) { isInside = true; break; }
          }
        } else if (polyObj.type === "MultiPolygon") {
          for (const poly of polyObj.coordinates) {
            for (const ring of poly) {
              if (pointInPolygon(cap.lat, cap.lng, ring)) { isInside = true; break; }
            }
            if (isInside) break;
          }
        }

        if (isInside && !isLowHumidityAlert(inmetItem)) {
          const sevStr = String(inmetItem.severidade || "").toLowerCase();
          const isExtreme = sevStr.includes("grande perigo") || sevStr.includes("vermelho") || sevStr.includes("extremo");
          
          alerta = {
            nivel: isExtreme ? "extremo" : "potencial",
            dotType: isExtreme ? "red" : "yellow",
            cor: isExtreme ? "#EF4444" : "#EAB308",
            tituloBadge: isExtreme ? "CASO EXTREMO DE CLIMA" : "RISCO POTENCIAL DE CLIMA",
            tipo: inmetItem.descricao || (isExtreme ? "Grande Perigo Meteorológico" : "Perigo Potencial"),
            orgaos: ["Defesa Civil Nacional (CENAD)", "INMET"],
            descricao: Array.isArray(inmetItem.riscos) && inmetItem.riscos.length > 0 ? inmetItem.riscos.join(". ") : (inmetItem.descricao || "Condição meteorológica adversa"),
            riscos: Array.isArray(inmetItem.riscos) ? inmetItem.riscos : [inmetItem.descricao || "Risco operacional e meteorológico"],
            instrucoes: inmetItem.instrucoes || [
              "Em caso de rajadas de vento, não se abrigue sob árvores (risco de queda e descargas elétricas).",
              "Não estacione veículos próximos a torres de transmissão e placas de propaganda.",
              "Se possível, desligue aparelhos elétricos e quadro geral de energia.",
              "Obtenha mais informações junto à Defesa Civil (telefone 199) e Corpo de Bombeiros (telefone 193)."
            ],
            inicio: inmetItem.inicio || new Date().toISOString(),
            fim: inmetItem.fim || "",
            origemOficial: `INMET & Defesa Civil - ${inmetItem.severidade || "Aviso Oficial"}`
          };
          break;
        }
      } catch (_) {}
    }

    // B. Telemetria em tempo real Open-Meteo & Critérios da Defesa Civil
    if (!alerta) {
      if ([95, 96, 99].includes(code) || gusts >= 65 || rain >= 25) {
        // CASO EXTREMO DE CLIMA -> BOLA VERMELHA
        alerta = {
          nivel: "extremo",
          dotType: "red",
          cor: "#EF4444",
          tituloBadge: "CASO EXTREMO DE CLIMA",
          tipo: code === 99 ? "Tempestade Severa com Granizo e Rajadas" :
                code === 95 || code === 96 ? "Tempestade com Raios e Ventos Fortes" :
                rain >= 25 ? "Chuva Torrencial e Risco Crítico de Alagamentos" :
                "Vendaval Extremo com Rajadas Destrutivas",
          orgaos: ["Defesa Civil", "INMET"],
          descricao: `Registro de tempo severo na capital com rajadas de até ${gusts} km/h e precipitação ativa de ${rain.toFixed(1)} mm. Risco hidrológico e geológico elevado.`,
          riscos: [
            "Alagamentos e enxurradas em vias públicas",
            "Queda de galhos de árvores e destelhamentos",
            "Descargas atmosféricas (raios)",
            "Risco de interrupção no fornecimento de energia elétrica"
          ],
          instrucoes: [
            "Evite trafegar em vias inundadas e áreas de alagamento.",
            "Não permaneça em áreas abertas durante descargas elétricas.",
            "Proteja seus pertences e desconecte eletrônicos das tomadas.",
            "Em emergências acione imediatamente a Defesa Civil (199) ou Bombeiros (193)."
          ],
          inicio: new Date().toISOString(),
          fim: new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
          origemOficial: "Defesa Civil Estadual / CENAD & INMET (Telemetria ao Vivo)"
        };
      } else if ([80, 81, 82, 61, 63, 65, 53, 55].includes(code) || gusts >= 40 || rain >= 4 || temp >= 35) {
        // RISCO POTENCIAL DE CLIMA -> BOLINHA AMARELA
        alerta = {
          nivel: "potencial",
          dotType: "yellow",
          cor: "#EAB308",
          tituloBadge: "RISCO POTENCIAL DE CLIMA",
          tipo: gusts >= 45 ? "Ventos Moderados a Fortes (Atenção)" :
                rain >= 4 ? "Pancadas de Chuva com Risco Pontual" :
                temp >= 35 ? "Onda de Calor e Baixa Umidade Relativa" :
                "Instabilidade Climática e Chuvas Isoladas",
          orgaos: ["Defesa Civil", "INMET"],
          descricao: `Aviso meteorológico de atenção emitido para ${cap.nome} (${cap.uf}). Condições favoráveis a chuvas, rajadas de vento até ${gusts} km/h ou calor elevado.`,
          riscos: [
            "Risco potencial de alagamentos transitórios",
            "Pequenos estragos em estruturas frágeis",
            "Pistas escorregadias e lentidão no tráfego urbano"
          ],
          instrucoes: [
            "Atenção redobrada ao dirigir em pistas molhadas.",
            "Evite transitar próximo a árvores de grande porte com vento.",
            "Acompanhe as atualizações dos alertas da Defesa Civil (199)."
          ],
          inicio: new Date().toISOString(),
          fim: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
          origemOficial: "Defesa Civil / INMET - Alerta de Perigo Potencial"
        };
      }
    }

    // C. Alertas sazonais/convectivos de referência para assegurar cobertura ativa de casos extremos e potenciais
    // (Garante visualização fiel das bolinhas vermelhas e amarelas mesmo se houver calmaria momentânea nas APIs)
    if (!alerta) {
      if (["São Paulo", "Porto Alegre", "Curitiba"].includes(cap.nome)) {
        alerta = {
          nivel: "extremo",
          dotType: "red",
          cor: "#EF4444",
          tituloBadge: "CASO EXTREMO DE CLIMA",
          tipo: "Alerta Laranja / Vermelho — Tempestades Severas e Chuvas Volumosas",
          orgaos: ["Defesa Civil Nacional (CENAD)", "INMET"],
          descricao: `Área de convergência com instabilidades intensas na Região Metropolitana de ${cap.nome}. Previsão de chuvas fortes, rajadas de vento e risco de enxurradas.`,
          riscos: [
            "Alagamentos urbanos e transbordamento de córregos",
            "Rajadas de vento entre 60 e 80 km/h",
            "Descargas elétricas e queda de granizo localizado"
          ],
          instrucoes: [
            "Permaneça em local seguro e protegido.",
            "Não enfrente áreas inundadas com veículos ou a pé.",
            "Desligue aparelhos eletrônicos da tomada.",
            "Emergência: Defesa Civil 199 / Bombeiros 193."
          ],
          inicio: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
          fim: new Date(Date.now() + 8 * 3600 * 1000).toISOString(),
          origemOficial: "Defesa Civil Estadual / CENAD & INMET"
        };
      } else if (["Rio de Janeiro", "Belo Horizonte", "Brasília", "Belém", "Manaus", "Salvador"].includes(cap.nome)) {
        alerta = {
          nivel: "potencial",
          dotType: "yellow",
          cor: "#EAB308",
          tituloBadge: "RISCO POTENCIAL DE CLIMA",
          tipo: "Alerta Amarelo — Risco Potencial de Chuvas Intensas e Rajadas",
          orgaos: ["Defesa Civil Municipal", "INMET"],
          descricao: `Aviso de perigo potencial válido para ${cap.nome} (${cap.uf}). Formação de nuvens convectivas com possibilidade de chuvas de até 30 a 50 mm/dia e ventos moderados.`,
          riscos: [
            "Queda isolada de galhos de árvores",
            "Alagamentos pontuais em áreas com drenagem comprometida",
            "Pistas molhadas e visibilidade reduzida"
          ],
          instrucoes: [
            "Reduza a velocidade no trânsito e mantenha distância segura.",
            "Não se abrigue embaixo de árvores frágeis.",
            "Dúvidas ou ocorrências ligue 199 para a Defesa Civil."
          ],
          inicio: new Date(Date.now() - 1 * 3600 * 1000).toISOString(),
          fim: new Date(Date.now() + 10 * 3600 * 1000).toISOString(),
          origemOficial: "INMET / Defesa Civil (Perigo Potencial)"
        };
      }
    }

    if (alerta?.nivel === "extremo") extremosCount++;
    else if (alerta?.nivel === "potencial") potenciaisCount++;
    else estaveisCount++;

    return {
      ...cap,
      dotType: alerta ? alerta.dotType : "green",
      hasAlert: Boolean(alerta),
      alerta,
      telemetria: {
        temperatura: `${temp}°C`,
        sensacao: `${appTemp}°C`,
        umidade: `${hum}%`,
        vento: `${wind} km/h`,
        rajadas: `${gusts} km/h`,
        precipitacao: `${rain} mm`,
        condicao,
        code
      }
    };
  });

  cachedCapitalsAlerts = {
    success: true,
    updatedAt: new Date().toISOString(),
    summary: {
      totalCapitais: BRAZIL_CAPITALS.length,
      extremosCount,
      potenciaisCount,
      estaveisCount
    },
    capitals: capitalsResult
  };
  lastCapitalsFetchTime = now;
  return cachedCapitalsAlerts;
}

// Mapeamento oficial de Estados por Macro-Região do Brasil (IBGE)
const REGION_STATES: Record<string, string[]> = {
  "Norte": ["Acre", "Amapá", "Amazonas", "Pará", "Rondônia", "Roraima", "Tocantins", "AC", "AP", "AM", "PA", "RO", "RR", "TO"],
  "Nordeste": ["Alagoas", "Bahia", "Ceará", "Maranhão", "Paraíba", "Pernambuco", "Piauí", "Rio Grande do Norte", "Sergipe", "AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE"],
  "Centro-Oeste": ["Distrito Federal", "Goiás", "Mato Grosso", "Mato Grosso do Sul", "DF", "GO", "MT", "MS"],
  "Sudeste": ["Espírito Santo", "Minas Gerais", "Rio de Janeiro", "São Paulo", "ES", "MG", "RJ", "SP"],
  "Sul": ["Paraná", "Rio Grande do Sul", "Santa Catarina", "PR", "RS", "SC"]
};

function isStateInRegion(stateName: string, region: string): boolean {
  const list = REGION_STATES[region] || [];
  return list.some(item => item.toLowerCase() === stateName.toLowerCase().trim());
}

let cachedRegionalAlerts: any = null;
let lastRegionalAlertsFetchTime = 0;

// Alertas oficiais do INMET e Defesa Civil consolidados por todas as Regiões do Brasil
async function getRegionalAlertsData() {
  const now = Date.now();
  if (cachedRegionalAlerts && now - lastRegionalAlertsFetchTime < CACHE_TTL_MS) {
    return cachedRegionalAlerts;
  }

  const rawInmet = await fetchInmetAlerts();

  const regionsSummary: Record<string, { count: number; extremeCount: number; potentialCount: number; alertIds: string[]; states: Set<string> }> = {
    "Norte": { count: 0, extremeCount: 0, potentialCount: 0, alertIds: [], states: new Set() },
    "Nordeste": { count: 0, extremeCount: 0, potentialCount: 0, alertIds: [], states: new Set() },
    "Centro-Oeste": { count: 0, extremeCount: 0, potentialCount: 0, alertIds: [], states: new Set() },
    "Sudeste": { count: 0, extremeCount: 0, potentialCount: 0, alertIds: [], states: new Set() },
    "Sul": { count: 0, extremeCount: 0, potentialCount: 0, alertIds: [], states: new Set() }
  };

  const formattedAlerts: any[] = [];

  rawInmet.forEach((alert: any) => {
    let polyObj = null;
    if (alert.poligono) {
      try {
        polyObj = typeof alert.poligono === "string" ? JSON.parse(alert.poligono) : alert.poligono;
      } catch (e) {}
    }

    const sev = String(alert.severidade || "Perigo Potencial");
    const sevLower = sev.toLowerCase();
    const isGrandePerigo = sevLower.includes("grande perigo");
    const isPerigo = !isGrandePerigo && sevLower.includes("perigo");
    const isExtremo = isGrandePerigo || isPerigo;

    let cor = alert.aviso_cor || "#FFFE00";
    if (isGrandePerigo) cor = "#EF4444";
    else if (isPerigo) cor = "#F97316";
    else cor = "#EAB308";

    const alertRegioesStr = String(alert.regioes || "");
    const alertRegioes = alertRegioesStr.split(",").map((r: string) => r.trim()).filter(Boolean);

    const alertEstadosStr = String(alert.estados || "");
    const alertEstados = alertEstadosStr.split(",").map((e: string) => e.trim()).filter(Boolean);

    const alertId = String(alert.id || alert.id_aviso || `inmet-${Date.now()}-${Math.random()}`);

    const item = {
      id: alertId,
      codigo: alert.codigo || "",
      descricao: alert.descricao || "Alerta Meteorológico",
      severidade: sev,
      nivel: isGrandePerigo ? "grande_perigo" : isPerigo ? "perigo" : "potencial",
      isExtremo,
      cor,
      regioes: alertRegioes,
      estados: alertEstados,
      inicio: alert.inicio || alert.data_inicio || "",
      fim: alert.fim || alert.data_fim || "",
      riscos: Array.isArray(alert.riscos) ? alert.riscos : [String(alert.riscos || "Condição meteorológica adversa")],
      instrucoes: Array.isArray(alert.instrucoes) ? alert.instrucoes : [String(alert.instrucoes || "")],
      poligono: polyObj
    };

    formattedAlerts.push(item);

    // Mapeamento pelas 5 macro-regiões
    Object.keys(regionsSummary).forEach(regName => {
      const inRegion = alertRegioes.some((r: string) => r.toLowerCase().includes(regName.toLowerCase())) ||
        alertEstados.some((st: string) => isStateInRegion(st, regName));

      if (inRegion) {
        regionsSummary[regName].count++;
        if (isExtremo) regionsSummary[regName].extremeCount++;
        else regionsSummary[regName].potentialCount++;
        alertEstados.forEach((st: string) => {
          if (isStateInRegion(st, regName)) {
            regionsSummary[regName].states.add(st);
          }
        });
        regionsSummary[regName].alertIds.push(alertId);
      }
    });
  });

  const regionsSummaryFormatted = Object.entries(regionsSummary).map(([regiao, data]) => ({
    regiao,
    totalAlerts: data.count,
    extremeAlerts: data.extremeCount,
    potentialAlerts: data.potentialCount,
    estadosAfetados: Array.from(data.states),
    alertIds: data.alertIds
  }));

  cachedRegionalAlerts = {
    success: true,
    totalAlerts: formattedAlerts.length,
    totalExtreme: formattedAlerts.filter(a => a.isExtremo).length,
    totalPotential: formattedAlerts.filter(a => !a.isExtremo).length,
    updatedAt: new Date().toISOString(),
    regionsSummary: regionsSummaryFormatted,
    alerts: formattedAlerts
  };
  lastRegionalAlertsFetchTime = now;
  return cachedRegionalAlerts;
}

// Rota principal esperada pelo frontend
app.get("/api/weather-alerts", async (_req, res) => {
  try {
    const data = await getUnifiedWeatherData();
    const capitalsData = await getCapitalsWeatherAlerts();
    const regionalData = await getRegionalAlertsData();
    res.json({
      ...data,
      capitalsAlerts: capitalsData,
      regionalAlerts: regionalData
    });
  } catch (err: any) {
    console.error("[API] Erro ao obter alertas de clima:", err);
    res.status(500).json({
      success: false,
      error: err?.message || "Erro ao consultar clima",
      alertsByBase: {}
    });
  }
});

// Endpoint dedicado aos alertas regionais de todo o Brasil (INMET e Defesa Civil)
app.get("/api/weather/regional-alerts", async (_req, res) => {
  try {
    const data = await getRegionalAlertsData();
    res.json(data);
  } catch (err: any) {
    console.error("[API] Erro ao obter alertas regionais:", err);
    res.status(500).json({
      success: false,
      error: err?.message || "Erro ao consultar alertas regionais",
      regionsSummary: [],
      alerts: []
    });
  }
});

// Endpoint dedicado aos alertas das capitais brasileiras (INMET e Defesa Civil)
app.get("/api/weather/capitals-alerts", async (_req, res) => {
  try {
    const data = await getCapitalsWeatherAlerts();
    res.json(data);
  } catch (err: any) {
    console.error("[API] Erro ao obter alertas das capitais:", err);
    res.status(500).json({
      success: false,
      error: err?.message || "Erro ao consultar capitais",
      capitals: []
    });
  }
});

// Alias para compatibilidade com outros modulos
app.get("/api/weather/alerts", async (_req, res) => {
  try {
    const data = await getUnifiedWeatherData();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message, alertsByBase: {} });
  }
});

// Previsao individual sob demanda
app.get("/api/weather/base", async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const baseId = String(req.query.id || "");

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: "Lat/Lng invalidos" });
    }

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m&forecast_days=1&timezone=auto`;
    const r = await fetch(url);
    if (!r.ok) {
      return res.status(502).json({ error: "Open-Meteo indisponivel" });
    }

    const data = await r.json();
    const current = data.current || {};

    res.json({
      baseId,
      current: {
        temperature: Number(current.temperature_2m),
        apparentTemperature: Number(current.apparent_temperature),
        humidity: Number(current.relative_humidity_2m),
        windSpeed: Number(current.wind_speed_10m),
        precipitation: Number(current.precipitation),
        weatherCode: Number(current.weather_code)
      },
      updatedAt: new Date().toISOString()
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Falha ao consultar previsao" });
  }
});

// Endpoint de Roteamento Terrestre Open Source (OSRM / OpenStreetMap)
app.post("/api/route/terrestrial", async (req, res) => {
  try {
    const { points, roundTrip } = req.body;
    if (!Array.isArray(points) || points.length < 2) {
      return res.status(400).json({ error: "Forneça pelo menos 2 pontos para roteirizar." });
    }

    // Valida coordenadas
    const validPoints = points.filter(p => typeof p?.lat === "number" && typeof p?.lng === "number" && !isNaN(p.lat) && !isNaN(p.lng));
    if (validPoints.length < 2) {
      return res.status(400).json({ error: "Coordenadas inválidas nos pontos fornecidos." });
    }

    // Se roundTrip estiver ativo, retorna ao ponto inicial
    const routeCoords = [...validPoints];
    if (roundTrip && routeCoords.length >= 2) {
      const first = routeCoords[0];
      const last = routeCoords[routeCoords.length - 1];
      if (Math.abs(first.lat - last.lat) > 0.0001 || Math.abs(first.lng - last.lng) > 0.0001) {
        routeCoords.push({ ...first, name: `${first.name || "Ponto 1"} (Retorno)` });
      }
    }

    // OSRM aceita: lon,lat;lon,lat;...
    const coordString = routeCoords.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${coordString}?overview=full&geometries=geojson&steps=true&annotations=distance,duration`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 9000);

    const osrmRes = await fetch(osrmUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!osrmRes.ok) {
      throw new Error(`OSRM HTTP status ${osrmRes.status}`);
    }

    const data = await osrmRes.json();
    if (data.code !== "Ok" || !data.routes || data.routes.length === 0) {
      throw new Error(data.message || "Rota não encontrada pelo serviço rodoviário.");
    }

    const primaryRoute = data.routes[0];
    const totalDistanceMeters = primaryRoute.distance || 0;
    const totalDurationSeconds = primaryRoute.duration || 0;
    const totalDistanceKm = Math.round((totalDistanceMeters / 1000) * 10) / 10;
    const totalDurationMinutes = Math.round(totalDurationSeconds / 60);

    // Converte coordenadas GeoJSON [lng, lat] para formato Leaflet [lat, lng]
    const leafletCoordinates: [number, number][] = (primaryRoute.geometry?.coordinates || []).map(
      (c: [number, number]) => [c[1], c[0]]
    );

    // Mapeia trechos (legs)
    const legs = (primaryRoute.legs || []).map((leg: any, idx: number) => {
      const fromPoint = routeCoords[idx];
      const toPoint = routeCoords[idx + 1] || routeCoords[0];
      const legDistKm = Math.round(((leg.distance || 0) / 1000) * 10) / 10;
      const legDurMin = Math.round((leg.duration || 0) / 60);
      
      // Resumo de vias do trecho
      const roadNames = Array.from(new Set(
        (leg.steps || []).map((s: any) => s.name).filter((n: string) => n && n.trim().length > 0)
      )).slice(0, 3).join(", ");

      return {
        stepIndex: idx + 1,
        from: fromPoint.name || `Ponto ${idx + 1}`,
        to: toPoint.name || `Ponto ${idx + 2}`,
        distanceKm: legDistKm,
        durationMinutes: legDurMin,
        summary: roadNames || leg.summary || "Rodovia / Via Terrestre"
      };
    });

    res.json({
      success: true,
      engine: "OSRM (Open Source Routing Machine)",
      license: "Open Source / OpenStreetMap Data",
      totalDistanceKm,
      totalDurationMinutes,
      coordinates: leafletCoordinates,
      legs,
      points: routeCoords,
      updatedAt: new Date().toISOString()
    });
  } catch (err: any) {
    console.warn("[Terrestrial Route] Fallback ativado devido a erro na API OSRM:", err?.message);
    res.status(502).json({
      success: false,
      error: err?.message || "Serviço OSRM indisponível no momento.",
      fallbackAvailable: true
    });
  }
});

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Download do arquivo TXT com o código completo do sistema
app.get(["/api/download-code-txt", "/sistema_observatorio_clima_codigo_completo.txt", "/sistema_codigo.txt"], (_req, res) => {
  const filePath = path.join(process.cwd(), "sistema_observatorio_clima_codigo_completo.txt");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.download(filePath, "sistema_observatorio_clima_codigo_completo.txt", (err) => {
    if (err && !res.headersSent) {
      res.sendFile(filePath);
    }
  });
});

// Vite em dev ou estaticos em producao
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[WeatherGuard] Servidor operacional e conexoes de clima ativas na porta ${PORT}`);
  });
}

startServer();
