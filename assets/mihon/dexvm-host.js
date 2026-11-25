// dexvm-host.js — zero-dependency WASI (preview1) + `host` import shim for
// dist/dexvm_bridge.wasm. Works in a Web Worker (no SharedArrayBuffer, no
// Atomics) and in Node 18+.
//
//   import { createDexvm } from './dexvm-host.js';
//   const vm = await createDexvm({
//     wasmBytes,                       // ArrayBuffer | Uint8Array | WebAssembly.Module
//     http: (req) => respJsonString,   // SYNC: {url,method,headers,bodyBase64?}
//                                      //   -> {status,headers,bodyBase64,finalUrl} | {error}
//     log: (level, msg) => {},         // optional
//     evalJs: (src) => jsonString,     // optional, for app.cash.quickjs
//     sleep: (ms) => {},               // optional SYNC sleep (replaces busy-wait in poll_oneoff)
//   });
//   const value = vm.call('open', { apkBase64 });   // throws DexvmError on ok:false

const ERRNO = {
  SUCCESS: 0,
  BADF: 8,
  INVAL: 28,
  IO: 29,
  NOSYS: 52,
  NOTSUP: 58,
};

const POLL_CAP_MS = 2000;
const SLEEP_CAP_MS = 60_000;

export class DexvmError extends Error {
  constructor(err) {
    super(err && err.message ? err.message : String(err));
    this.name = 'DexvmError';
    this.kind = (err && err.kind) || 'internal';
    this.javaStack = err && err.javaStack;
    this.raw = err;
  }
}

function encoder() {
  return new TextEncoder();
}
let _decoder = null;
function decoder() {
  if (!_decoder) _decoder = new TextDecoder('utf-8');
  return _decoder;
}

