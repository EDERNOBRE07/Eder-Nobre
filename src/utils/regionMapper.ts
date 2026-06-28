import { Region } from '../types.ts';

export const REGIONS: Region[] = [
  { id: 'gfpolis', name: 'Grande Florianópolis', color: '#1565C0', icon: '🏛️' },
  { id: 'norte', name: 'Norte Catarinense', color: '#0277BD', icon: '🏭' },
  { id: 'vitajai', name: 'Vale do Itajaí', color: '#00695C', icon: '🌊' },
  { id: 'sul', name: 'Sul Catarinense', color: '#2E7D32', icon: '⛏️' },
  { id: 'serrano', name: 'Planalto Serrano', color: '#4527A0', icon: '🏔️' },
  { id: 'pnorte', name: 'Planalto Norte', color: '#0D47A1', icon: '🌲' },
  { id: 'goeste', name: 'Grande Oeste', color: '#E65100', icon: '🌾' },
  { id: 'eoeste', name: 'Extremo Oeste', color: '#C62828', icon: '🤝' },
  { id: 'cmoeste', name: 'Contestado / Meio Oeste', color: '#6A1B9A', icon: '⛰️' },
];

export const CITY_REGION_MAP: Record<string, string> = {
  // Grande Florianópolis
  'florianópolis': 'gfpolis', 'florianopolis': 'gfpolis', 'são josé': 'gfpolis', 'palhoça': 'gfpolis',
  'biguaçu': 'gfpolis', 'santo amaro da imperatriz': 'gfpolis', 'águas mornas': 'gfpolis',
  'aguas mornas': 'gfpolis', 'são pedro de alcântara': 'gfpolis', 'garopaba': 'gfpolis',
  'paulo lopes': 'gfpolis', 'rancho queimado': 'gfpolis', 'angelina': 'gfpolis',
  'antônio carlos': 'gfpolis', 'anitápolis': 'gfpolis', 'leoberto leal': 'gfpolis',
  'major gercino': 'gfpolis', 'nova trento': 'gfpolis', 'são bonifácio': 'gfpolis',
  'alfredo wagner': 'gfpolis', 'tijucas': 'gfpolis', 'canelinha': 'gfpolis',
  'são joão batista': 'gfpolis', 'porto belo': 'gfpolis', 'governador celso ramos': 'gfpolis',
  'bombinhas': 'gfpolis', 'itapema': 'gfpolis',
  // Norte Catarinense
  'joinville': 'norte', 'jaraguá do sul': 'norte', 'jaragua do sul': 'norte',
  'são francisco do sul': 'norte', 'araquari': 'norte', 'guaramirim': 'norte',
  'corupá': 'norte', 'corupa': 'norte', 'schroeder': 'norte', 'massaranduba': 'norte',
  'barra velha': 'norte', 'garuva': 'norte', 'balneário barra do sul': 'norte',
  'campo alegre': 'norte', 'rio negrinho': 'norte', 'são bento do sul': 'norte',
  // Vale do Itajaí
  'blumenau': 'vitajai', 'itajaí': 'vitajai', 'itajai': 'vitajai', 'brusque': 'vitajai',
  'balneário camboriú': 'vitajai', 'balneario camboriu': 'vitajai', 'gaspar': 'vitajai',
  'indaial': 'vitajai', 'navegantes': 'vitajai', 'timbó': 'vitajai', 'timbo': 'vitajai',
  'rodeio': 'vitajai', 'rio do sul': 'vitajai', 'ibirama': 'vitajai', 'taió': 'vitajai',
  'taio': 'vitajai', 'ituporanga': 'vitajai', 'pouso redondo': 'vitajai',
  'trombudo central': 'vitajai', 'aurora': 'vitajai', 'agrolândia': 'vitajai',
  'imbuia': 'vitajai', 'rio do campo': 'vitajai', 'vidal ramos': 'vitajai',
  'petrolândia': 'vitajai', 'presidente getúlio': 'vitajai', 'apiúna': 'vitajai',
  'botuverá': 'vitajai', 'guabiruba': 'vitajai', 'camboriú': 'vitajai',
  // Sul Catarinense
  'criciúma': 'sul', 'criciuma': 'sul', 'tubarão': 'sul', 'tubarao': 'sul', 'laguna': 'sul',
  'araranguá': 'sul', 'ararangua': 'sul', 'içara': 'sul', 'icara': 'sul',
  'balneário gaivota': 'sul', 'balneario gaivota': 'sul', 'são joão do sul': 'sul',
  'sombrio': 'sul', 'praia grande': 'sul', 'jacinto machado': 'sul', 'urussanga': 'sul',
  'orleans': 'sul', 'braço do norte': 'sul', 'imbituba': 'sul', 'capivari de baixo': 'sul',
  'gravatal': 'sul', 'jaguaruna': 'sul', 'sangão': 'sul', 'morro da fumaça': 'sul',
  'nova veneza': 'sul', 'forquilhinha': 'sul', 'lauro müller': 'sul',
  // Planalto Serrano
  'lages': 'serrano', 'bom retiro': 'serrano', 'são joaquim': 'serrano',
  'curitibanos': 'serrano', 'bocaina do sul': 'serrano', 'campo belo do sul': 'serrano',
  'cerro negro': 'serrano', 'correia pinto': 'serrano', 'otacílio costa': 'serrano',
  'painel': 'serrano', 'palmeira': 'serrano', 'ponte alta': 'serrano',
  'são josé do cerrito': 'serrano', 'urubici': 'serrano', 'urupema': 'serrano',
  'abdon batista': 'serrano', 'anita garibaldi': 'serrano', 'celso ramos': 'serrano',
  'vargem': 'serrano', 'brunópolis': 'serrano', 'santa cecília': 'serrano',
  // Planalto Norte
  'mafra': 'pnorte', 'canoinhas': 'pnorte', 'porto união': 'pnorte', 'porto uniao': 'pnorte',
  'três barras': 'pnorte', 'tres barras': 'pnorte', 'irineópolis': 'pnorte',
  'major vieira': 'pnorte', 'itaiópolis': 'pnorte', 'papanduva': 'pnorte',
  'bela vista do toldo': 'pnorte', 'monte castelo': 'pnorte', 'timbó grande': 'pnorte',
  'calmon': 'pnorte',
  // Grande Oeste
  'chapecó': 'goeste', 'chapeco': 'goeste', 'xanxerê': 'goeste', 'xanxere': 'goeste',
  'xaxim': 'goeste', 'abelardo luz': 'goeste', 'são lourenço do oeste': 'goeste',
  'quilombo': 'goeste', 'seara': 'goeste', 'ipumirim': 'goeste', 'lindóia do sul': 'goeste',
  'lindoia do sul': 'goeste', 'ponte serrada': 'goeste', 'irani': 'goeste',
  'vargem bonita': 'goeste', 'ouro': 'goeste', 'arabutã': 'goeste', 'arabuta': 'goeste',
  'concórdia': 'goeste', 'concordia': 'goeste', 'peritiba': 'goeste', 'piratuba': 'goeste',
  'ipira': 'goeste', 'capinzal': 'goeste', 'zortéa': 'goeste', 'zortea': 'goeste',
  'jaborá': 'goeste', 'nova erechim': 'goeste', 'formosa do sul': 'goeste',
  'galvão': 'goeste', 'jupiá': 'goeste', 'entre rios': 'goeste', 'coronel martins': 'goeste',
  // Extremo Oeste
  'maravilha': 'eoeste', 'são miguel do oeste': 'eoeste', 'sao miguel do oeste': 'eoeste',
  'modelo': 'eoeste', 'cunha porã': 'eoeste', 'cunha pora': 'eoeste',
  'iporã do oeste': 'eoeste', 'ipora do oeste': 'eoeste', 'palma sola': 'eoeste',
  'são joão do oeste': 'eoeste', 'descanso': 'eoeste', 'mondaí': 'eoeste', 'mondai': 'eoeste',
  'romelândia': 'eoeste', 'romelandia': 'eoeste', 'são miguel da boa vista': 'eoeste',
  'sao miguel da boa vista': 'eoeste', 'belmonte': 'eoeste', 'tigrinhos': 'eoeste',
  'saudades': 'eoeste', 'riqueza': 'eoeste', 'itapiranga': 'eoeste', 'tunápolis': 'eoeste',
  'anchieta': 'eoeste', 'barra bonita': 'eoeste', 'guaraciaba': 'eoeste',
  'guarujá do sul': 'eoeste', 'paraíso': 'eoeste', 'princesa': 'eoeste',
  'santa helena': 'eoeste', 'campo erê': 'eoeste', 'flor do sertão': 'eoeste',
  'dionísio cerqueira': 'eoeste', 'caibi': 'eoeste', 'palmitos': 'eoeste', 'pinhalzinho': 'eoeste',
  // Contestado / Meio Oeste
  'joaçaba': 'cmoeste', 'joacaba': 'cmoeste', 'caçador': 'cmoeste', 'cacador': 'cmoeste',
  'videira': 'cmoeste', 'campos novos': 'cmoeste', 'luzerna': 'cmoeste',
  "herval d'oeste": 'cmoeste', 'tangará': 'cmoeste', 'tangara': 'cmoeste',
  'fraiburgo': 'cmoeste', 'iomerê': 'cmoeste', 'monte carlo': 'cmoeste',
  'macieira': 'cmoeste', 'salto veloso': 'cmoeste', 'arroio trinta': 'cmoeste',
  'ibiam': 'cmoeste', 'catanduvas': 'cmoeste', 'pinheiro preto': 'cmoeste',
  'lacerdópolis': 'cmoeste', 'treze tílias': 'cmoeste', 'água doce': 'cmoeste',
  'erval velho': 'cmoeste', 'lebon régis': 'cmoeste',
};

