import { freezeDefinitions } from './freeze';
export const RULES = freezeDefinitions({
  baseSensors: 290,
  intelTTL: 30,
  decisionInterval: 5,
  cloakDrain: 5,
  decloakMinutes: 2,
  surveyMinutes: 24,
  defenseMinutes: 45,
  loadMinutes: 3,
  serviceMinutes: 20,
  towMinutes: 35,
  searchMinutes: 30,
  resupplyMinutes: 180,
  incursionMinutes: 220,
  maxEnemies: 7,
  pirateEntry: { x: 20, y: 710 },
  romulanEntry: { x: 1570, y: 200 },
});
