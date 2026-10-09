import {describe,it,expect} from 'vitest';
import {ModelRegistry,providerEndpoints} from '../electron/agents/model-registry';
const config={baseUrl:'http://mock.invalid/proxy/v1/chat/completions',defaultModel:'manual',reasoningEffort:'none' as const,apiKey:'isolated-key'};
describe('Provider model registry (local Mock only)',()=>{
  it.each([['https://api.test','https://api.test/v1/models'],['https://api.test/v1','https://api.test/v1/models'],['https://api.test/proxy/compatible-mode/v1/chat/completions','https://api.test/proxy/compatible-mode/v1/models']])('preserves API prefixes for %s',(base,models)=>expect(providerEndpoints(base).models).toBe(models));
  it('deduplicates catalog IDs without inventing capabilities',async()=>{
    let endpoint='';const registry=new ModelRegistry(async url=>{endpoint=String(url);return new Response(JSON.stringify({data:[{id:'manual'},{id:'manual'},{id:'new-model'}]}));});
    const result=await registry.fetchModels(config);expect(endpoint).toBe('http://mock.invalid/proxy/v1/models');expect(result.ok).toBe(true);expect(result.models).toHaveLength(2);expect(result.models[0].capabilities.thinkingOff).toBe('unknown');
  });
  it('unsupported directories preserve manual selection; errors cannot echo credentials',async()=>{
    const unavailable=new ModelRegistry(async()=>new Response('{}',{status:404}));expect((await unavailable.fetchModels(config)).directory).toBe('unsupported');
    const echo=new ModelRegistry(async()=>new Response(JSON.stringify({data:[{id:config.apiKey}]})));const result=await echo.fetchModels(config);expect(result.ok).toBe(false);expect(JSON.stringify(result)).not.toContain(config.apiKey);
    const escaped=config.apiKey.split('').map(c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')).join('');
    const escapedEcho=new ModelRegistry(async()=>new Response('{"data":[{"id":"'+escaped+'"}]}'));const rejected=await escapedEcho.fetchModels(config);expect(rejected.ok).toBe(false);expect(JSON.stringify(rejected)).not.toContain(config.apiKey);
  });
  it('Thinking OFF is an actual provider parameter and unknown controls fail without fallback',()=>{
    const registry=new ModelRegistry();expect(registry.reasoningParameters('https://api.openai.com/v1','gpt-5.1','off','provider-default')).toEqual({reasoning_effort:'none'});
    expect(registry.reasoningParameters('https://dashscope.aliyuncs.com/compatible-mode/v1','qwen3-32b','off','provider-default')).toEqual({enable_thinking:false});
    expect(()=>registry.reasoningParameters(config.baseUrl,'manual','off','provider-default')).toThrow('尚未确认');
    expect(()=>registry.reasoningParameters('https://api.openai.com/v1','gpt-5','off','provider-default')).toThrow('不受支持');
    expect(()=>registry.reasoningParameters('https://api.openai.com/v1','gpt-5.1','on','xhigh')).toThrow('不支持');
  });
});