export function normalizeCityName(s: string): string {
  return (s || '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function getRegionIdForCity(cidade?: string): string | null {
  if (!cidade) return null;
  const lc = cidade.toLowerCase().trim();
  const nc = normalizeCityName(cidade);

  // Direct matches
  if (CITY_REGION_MAP[lc]) return CITY_REGION_MAP[lc];
  if (CITY_REGION_MAP[nc]) return CITY_REGION_MAP[nc];

  // RegEx keyword-based fallbacks for descriptions
  if (/extremo.?oeste/i.test(nc)) return 'eoeste';
  if (/meio.?oeste|contestado/i.test(nc)) return 'cmoeste';
  if (/grande.?oeste|oeste.?catarinense|faixa.?fronteira|fronteira/i.test(nc)) return 'goeste';
  if (/planalto.?norte/i.test(nc)) return 'pnorte';
  if (/planalto.?serrano|serra.?catarinense/i.test(nc)) return 'serrano';
  if (/vale.?itajai/i.test(nc)) return 'vitajai';
  if (/sul.?catarin|litoral.?sul/i.test(nc)) return 'sul';
  if (/norte.?catarin/i.test(nc)) return 'norte';
  if (/grande.?florianopolis|florianopolis|capital/i.test(nc)) return 'gfpolis';
  if (/\boeste\b/i.test(nc)) return 'goeste';

  // Substring matching
  for (const [key, value] of Object.entries(CITY_REGION_MAP)) {
    const normKey = normalizeCityName(key);
    if (normKey.length > 4 && nc.includes(normKey)) {
      return value;
    }
  }

  return null;
}
