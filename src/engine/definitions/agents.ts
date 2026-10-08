import { freezeDefinitions } from './freeze';
export const AGENT_RULES = freezeDefinitions({
  recruitmentCredits: 60,
  trainingCredits: 90,
  trainingMinutes: 90,
  memoryLimit: 32,
  chatObservationLimit: 24,
  minDecisionMinutes: 5,
});
