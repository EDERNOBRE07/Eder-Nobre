import { Sector } from '../types.ts';

export const SECTORS: Sector[] = [
  { id: 'educacao', name: 'Educação', color: '#1565C0', icon: '📚' },
  { id: 'saude', name: 'Saúde', color: '#2E7D32', icon: '🏥' },
  { id: 'seguranca', name: 'Segurança', color: '#C62828', icon: '🛡️' },
  { id: 'infra', name: 'Infraestrutura', color: '#E65100', icon: '🏗️' },
  { id: 'cultura', name: 'Cultura', color: '#6A1B9A', icon: '🎭' },
  { id: 'meio', name: 'Meio Ambiente', color: '#558B2F', icon: '🌿' },
  { id: 'social', name: 'Social', color: '#AD1457', icon: '👥' },
  { id: 'agro', name: 'Agro', color: '#5D4037', icon: '🌾' },
  { id: 'fiscal', name: 'Fiscal', color: '#F57F17', icon: '💰' },
  { id: 'comercio', name: 'Comércio', color: '#00695C', icon: '🏪' },
  { id: 'tecnologia', name: 'Tecnologia', color: '#283593', icon: '💻' },
];

export function getSectorById(id: string): Sector | undefined {
  return SECTORS.find(s => s.id === id);
}
