import { freezeDefinitions } from './freeze';
export const FACTIONS = freezeDefinitions({
  starfleet: { name: 'Federation' },
  pirate: { name: 'Pirate' },
  romulan: { name: 'Romulan' },
});
