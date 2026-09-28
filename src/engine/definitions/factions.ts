import { freezeDefinitions } from './freeze';

export interface ContactFactionDefinition {
  name: string;
  contactName: string;
  shield: number;
  scanIntel: number;
  scanMessage: string;
  warningMessage: string;
  retreatOnWarning: boolean;
  detectionRange: number;
  damage: number;
}
const contactFactions = {
  klingon: {
    name: 'Klingon',
    contactName: 'Klingon · 克拉斯家族巡掠舰',
    shield: 65,
    scanIntel: 3,
    scanMessage: '越界证据已记录。',
    warningMessage: '威慑成立。',
    retreatOnWarning: false,
    detectionRange: 200,
    damage: 11,
  },
  romulan: {
    name: 'Romulan',
    contactName: 'Romulan · 隐蔽侦察舰',
    shield: 45,
    scanIntel: 8,
    scanMessage: '隐蔽航迹已记录。',
    warningMessage: '侦察行动已暴露。',
    retreatOnWarning: true,
    detectionRange: 110,
    damage: 8,
  },
} satisfies Record<string, ContactFactionDefinition>;
export const FACTIONS = freezeDefinitions({ starfleet: { name: 'Starfleet' }, ...contactFactions });
export type FactionId = keyof typeof FACTIONS;
export type ContactFactionId = keyof typeof contactFactions;
