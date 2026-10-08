import { freezeDefinitions } from './freeze';
import type { AgentStateDynamics } from '../types';
export const freshAgentDynamics = (): AgentStateDynamics => ({
  activity: 'idle',
  fatigueRate: -0.1,
  stressRate: -0.2,
  resentmentRate: 0,
  engagementTick: null,
  lastDangerAt: 0,
  hullBands: [],
  thresholds: [],
  recent: [],
});
export const AGENT_RULES = freezeDefinitions({
  recruitmentCredits: 60,
  trainingCredits: 90,
  trainingMinutes: 90,
  memoryLimit: 32,
  chatObservationLimit: 24,
  minDecisionMinutes: 5,
  fatigue: { work: 0.25, combat: 0.5, idle: -0.1, docked: -0.25, rest: -0.75 },
  stress: { combat: 0.3, threat: 0.15, work: -0.1, idle: -0.2, docked: -0.2, rest: -0.5 },
  overworkResentment: 0.1,
  restResentment: -0.15,
  engagementQuietMinutes: 10,
});
