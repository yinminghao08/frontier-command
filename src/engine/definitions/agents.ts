import { freezeDefinitions } from './freeze';
export const AGENT_RULES = freezeDefinitions({
  recruitmentCredits: 60,
  trainingCredits: 90,
  trainingMinutes: 90,
  memoryLimit: 32,
  chatObservationLimit: 24,
  escortDeadline: 60,
  idleReviewMinutes: 30,
  minDecisionMinutes: 5,
  errorRetryMinutes: 30,
});
