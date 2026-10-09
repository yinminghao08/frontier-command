import type {Observation} from '../src/engine/types';
import type {ConnectionConfig} from '../electron/agents/config';
import {ChatCompletionsClient} from '../electron/agents/client';
import {cognitionJsonSchema} from '../src/engine/cognition-protocol';
/** A transport-only request. Engine authority tests use actual cognition tickets;
 * this fixture never submits a response or constructs a physical command. */
export async function askIntent(client:ChatCompletionsClient,config:ConnectionConfig,observation:Observation,signal=new AbortController().signal){
 const response=await client.cognize(config,{requestId:'transport-fixture',agentId:observation.operatorId,revision:observation.self?.decision.revision??0,purpose:'intent',schema:cognitionJsonSchema('intent'),context:{input:'报告状态',self:observation.self,objective:observation.objective},prompt:'Intent: only the supplied purpose schema.',outputBudget:1800},observation.self?.modelConfig??{model:null,reasoningEffort:null},signal);
 if(response.purpose!=='intent')throw Error('Unexpected purpose');return response.decision;
}
export const conversation=(reply='舰况良好，继续等待')=>({disposition:'conversation',proposal:null,objectiveId:null,allowWormholes:true,reply});
