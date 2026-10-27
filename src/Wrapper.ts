// Emscripten --pre-js: bundled to build/Wrapper.js and placed inside the generated module's scope by src/make

import type { EpModeValue, LoadOptions, Model, Module as VosklettoModule, Recognizer as VosklettoRecognizer, SpkModel } from './voskletto.js';
import { MODEL_CACHE, maybeDecompressModel, needsModelFetch } from './modelCache.js';
import { handleOutcome, type Outcome } from './results.js';
import { createProcessorUrl, createTransferer } from './transferer.js';

interface RawModel {
  findWord(word: string): number;
  delete(): void;
}
interface RawRecognizer {
  acceptWaveform(start: number, len: number): string;
  reset(): void;
  setWords(words: boolean): void;
  setPartialWords(partialWords: boolean): void;
  setNLSML(nlsml: boolean): void;
  setMaxAlternatives(alts: number): void;
  setGrm(grm: string): void;
  setSpkModel(spkModel: RawModel): void;
  setEndpointerMode(mode: EpModeValue): void;
  setEndpointerDelays(tStartMax: number, tEnd: number, tMax: number): void;
  delete(): void;
}
// Registered on Module by Embind (Bindings.cc)
interface Embind {
  CommonModel: new (index: number, normalMdl: boolean, tarStart: number, tarSize: number) => RawModel;
  Recognizer: new (index: number, sampleRate: number, model: RawModel, ...rest: [] | [RawModel] | [string, number]) => RawRecognizer;
}

// Emscripten runtime, in scope because this file is placed inside the generated module
declare let Module: object;
declare const ENVIRONMENT_IS_WASM_WORKER: boolean;
declare const HEAPU8: Uint8Array;
declare const HEAPF32: Float32Array;
declare function _malloc(size: number): number;
declare function _free(ptr: number): void;

const embind = () => Module as Embind;

