const fs = require('fs');
const path = require('path');

const ROOT_DIR = process.cwd();

const filesToInclude = [
  { path: 'server.ts', description: 'Servidor Backend Express, Telemetria INMET, Open-Meteo, Alertas Regionais/Capitais e Rotas OSRM' },
  { path: 'index.html', description: 'Frontend Completo (Interface, Mapa Leaflet, Alertas Extremos, Capitais, Regiões, Voz/Áudio, Socorro 193/199)' },
  { path: 'package.json', description: 'Configuração de Dependências e Scripts do Projeto' },
  { path: 'vite.config.ts', description: 'Configuração do Bundler Vite e Tailwind CSS' },
  { path: 'tsconfig.json', description: 'Configuração do Compilador TypeScript' },
  { path: 'metadata.json', description: 'Metadados da Aplicação AI Studio' },
  { path: '.env.example', description: 'Variáveis de Ambiente de Exemplo' },
  { path: 'src/main.tsx', description: 'Ponto de Entrada React' },
  { path: 'src/App.tsx', description: 'Componente Base App' },
  { path: 'src/index.css', description: 'Estilos Globais CSS' },
  { path: 'public/manifest.webmanifest', description: 'Manifest PWA para Instalação no Dispositivo' },
  { path: 'public/sw.js', description: 'Service Worker PWA Offline' },
  { path: 'public/weather-alerts-sw.js', description: 'Service Worker Dedicado aos Alertas em Segundo Plano' }
];

function generateTxt() {
  const now = new Date().toISOString();
  let buffer = '';

  buffer += '================================================================================\n';
  buffer += '       OBSERVATÓRIO DO CLIMA — CÓDIGO COMPLETO DO SISTEMA (ARQUIVO TXT)\n';
  buffer += '================================================================================\n';
  buffer += `Data de Exportação: ${now}\n`;
  buffer += 'Sistema: Observatório do Clima — Monitoramento de Alertas Meteorológicos e Rotas\n';
  buffer += 'Ambiente: Node.js + Express + TypeScript + Vite + Tailwind CSS + Leaflet\n';
  buffer += 'Fontes de Dados Integradas: INMET Oficial, Open-Meteo, OSRM (OpenStreetMap)\n';
  buffer += '================================================================================\n\n';

  buffer += 'ÍNDICE DE ARQUIVOS INCLUÍDOS:\n';
  buffer += '--------------------------------------------------------------------------------\n';
  filesToInclude.forEach((f, idx) => {
    const fullPath = path.join(ROOT_DIR, f.path);
    if (fs.existsSync(fullPath)) {
      const stats = fs.statSync(fullPath);
      const lines = fs.readFileSync(fullPath, 'utf-8').split('\n').length;
      buffer += `${(idx + 1).toString().padStart(2, '0')}. [${f.path}] (${lines} linhas, ${(stats.size / 1024).toFixed(1)} KB)\n`;
      buffer += `    Descrição: ${f.description}\n`;
    } else {
      buffer += `${(idx + 1).toString().padStart(2, '0')}. [${f.path}] (Arquivo não encontrado)\n`;
    }
  });
  buffer += '--------------------------------------------------------------------------------\n\n';

  filesToInclude.forEach((f, idx) => {
    const fullPath = path.join(ROOT_DIR, f.path);
    if (!fs.existsSync(fullPath)) return;

    const content = fs.readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');

    buffer += '\n';
    buffer += '################################################################################\n';
    buffer += `### ARQUIVO ${(idx + 1)}/${filesToInclude.length}: ${f.path}\n`;
    buffer += `### DESCRIÇÃO: ${f.description}\n`;
    buffer += `### TOTAL DE LINHAS: ${lines.length}\n`;
    buffer += '################################################################################\n\n';

    buffer += content;
    buffer += '\n\n';
    buffer += `### [FIM DO ARQUIVO: ${f.path}] ###\n\n`;
  });

  buffer += '================================================================================\n';
  buffer += '                FIM DO CÓDIGO COMPLETO DO SISTEMA\n';
  buffer += '================================================================================\n';

  const outPath1 = path.join(ROOT_DIR, 'sistema_observatorio_clima_codigo_completo.txt');
  const outPath2 = path.join(ROOT_DIR, 'public', 'sistema_observatorio_clima_codigo_completo.txt');
  const aliasPath1 = path.join(ROOT_DIR, 'sistema_codigo.txt');
  const aliasPath2 = path.join(ROOT_DIR, 'public', 'sistema_codigo.txt');

  fs.writeFileSync(outPath1, buffer, 'utf-8');
  fs.writeFileSync(outPath2, buffer, 'utf-8');
  fs.writeFileSync(aliasPath1, buffer, 'utf-8');
  fs.writeFileSync(aliasPath2, buffer, 'utf-8');

  console.log(`TXT gerado com sucesso! Tamanho: ${(buffer.length / 1024).toFixed(1)} KB`);
}

generateTxt();
