/**
 * Main-thread half of the FlexDrawer HTTP bridge.
 *
 * Exposes `OpenSeadragon.FlexDrawer.installHttpBridge(worker, adapter)`.
 *
 * Call once per worker, immediately after Worker construction and BEFORE any
 * application-level postMessage that the worker might respond to. The returned
 * handle exposes `{ dispose() }`; call it when the worker is being terminated
 * so any in-flight requests are aborted and the listener is removed.
 *
 * The installer:
 *   - listens for `http:request` / `http:cancel` messages from the worker
 *     (via `addEventListener` so it never collides with the tile source's
 *     primary `onmessage` handler);
 *   - delegates each `http:request` to `adapter.fetch(url, init)` with a fresh
 *     `AbortController` so worker-side cancellations propagate downstream;
 *   - replies with `{ type: 'http:response', id, status, ok, headers, body }`
 *     transferring the response `ArrayBuffer` zero-copy;
 *   - on rejection replies with `{ type: 'http:error', id, message, name }`
 *     preserving the original error name (so `AbortError` round-trips);
 *   - immediately posts `{ type: 'http:bridge-on' }` so the worker shim flips
 *     into bridged mode before the tile source posts its `config` message.
 */
(function ($) {
    function installHttpBridge(worker, adapter) {
        if (!worker || !adapter || typeof adapter.fetch !== 'function') {
            throw new TypeError('installHttpBridge: requires a Worker and an HttpAdapter');
        }

        const inflight = new Map(); // id -> AbortController
        let disposed = false;

        const onMessage = (event) => {
            const msg = event && event.data;
            if (!msg || typeof msg.type !== 'string' || msg.type.indexOf('http:') !== 0) {
                return;
            }

            if (msg.type === 'http:request') {
                handleRequest(msg);
            } else if (msg.type === 'http:cancel') {
                const ac = inflight.get(msg.id);
                if (ac) {
                    inflight.delete(msg.id);
                    try {
                        ac.abort();
                    } catch (_) {
                        // ignore
                    }
                }
            }
        };

        worker.addEventListener('message', onMessage);

        // Flip the worker into bridged mode as the first thing on the wire.
        try {
            worker.postMessage({ type: 'http:bridge-on' });
        } catch (err) {
            worker.removeEventListener('message', onMessage);
            throw err;
        }

        async function handleRequest(msg) {
            if (disposed) {
                return;
            }

            const id = msg.id;
            const ac = new AbortController();
            inflight.set(id, ac);

            const init = Object.assign({}, msg.init || {}, { signal: ac.signal });

            try {
                const resp = await adapter.fetch(msg.url, init);
                const body = await resp.arrayBuffer();
                const headers = flattenHeaders(resp.headers);

                if (disposed) {
                    return;
                }

                try {
                    worker.postMessage(
                        {
                            type: 'http:response',
                            id: id,
                            status: resp.status,
                            ok: resp.ok,
                            headers: headers,
                            body: body
                        },
                        body ? [body] : []
                    );
                } catch (err) {
                    // postMessage failure (worker terminated, transfer error, …) — report locally.
                    if (typeof console !== 'undefined' && console.warn) {
                        console.warn('flex-renderer http bridge: postMessage failed', err);
                    }
                }
            } catch (err) {
                if (disposed) {
                    return;
                }
                const name = (err && err.name) || 'Error';
                const message = (err && err.message) || String(err);
                try {
                    worker.postMessage({ type: 'http:error', id: id, name: name, message: message });
                } catch (_) { /* ignore */ }
            } finally {
                inflight.delete(id);
            }
        }

        function dispose() {
            if (disposed) {
                return;
            }
            disposed = true;
            try {
                worker.removeEventListener('message', onMessage);
            } catch (_) {
                // ignore
            }
            for (const ac of inflight.values()) {
                try {
                    ac.abort();
                } catch (_) {
                    // ignore
                }
            }
            inflight.clear();
        }

        return { dispose: dispose };
    }

    function flattenHeaders(headers) {
        const out = {};
        if (!headers) {
            return out;
        }
        if (typeof headers.forEach === 'function') {
            headers.forEach((value, key) => {
                out[String(key).toLowerCase()] = String(value);
            });
            return out;
        }
        if (typeof headers === 'object') {
            for (const key of Object.keys(headers)) {
                out[key.toLowerCase()] = String(headers[key]);
            }
        }
        return out;
    }

    if ($ && $.FlexDrawer) {
        $.FlexDrawer.installHttpBridge = installHttpBridge;
    }
})(typeof OpenSeadragon !== 'undefined' ? OpenSeadragon : null);