// Runs on the main thread and in a voskletto-worker, but not in Wasm workers
if (!ENVIRONMENT_IS_WASM_WORKER) {

  // 'var' to expose this outside the if, fireEv (Util.cc) dispatches on it
  var objs: EventTarget[] = [];

  // Module is still the options passed to loadVoskletto here
  const cacheName = (Module as LoadOptions)['cacheName'] ?? MODEL_CACHE;
  const _cache = caches.open(cacheName);
  const processorURL = createProcessorUrl();

  // Settles from fireEv: no detail on success, the error message otherwise
  const settle = <T extends EventTarget>(target: T) => new Promise<T>((resolve, reject) => {
    target.addEventListener('', ev => {
      const detail = (ev as CustomEvent<string | null>).detail;
      if (!detail) resolve(target);
      else reject(detail);
    }, { once: true });
  });

  class CommonModel extends EventTarget {
    declare obj: RawModel;
    declare findWord?: (word: string) => number;
    constructor() {
      super();
      objs.push(this);
    }
    delete() {
      this.obj.delete();
    }
    static async mk(url: string, storepath: string, id: string, normalMdl: boolean): Promise<CommonModel> {
      const mdl = new CommonModel();
      const result = settle(mdl).then(mdl => {
        if (normalMdl) mdl['findWord'] = word => mdl.obj['findWord'](word);
        return mdl;
      });
      const cache = await caches.open(cacheName);
      const req = (await cache.keys(storepath, { ignoreSearch: true }))[0];
      let res: Response;
      if (needsModelFetch(req?.url, id)) {

        // Caching already handled explicitly
        res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw 'Unable to fetch model, status: ' + res.status;
        res = await maybeDecompressModel(res);
        await cache.put(storepath + '?' + id, res.clone());
      }
      else res = (await cache.match(req))!;
      const tar = await res.arrayBuffer();
      const tarStart = _malloc(tar.byteLength);
      HEAPU8.set(new Uint8Array(tar), tarStart);
      mdl.obj = new (embind()['CommonModel'])(objs.indexOf(mdl), normalMdl, tarStart, tar.byteLength);
      return result;
    }
  }

  class Recognizer extends EventTarget implements VosklettoRecognizer {
    declare obj: RawRecognizer;
    declare acceptWaveform: VosklettoRecognizer['acceptWaveform'];
    declare setWords: VosklettoRecognizer['setWords'];
    declare setPartialWords: VosklettoRecognizer['setPartialWords'];
    declare setNLSML: VosklettoRecognizer['setNLSML'];
    declare setMaxAlternatives: VosklettoRecognizer['setMaxAlternatives'];
    declare setGrm: VosklettoRecognizer['setGrm'];
    declare setSpkModel: VosklettoRecognizer['setSpkModel'];
    declare setEndpointerMode: VosklettoRecognizer['setEndpointerMode'];
    declare setEndpointerDelays: VosklettoRecognizer['setEndpointerDelays'];
    declare reset: VosklettoRecognizer['reset'];
    constructor() {
      super();
      objs.push(this);

      // Consumer-facing methods are assigned with quoted names so the Closure
      // Compiler preserves them. As plain (unquoted) class methods they have no
      // internal caller and get renamed/dead-code-eliminated, which strips
      // acceptWaveform/set*/reset from the built wrapper.
      this['acceptWaveform'] = audioData => {
        let outcome: Outcome;
        const start = _malloc(audioData.length * 4);
        HEAPF32.set(audioData, start / 4);
        try {
          outcome = { ok: true, json: this.obj['acceptWaveform'](start, audioData.length) };
        }
        catch (error) {
          outcome = { ok: false, error };
        }
        finally {
          _free(start);
        }
        return handleOutcome(this, outcome);
      };
      this['setWords'] = words => this.obj['setWords'](words);
      this['setPartialWords'] = partialWords => this.obj['setPartialWords'](partialWords);
      this['setNLSML'] = nlsml => this.obj['setNLSML'](nlsml);
      this['setMaxAlternatives'] = alts => this.obj['setMaxAlternatives'](alts);
      this['setGrm'] = grm => this.obj['setGrm'](grm);
      this['setSpkModel'] = spkModel => this.obj['setSpkModel']((spkModel as unknown as CommonModel).obj);
      this['setEndpointerMode'] = mode => this.obj['setEndpointerMode'](mode);
      this['setEndpointerDelays'] = (tStartMax, tEnd, tMax) =>
        this.obj['setEndpointerDelays'](tStartMax, tEnd, tMax);
      this['reset'] = () => this.obj['reset']();
    }
    delete() {
      this.obj.delete();
    }
    static async mk(model: RawModel, sampleRate: number, mode: number, grammar?: string | null, spkModel?: RawModel | null): Promise<Recognizer> {
      const rec = new Recognizer();
      const result = settle(rec);
      const EmbindRecognizer = embind()['Recognizer'];
      switch (mode) {
        case 1:
          rec.obj = new EmbindRecognizer(objs.length - 1, sampleRate, model);
          break;
        case 2:
          rec.obj = new EmbindRecognizer(objs.length - 1, sampleRate, model, spkModel!);
          break;
        default:
          rec.obj = new EmbindRecognizer(objs.length - 1, sampleRate, model, grammar!, 0);
      }
      return result;
    }
  }

  const api: Omit<VosklettoModule, 'setLogLevel' | 'EpMode'> = {
    'getModelCache': () => _cache,

    'cleanUp': async () => {
      for (const obj of objs) await (obj as CommonModel | Recognizer).delete();
      URL.revokeObjectURL(processorURL);
    },

    'createTransferer': (ctx, bufSize) => createTransferer(ctx, processorURL, bufSize),

    'createModel': (url, storepath, id) =>
      CommonModel.mk(url, storepath, id, true) as Promise<unknown> as Promise<Model>,

    'createSpkModel': (url, storepath, id) =>
      CommonModel.mk(url, storepath, id, false) as Promise<unknown> as Promise<SpkModel>,

    'createRecognizer': (model, sampleRate) =>
      Recognizer.mk((model as unknown as CommonModel).obj, sampleRate, 1),

    'createRecognizerWithGrm': (model, sampleRate, grammar) =>
      Recognizer.mk((model as unknown as CommonModel).obj, sampleRate, 3, grammar, null),

    'createRecognizerWithSpkModel': (model, sampleRate, spkModel) =>
      Recognizer.mk((model as unknown as CommonModel).obj, sampleRate, 2, null, (spkModel as unknown as CommonModel).obj)
  };
  Module = api;
}
