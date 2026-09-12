import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('Modules/TranslationSub/translationsub-realtime.js', 'utf8');

const storage = new Map();
const storageListeners = [];
const accountListeners = new Map();
const documentListeners = new Map();
const windowListeners = new Map();
const sockets = [];
let readyCallback = null;
let refreshCount = 0;
let profileId = '0';
const uid = 'client@translationsub.test';

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    sockets.push(this);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  emit(data) {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    this.onmessage?.({ data: payload });
  }

  send(payload) {
    assert.equal(this.readyState, FakeWebSocket.OPEN, 'send on non-open websocket');
    this.sent.push(payload);
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
}

const document = {
  hidden: false,
  addEventListener(name, callback) {
    documentListeners.set(name, callback);
  }
};

const Lampa = {
  Storage: {
    get(name, fallback) {
      return storage.has(name) ? storage.get(name) : fallback;
    },
    set(name, value) {
      storage.set(name, value);
    },
    listener: {
      follow(name, callback) {
        if (name === 'change') storageListeners.push(callback);
      }
    }
  },
  Utils: {
    uid() {
      return '0123456789abcdef0123456789abcdef';
    }
  },
  Account: {
    listener: {
      follow(name, callback) {
        accountListeners.set(name, callback);
      }
    }
  }
};

const context = {
  console,
  JSON,
  Math,
  Date,
  String,
  encodeURIComponent,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  document,
  localStorage: {
    getItem(name) {
      return storage.has(name) ? String(storage.get(name)) : null;
    },
    setItem(name, value) {
      storage.set(name, String(value));
    }
  },
  WebSocket: FakeWebSocket,
  Lampa,
  TranslationSubApi: {
    host: () => 'http://lampac.test:9118',
    uid: () => uid,
    profileId: () => profileId
  },
  TranslationSubBadgeState: {
    refresh() {
      refreshCount += 1;
    }
  },
  TranslationSubRuntime: {
    onReady(callback) {
      readyCallback = callback;
    }
  },
  addEventListener(name, callback) {
    windowListeners.set(name, callback);
  }
};
context.window = context;

vm.runInNewContext(source, context, {
  filename: 'Modules/TranslationSub/translationsub-realtime.js'
});

assert.equal(typeof readyCallback, 'function', 'realtime module must register onReady callback');
readyCallback();
assert.equal(sockets.length, 1, 'start must create one websocket');

const first = sockets[0];
assert.match(first.url, /^ws:\/\/lampac\.test:9118\/nws\?id=/, first.url);
assert.match(first.url, /&ver=1$/, first.url);
const firstConnectionId = new URL(first.url).searchParams.get('id');
assert.equal(firstConnectionId, '0123456789abcdef0123456789abcdef');

first.open();
assert.equal(first.sent.length, 0, 'registration waits for server Connected message');
first.emit({ method: 'Connected', args: [] });
assert.equal(first.sent.length, 1, 'Connected must register realtime client');
assert.deepEqual(JSON.parse(first.sent[0]), {
  method: 'TranslationSubRegister',
  args: [uid, '0']
});
await delay(80);
assert.equal(refreshCount, 1, 'Connected must schedule initial snapshot refresh');

// Realtime payload details are deliberately not interpreted by the thin client.
// Multiple invalidations in one burst must collapse into one snapshot refresh.
first.emit({ method: 'TranslationSubChanged', args: [11, 'subscription'] });
first.emit({ method: 'TranslationSubChanged', args: [12, 'timecode'] });
first.emit({ method: 'TranslationSubChanged', args: [] });
await delay(80);
assert.equal(refreshCount, 2, 'burst of TranslationSubChanged must debounce to one refresh');

first.emit({ method: 'UnknownMethod', args: [13] });
first.emit('pong');
await delay(80);
assert.equal(refreshCount, 2, 'unknown messages and pong must not refresh snapshot');

profileId = '7';
for (const callback of storageListeners)
  callback({ name: 'lampac_profile_id' });
assert.equal(first.sent.length, 2, 'profile switch must re-register existing websocket');
assert.deepEqual(JSON.parse(first.sent[1]), {
  method: 'TranslationSubRegister',
  args: [uid, '7']
});
await delay(80);
assert.equal(refreshCount, 3, 'profile switch must refresh the new profile snapshot');

// Account profile events must be idempotent while the registered profile is unchanged.
accountListeners.get('profile_select')?.();
accountListeners.get('profile_check')?.();
await delay(80);
assert.equal(first.sent.length, 2, 'same-profile events must not duplicate registration');
assert.equal(refreshCount, 3, 'same-profile events must not trigger redundant refresh');

// Hidden applications disconnect. Becoming visible reconnects using the persistent
// connection id and re-registers the current profile after Connected.
document.hidden = true;
documentListeners.get('visibilitychange')?.();
assert.equal(first.readyState, FakeWebSocket.CLOSED, 'hidden document must close websocket');

document.hidden = false;
documentListeners.get('visibilitychange')?.();
assert.equal(sockets.length, 2, 'visible document must reconnect');
const second = sockets[1];
const secondConnectionId = new URL(second.url).searchParams.get('id');
assert.equal(secondConnectionId, firstConnectionId, 'reconnect must reuse persistent NWS id');
second.open();
second.emit({ method: 'Connected', args: [] });
assert.deepEqual(JSON.parse(second.sent[0]), {
  method: 'TranslationSubRegister',
  args: [uid, '7']
});
await delay(80);
assert.equal(refreshCount, 4, 'reconnect must refresh canonical snapshot once');

second.emit({ method: 'TranslationSubChanged', args: [999999, 'future-reason'] });
await delay(80);
assert.equal(refreshCount, 5, 'future revision/reason values must remain wire-compatible');

second.close();
console.log('TranslationSub realtime thin-client regression passed.');