export async function createDexvm({ wasmBytes, http, log, evalJs, sleep } = {}) {
  if (!wasmBytes) throw new Error('createDexvm: wasmBytes is required');
  let instance = null;
  let cryptoObj = globalThis.crypto;
  if (!cryptoObj) {
    try {
      cryptoObj = (await import('node:crypto')).webcrypto;
    } catch {
      cryptoObj = null;
    }
  }
  const warn = (msg) => {
    if (typeof log === 'function') log(3, msg);
    else if (typeof console !== 'undefined') console.warn('[dexvm] ' + msg);
  };
  const mem = () => new Uint8Array(instance.exports.memory.buffer);
  const dv = () => new DataView(instance.exports.memory.buffer);

  function readStr(ptr, len) {
    if (!ptr || !len) return '';
    return decoder().decode(mem().subarray(ptr, ptr + len));
  }

  // The host writes its reply into wasm memory: allocate through the module's
  // own `alloc` export, copy the bytes in, hand back (ptr<<32)|len.
  function writeToWasm(str) {
    const bytes = encoder().encode(str);
    if (bytes.length === 0) return 0n;
    const ptr = instance.exports.alloc(bytes.length);
    if (!ptr) return 0n;
    mem().set(bytes, ptr); // re-reads the (possibly grown) buffer each time
    return (BigInt(ptr) << 32n) | BigInt(bytes.length);
  }

  function errno(code) {
    return code;
  }

  let clockFloorNs = 0n;
  function currentClockNs() {
    const wall = BigInt(Date.now()) * 1000000n;
    if (wall > clockFloorNs) clockFloorNs = wall;
    return clockFloorNs;
  }

  const wasi = {
    clock_time_get(_id, _precision, out) {
      // Date.now() has ms resolution; monotonic floor keeps clock_time_get
      // consistent with poll_oneoff wakeups.
      dv().setBigUint64(out, currentClockNs(), true);
      return 0;
    },
    random_get(ptr, len) {
      const buf = mem().subarray(ptr, ptr + len);
      if (cryptoObj && cryptoObj.getRandomValues) {
        for (let off = 0; off < buf.length; off += 65536) {
          cryptoObj.getRandomValues(buf.subarray(off, Math.min(off + 65536, buf.length)));
        }
      } else {
        warn('crypto.getRandomValues unavailable, falling back to Math.random');
        for (let i = 0; i < buf.length; i++) buf[i] = (Math.random() * 256) | 0;
      }
      return 0;
    },
    fd_write(fd, iovs, iovsLen, nwritten) {
      const view = dv();
      let total = 0;
      let text = '';
      for (let i = 0; i < iovsLen; i++) {
        const base = iovs + i * 8;
        const ptr = view.getUint32(base, true);
        const len = view.getUint32(base + 4, true);
        text += readStr(ptr, len);
        total += len;
      }
      if (fd === 1) console.log(text.replace(/\n$/, ''));
      else if (fd === 2) console.error(text.replace(/\n$/, ''));
      else return ERRNO.BADF;
      view.setUint32(nwritten, total, true);
      return 0;
    },
    environ_sizes_get(countPtr, sizePtr) {
      dv().setUint32(countPtr, 0, true);
      dv().setUint32(sizePtr, 0, true);
      return 0;
    },
    environ_get() {
      return 0;
    },
    args_sizes_get(countPtr, sizePtr) {
      dv().setUint32(countPtr, 0, true);
      dv().setUint32(sizePtr, 0, true);
      return 0;
    },
    args_get() {
      return 0;
    },
    proc_exit(code) {
      throw new Error('dexvm: wasm called proc_exit(' + code + ')');
    },
    sched_yield() {
      return 0;
    },
    // Clock subscriptions only. When `sleep` is provided, blocks via host
    // `sleep(ms)` (capped at SLEEP_CAP_MS); otherwise falls back to busy-wait
    // capped at POLL_CAP_MS (for workers without SharedArrayBuffer).
    poll_oneoff(inPtr, outPtr, nsubs, neventsPtr) {
      const view = dv();
      const nowNs = currentClockNs();
      const immediate = [];
      const clocks = [];
      for (let i = 0; i < nsubs; i++) {
        const sub = inPtr + i * 48;
        const userdata = view.getBigUint64(sub, true);
        const type = view.getUint8(sub + 8);
        if (type === 0) {
          const clockId = view.getUint32(sub + 16, true);
          const timeout = view.getBigUint64(sub + 24, true); // ns
          const flags = view.getUint16(sub + 40, true);
          // subscriptions with id 0 (realtime) or 1 (monotonic) both use currentClockNs
          if (clockId > 1) {
            immediate.push({ userdata, error: ERRNO.INVAL, type: 2 });
            continue;
          }
          const targetNs = flags & 1 ? timeout : nowNs + timeout;
          clocks.push({ userdata, targetNs });
        } else {
          immediate.push({ userdata, error: ERRNO.NOSYS, type });
        }
      }

      const ready = [...immediate];
      if (clocks.length > 0) {
        let earliestTargetNs = clocks[0].targetNs;
        for (let i = 1; i < clocks.length; i++) {
          if (clocks[i].targetNs < earliestTargetNs) earliestTargetNs = clocks[i].targetNs;
        }
        if (ready.length > 0) {
          // Non-clock error events are ready immediately; also report any
          // already-expired clock subscriptions without blocking.
          for (const c of clocks) {
            if (c.targetNs <= nowNs) ready.push({ userdata: c.userdata, error: 0, type: 0 });
          }
        } else {
          let waitNs = earliestTargetNs > nowNs ? earliestTargetNs - nowNs : 0n;
          let effectiveTargetNs = earliestTargetNs;
          const hasSleep = typeof sleep === 'function';
          if (waitNs > 0n) {
            const capMs = hasSleep ? SLEEP_CAP_MS : POLL_CAP_MS;
            const capNs = BigInt(capMs) * 1000000n;
            if (waitNs > capNs) {
              warn('poll_oneoff clock wait truncated to ' + capMs + 'ms (was ' +
                Number(waitNs / 1000000n) + 'ms)');
              waitNs = capNs;
              effectiveTargetNs = nowNs + capNs;
            }
            if (hasSleep) {
              sleep(Math.ceil(Number(waitNs) / 1e6));
              if (effectiveTargetNs > clockFloorNs) clockFloorNs = effectiveTargetNs;
            } else {
              // busy wait; Date.now() may not advance fast enough on some hosts,
              // so also bound the loop by iterations.
              const targetMs = Number(effectiveTargetNs / 1000000n);
              let guard = 0;
              while (Date.now() < targetMs && guard++ < 4_000_000) {}
              if (Date.now() >= targetMs && effectiveTargetNs > clockFloorNs) {
                clockFloorNs = effectiveTargetNs;
              }
            }
          }
          const afterNs = currentClockNs();
          for (const c of clocks) {
            if (c.targetNs <= afterNs) ready.push({ userdata: c.userdata, error: 0, type: 0 });
          }
          // When truncated (effectiveTargetNs < earliestTargetNs), report the
          // earliest clock subscription(s) so poll_oneoff returns nevents >= 1.
          if (ready.length === 0) {
            for (const c of clocks) {
              if (c.targetNs === earliestTargetNs) {
                ready.push({ userdata: c.userdata, error: 0, type: 0 });
              }
            }
          }
        }
      }

      const outView = dv();
      for (let i = 0; i < ready.length; i++) {
        const ev = outPtr + i * 32;
        outView.setBigUint64(ev, ready[i].userdata, true);
        outView.setUint16(ev + 8, ready[i].error, true);
        outView.setUint8(ev + 10, ready[i].type);
      }
      outView.setUint32(neventsPtr, ready.length, true);
      return 0;
    },
    fd_close: () => errno(ERRNO.BADF),
    fd_read: () => errno(ERRNO.BADF),
    fd_seek: () => errno(ERRNO.BADF),
    fd_sync: () => errno(ERRNO.BADF),
    fd_fdstat_get: () => errno(ERRNO.BADF),
    fd_filestat_get: () => errno(ERRNO.BADF),
    fd_prestat_get: () => errno(ERRNO.BADF),
    fd_prestat_dir_name: () => errno(ERRNO.BADF),
    fd_readdir: () => errno(ERRNO.BADF),
    path_open: () => errno(ERRNO.NOSYS),
    path_create_directory: () => errno(ERRNO.NOSYS),
    path_filestat_get: () => errno(ERRNO.NOSYS),
    path_readlink: () => errno(ERRNO.NOSYS),
    path_remove_directory: () => errno(ERRNO.NOSYS),
    path_rename: () => errno(ERRNO.NOSYS),
    path_unlink_file: () => errno(ERRNO.NOSYS),
  };

  const imports = {
    host: {
      http(reqPtr, reqLen) {
        let reply;
        try {
          const reqJson = readStr(reqPtr, reqLen);
          reply = http ? http(reqJson) : JSON.stringify({ error: 'no http handler' });
        } catch (e) {
          reply = JSON.stringify({ error: 'host http threw: ' + (e && e.message ? e.message : e) });
        }
        return writeToWasm(String(reply));
      },
      log(level, ptr, len) {
        const msg = readStr(ptr, len);
        if (typeof log === 'function') log(level, msg);
        else if (level >= 4) console.error('[dexvm] ' + msg);
        else if (level === 3) console.warn('[dexvm] ' + msg);
      },
      eval_js(ptr, len) {
        let reply;
        try {
          const src = readStr(ptr, len);
          if (typeof evalJs !== 'function') {
            reply = JSON.stringify({ ok: false, error: 'evalJs not provided by loader' });
          } else {
            const out = evalJs(src); // must return a JSON string
            reply = typeof out === 'string' ? out : JSON.stringify({ ok: true, value: out });
          }
        } catch (e) {
          reply = JSON.stringify({ ok: false, error: String((e && e.message) || e) });
        }
        return writeToWasm(String(reply));
      },
    },
    wasi_snapshot_preview1: wasi,
  };

  // Accept ArrayBuffer / TypedArray / Module
  let moduleOrBytes = wasmBytes;
  if (wasmBytes instanceof Uint8Array || wasmBytes instanceof ArrayBuffer) {
    moduleOrBytes = wasmBytes;
  }
  const result = await WebAssembly.instantiate(moduleOrBytes, imports);
  instance = result.instance || result;

  let trapped = false;
  function call(op, args = {}) {
    if (trapped) throw new DexvmError({ kind: 'trap', message: 'instance already trapped' });
    const payload = JSON.stringify({ op, ...args });
    const bytes = encoder().encode(payload);
    const ptr = instance.exports.alloc(bytes.length);
    if (!ptr && bytes.length) throw new Error('dexvm: alloc failed');
    mem().set(bytes, ptr);
    let packed;
    try {
      packed = instance.exports.call(ptr, bytes.length);
    } catch (e) {
      // wasm32-wasip1 has no unwinding: a Rust panic aborts the instance.
      // Surface it as a regular error instead of letting it escape silently.
      trapped = true;
      throw new DexvmError({
        kind: 'trap',
        message: 'wasm trapped (' + (e && e.message ? e.message : e) + '); the instance is unusable',
      });
    }
    instance.exports.dealloc(ptr, bytes.length);
    const outPtr = Number(packed >> 32n);
    const outLen = Number(packed & 0xffffffffn);
    let text = '';
    if (outPtr && outLen) {
      text = decoder().decode(mem().subarray(outPtr, outPtr + outLen));
      instance.exports.dealloc(outPtr, outLen);
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new DexvmError({ kind: 'protocol', message: 'bad reply from wasm: ' + text.slice(0, 200) });
    }
    if (!parsed.ok) throw new DexvmError(parsed.error);
    return parsed.value;
  }

  return { call, instance, exports: instance.exports, get trapped() { return trapped; } };
}

export default createDexvm;
