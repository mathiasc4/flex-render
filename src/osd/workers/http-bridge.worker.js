/**
 * Worker-side half of the FlexDrawer HTTP bridge.
 *
 * This shim is concatenated into every FlexDrawer worker blob. It exposes
 * `self.requestFetch(url, init)` for the worker's network call sites to use in
 * place of `fetch(...)` when the main thread has wired an HttpAdapter via
 * installHttpBridge() (see http-bridge.main.js).
 *
 * Routing is gated by `self.__hasHttpBridge`: it starts false and flips to true
 * only after the main side posts `{ type: 'http:bridge-on' }`. When the flag is
 * false, call sites must fall back to native fetch — so worker code stays
 * usable standalone (no adapter wired) without any behavioral change.
 *
 * Protocol (worker ↔ main):
 *   worker → main: { type: 'http:request', id, url, init }
 *   main → worker: { type: 'http:response', id, status, ok, headers, body }
 *                 ({ body } is a transferable ArrayBuffer; zero-copy)
 *   main → worker: { type: 'http:error', id, message, name }
 *   worker → main: { type: 'http:cancel', id }
 *
 * Response objects returned from `requestFetch` expose status / ok / headers
 * plus async arrayBuffer() / json() / text() — the same surface the existing
 * worker call sites already use on real `Response` instances.
 */
(function attachHttpBridge(scope) {
    if (scope.requestFetch) {
        // already attached — ignore double inclusion
        return;
    }

    scope.__hasHttpBridge = false;

    var nextId = 1;
    var pending = new Map(); // id -> { resolve, reject, signal, abortListener }

    scope.addEventListener('message', function (event) {
        var msg = event.data;
        if (!msg || typeof msg.type !== 'string' || msg.type.indexOf('http:') !== 0) {
            return;
        }

        if (msg.type === 'http:bridge-on') {
            scope.__hasHttpBridge = true;
            return;
        }

        if (msg.type === 'http:bridge-off') {
            scope.__hasHttpBridge = false;
            return;
        }

        var waiter = pending.get(msg.id);
        if (!waiter) {
            return;
        }

        pending.delete(msg.id);
        detachAbortListener(waiter);

        if (msg.type === 'http:response') {
            waiter.resolve(makeResponseShim(msg));
        } else if (msg.type === 'http:error') {
            var err = new Error(msg.message || 'flex-renderer http bridge: request failed');
            if (msg.name) {
                err.name = msg.name;
            }
            waiter.reject(err);
        }
    });

    scope.requestFetch = function requestFetch(url, init) {
        var id = nextId++;
        var safeInit;
        try {
            safeInit = serializeInit(init);
        } catch (err) {
            return Promise.reject(err);
        }

        var signal = init && init.signal;
        if (signal && signal.aborted) {
            return Promise.reject(makeAbortError(signal.reason));
        }

        return new Promise(function (resolve, reject) {
            var waiter = {
                resolve: resolve,
                reject: reject,
                signal: signal || null,
                abortListener: null
            };
            pending.set(id, waiter);

            try {
                scope.postMessage({
                    type: 'http:request',
                    id: id,
                    url: url,
                    init: safeInit
                });
            } catch (err) {
                pending.delete(id);
                reject(err);
                return;
            }

            if (signal) {
                waiter.abortListener = function () {
                    if (!pending.has(id)) {
                        return;
                    }
                    pending.delete(id);
                    try {
                        scope.postMessage({ type: 'http:cancel', id: id });
                    } catch (_) { /* ignore */ }
                    reject(makeAbortError(signal.reason));
                };
                signal.addEventListener('abort', waiter.abortListener, { once: true });
            }
        });
    };

    function detachAbortListener(waiter) {
        if (waiter.signal && waiter.abortListener) {
            try {
                waiter.signal.removeEventListener('abort', waiter.abortListener);
            } catch (_) { /* ignore */ }
            waiter.abortListener = null;
        }
    }

    function makeResponseShim(message) {
        var status = message.status;
        var ok = message.ok;
        var headers = message.headers || {};
        var body = message.body;

        return {
            status: status,
            ok: ok,
            headers: headers,
            arrayBuffer: function () { return Promise.resolve(body); },
            json: function () {
                try {
                    return Promise.resolve(JSON.parse(decodeBody(body)));
                } catch (err) {
                    return Promise.reject(err);
                }
            },
            text: function () {
                return Promise.resolve(decodeBody(body));
            }
        };
    }

    function decodeBody(body) {
        if (!body) {
            return '';
        }
        // body is always an ArrayBuffer when present
        return new TextDecoder('utf-8').decode(new Uint8Array(body));
    }

    function makeAbortError(reason) {
        var message = typeof reason === 'string' ? reason : (reason && reason.message) || 'aborted';
        // DOMException is available in workers in all targeted runtimes
        try {
            return new DOMException(message, 'AbortError');
        } catch (_) {
            var err = new Error(message);
            err.name = 'AbortError';
            return err;
        }
    }

    function serializeInit(init) {
        var out = {};
        if (!init || typeof init !== 'object') {
            return out;
        }

        if (init.method) {
            out.method = String(init.method);
        }

        if (init.headers) {
            out.headers = flattenHeaders(init.headers);
        }

        if (init.body !== undefined && init.body !== null) {
            var body = init.body;
            if (typeof body === 'string' || body instanceof ArrayBuffer) {
                out.body = body;
            } else if (ArrayBuffer.isView && ArrayBuffer.isView(body)) {
                out.body = body;
            } else {
                throw new TypeError('flex-renderer http bridge: unsupported request body type');
            }
        }

        if (init.credentials) {
            out.credentials = init.credentials;
        }
        if (init.cache) {
            out.cache = init.cache;
        }

        return out;
    }

    function flattenHeaders(headers) {
        var out = {};
        if (!headers) {
            return out;
        }
        if (typeof headers.forEach === 'function' && !Array.isArray(headers)) {
            // Headers instance or Map-like
            headers.forEach(function (value, key) {
                out[String(key).toLowerCase()] = String(value);
            });
            return out;
        }
        if (Array.isArray(headers)) {
            for (var i = 0; i < headers.length; i++) {
                var entry = headers[i];
                if (Array.isArray(entry) && entry.length >= 2) {
                    out[String(entry[0]).toLowerCase()] = String(entry[1]);
                }
            }
            return out;
        }
        if (typeof headers === 'object') {
            for (var key in headers) {
                if (Object.prototype.hasOwnProperty.call(headers, key)) {
                    out[key.toLowerCase()] = String(headers[key]);
                }
            }
        }
        return out;
    }
})(self);
