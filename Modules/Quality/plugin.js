(function (root) {
    'use strict';

    var rank = {CAM: 1, TS: 2, TC: 3, SD: 4, HD: 5, FHD: 6, '4K': 7};

    function qualityOf(release) {
        if (!release) return '';
        var info = release.Info || release.info || {};
        var title = String(release.Title || release.title || '');
        var source = String(info.videotype || release.videotype || '');
        var video = (source + ' ' + title)
            .replace(/\[[^\]]*(?:звук\s+с\s+ts|audio\s+from\s+ts|sound\s+from\s+ts)[^\]]*\]/gi, ' ')
            .replace(/звук\s+с\s+ts|audio\s+from\s+ts|sound\s+from\s+ts/gi, ' ');
        var resolution = Number(info.quality || release.quality || 0);
        if (/camrip|hdcam|hd-cam|камрип|(?:^|[^a-z])cam(?:$|[^a-z])/i.test(video)) return 'CAM';
        if (/telesync|tele[\s-]*sync|tsrip|(?:^|[^\w])hdts(?:$|[^\w])|(?:^|[^\w])ts(?:$|[^\w])/i.test(video)) return 'TS';
        if (/telecine|tele[\s-]*cine|(?:^|[^\w])tc(?:$|[^\w])/i.test(video)) return 'TC';
        if (!resolution) {
            if (/2160p|\b4k\b|4к|\buhd\b/i.test(video)) resolution = 2160;
            else if (/1080p|\b1080\b/i.test(video)) resolution = 1080;
            else if (/720p|\b720\b/i.test(video)) resolution = 720;
            else if (/480p|\b480\b|web-dlrip|\bbdrip\b|\bhdrip\b/i.test(video)) resolution = 480;
        }
        return resolution >= 2160 ? '4K' : resolution >= 1080 ? 'FHD'
            : resolution >= 720 ? 'HD' : resolution > 0 ? 'SD' : '';
    }

    function normalizedTitle(text) {
        return String(text || '').toLowerCase().replace(/ё/g, 'е')
            .replace(/[^a-zа-я0-9]+/gi, ' ').trim();
    }

    function matchesTitle(release, item) {
        var info = release.Info || release.info || {};
        var candidates = [normalizedTitle(item.title), normalizedTitle(item.original)].filter(Boolean);
        var names = [info.name, info.originalname].map(normalizedTitle).filter(Boolean);
        if (names.some(function (name) { return candidates.indexOf(name) >= 0; })) return true;
        var title = ' ' + normalizedTitle(release.Title || release.title) + ' ';
        return candidates.some(function (name) { return title.indexOf(' ' + name + ' ') >= 0; });
    }

    function bestOf(results, item) {
        if (!Array.isArray(results)) return null;
        var best = null, bestScore = -1;
        results.forEach(function (release) {
            if (!release) return;
            var title = String(release.Title || release.title || '');
            if (!title || /\b(?:trailer|teaser|sample)\b|трейлер|тизер/i.test(title)) return;
            if (!matchesTitle(release, item)) return;
            var info = release.Info || release.info || {};
            var types = info.types || release.types;
            if (Array.isArray(types) && types.length && !types.some(function (type) {
                return item.type === 'tv' ? /^(serial|docuserial|tvshow|anime)$/.test(type)
                    : /^(movie|documovie)$/.test(type);
            })) return;
            var year = Number(info.relased || release.relased || 0);
            if (!year) {
                var found = title.match(/(?:^|\D)((?:19|20)\d\d)(?:\D|$)/);
                if (found) year = Number(found[1]);
            }
            if (year && item.year && Math.abs(year - item.year) > (item.type === 'tv' ? 5 : 1)) return;
            var label = qualityOf(release);
            if (!label) return;
            var score = rank[label] * 10000000
                + Math.min(9999, Math.max(0, Number(release.Seeders || release.sid || 0))) * 10
                + Math.min(9, Math.max(0, Number(release.Peers || release.pir || 0)));
            if (score > bestScore) { bestScore = score; best = label; }
        });
        return best;
    }

    function normalize(data) {
        if (!data) return null;
        var type = data.media_type === 'tv' || data.type === 'tv' || data.original_name || data.first_air_date ? 'tv' : 'movie';
        var title = String(data.title || data.name || '').trim();
        var original = String(data.original_title || data.original_name || '').trim();
        var year = Number(data.year || String(data.release_date || data.first_air_date || '').slice(0, 4)) || 0;
        if (!title && !original) return null;
        return {
            id: String(data.id || ''), source: String(data.source || 'tmdb'),
            title: title || original, original: original, type: type,
            year: year, genres: Array.isArray(data.genres) ? data.genres : []
        };
    }

    function parserRequest(item) {
        return {
            search: item.title,
            movie: {
                title: item.title,
                original_title: item.original,
                original_name: item.type === 'tv' ? (item.original || item.title) : '',
                release_date: item.type === 'movie' && item.year ? item.year + '-01-01' : '',
                first_air_date: item.type === 'tv' && item.year ? item.year + '-01-01' : '',
                number_of_seasons: item.type === 'tv' ? 1 : 0,
                genres: item.genres
            },
            global: false
        };
    }

    // Export pure functions for Node regression checks without starting Lampa.
    if (typeof module === 'object' && module.exports) {
        module.exports = {qualityOf: qualityOf, bestOf: bestOf, normalize: normalize, parserRequest: parserRequest};
        return;
    }
    if (root.__qualityPluginLoaded) return;
    if (!root.Lampa || !root.Lampa.Parser || !root.Lampa.Storage || !root.Lampa.Listener) {
        // Visible from DevTools without exposing any JacRed credentials.
        root.__qualityPluginLoadError = 'Lampa API is not ready';
        return;
    }
    root.__qualityPluginLoaded = true;
    root.__qualityPluginLoadError = null;
    var L = root.Lampa;
    var cache = Object.create(null), pending = Object.create(null);
    var queue = [], backgroundQueue = [], sqlPending = [], sqlWrites = [];
    var active = 0, signature = '', generation = 0, sqlUnavailable = false;
    var sqlBatchTimer = null, sqlWriteTimer = null, persistTimer = null;
    var persisted = null, persistentSource = '', lastFull = null;
    var known = Object.create(null), observed = typeof WeakMap === 'function' ? new WeakMap() : null;
    var persistentKey = 'quality_module_cache_v2';
    var scriptSource = document.currentScript && document.currentScript.src || '';
    var sqlEndpoint = /\/quality\.js(?:\?.*)?$/i.test(scriptSource)
        ? scriptSource.replace(/\/quality\.js(?:\?.*)?$/i, '/quality/cache') : '';
    var sqlScope = '';
    var rankLabels = Object.keys(rank);
    var batchDelayMs = 150, maxSqlBatch = 30;
    var lastRefresh = Object.create(null);

    function setting(name, fallback) {
        var value;
        try { if (L.Storage.get) value = L.Storage.get(name, fallback); } catch (e) {}
        return value === undefined || value === null || value === '' ? fallback : value;
    }
    function numberSetting(name, fallback, min, max) {
        var value = Number(setting(name, fallback));
        return isFinite(value) && value >= min && value <= max ? value : fallback;
    }
    function backgroundEnabled() {
        return setting('quality_module_background', true) !== false
            && String(setting('quality_module_background', true)) !== 'false';
    }
    function badgeEnabled() {
        return setting('quality_module_enabled', true) !== false
            && String(setting('quality_module_enabled', true)) !== 'false';
    }
    function ttlDays(label, item) {
        var key = label === '4K'
            ? (item && item.year && item.year < new Date().getFullYear() - 2
                ? 'quality_module_days_4k_old' : 'quality_module_days_4k_new')
            : /^(CAM|TS|TC)$/.test(label || '') ? 'quality_module_days_low'
            : label ? 'quality_module_days_hd' : 'quality_module_days_empty';
        var defaults = {quality_module_days_low: 1, quality_module_days_hd: 5,
            quality_module_days_4k_new: 10, quality_module_days_4k_old: 30,
            quality_module_days_empty: 1};
        return numberSetting(key, defaults[key], 1, 60);
    }
    function sqlBatchSize() {
        return numberSetting('quality_module_batch_size', 30, 1, 30);
    }
    function hashId(value) {
        var a = 2166136261, b = 2246822507, text = String(value || '');
        for (var i = 0; i < text.length; i++) {
            a = Math.imul(a ^ text.charCodeAt(i), 16777619);
            b = Math.imul(b ^ text.charCodeAt(i), 3266489917);
        }
        return ('00000000' + (a >>> 0).toString(16)).slice(-8)
            + ('00000000' + (b >>> 0).toString(16)).slice(-8);
    }
    function initSqlScope() {
        if (!sqlEndpoint || !L.Storage.get || !L.Storage.set
            || typeof root.fetch !== 'function') return;
        try {
            sqlScope = L.Storage.get('quality_module_sql_scope_v1') || '';
            if (!/^[a-f0-9]{32}$/.test(sqlScope)) {
                if (!root.crypto || !root.crypto.getRandomValues) return;
                var bytes = new Uint8Array(16);
                root.crypto.getRandomValues(bytes);
                sqlScope = Array.prototype.map.call(bytes, function (byte) {
                    return ('0' + byte.toString(16)).slice(-2);
                }).join('');
                L.Storage.set('quality_module_sql_scope_v1', sqlScope, true);
            }
        } catch (e) { sqlScope = ''; }
    }
    initSqlScope();
    function configured() {
        var s = L.Storage;
        if (!badgeEnabled() || s.field('parser_torrent_type') !== 'jackett') return false;
        var mode = s.field('parser_use_link') || 'one';
        return mode === 'two' ? !!s.field('jackett_url_two')
            : mode === 'one' ? !!s.field('jackett_url')
            : !!(s.field('jackett_url') || s.field('jackett_url_two'));
    }
    function sourceSignature() {
        var s = L.Storage;
        // Hash in memory; no JacRed URL or key enters persistent storage or HTTP.
        return [s.field('jackett_url'), s.field('jackett_key'), s.field('jackett_url_two'),
            s.field('jackett_key_two'), s.field('parser_use_link'),
            s.field('jackett_interview')].join('|');
    }
    function keyOf(item) {
        return item.source + ':' + item.type + ':' + (item.id || item.title) + ':' + item.year;
    }
    function recordValid(record) {
        return !!record && typeof record === 'object' && Number(record.until) > Date.now()
            && (record.label === null || Object.prototype.hasOwnProperty.call(rank, record.label));
    }
    function recordDue(record, item) {
        if (!record) return false;
        var checked = Number(record.checkedAt) || (Number(record.until)
            - ttlDays(record.label, item) * 86400000);
        return Date.now() >= checked + ttlDays(record.label, item) * 86400000;
    }
    function makeRecord(label, item, serverRecord) {
        var checked = serverRecord && Number(serverRecord.checkedAt) || Date.now();
        var until = serverRecord && Number(serverRecord.until)
            || (checked + (ttlDays(label, item) + 2) * 86400000);
        return {label: label, checkedAt: checked, until: until};
    }
    function savePersistent() {
        if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
        if (!persisted || !L.Storage.set) return;
        var now = Date.now();
        Object.keys(persisted.entries).forEach(function (key) {
            if (persisted.entries[key].until <= now) {
                delete persisted.entries[key];
                delete persisted.items[key];
            }
        });
        var keys = Object.keys(persisted.entries);
        if (keys.length > 500) {
            keys.sort(function (a, b) {
                return persisted.entries[b].until - persisted.entries[a].until;
            });
            keys.slice(500).forEach(function (key) {
                delete persisted.entries[key]; delete persisted.items[key];
            });
        }
        try { L.Storage.set(persistentKey, persisted, true); } catch (e) {}
    }
    function schedulePersistent() {
        if (!persistTimer && L.Storage.set) persistTimer = setTimeout(savePersistent, 350);
    }
    function loadPersistent(source) {
        if (persisted && persistentSource === source) return;
        savePersistent();
        persistentSource = source;
        var value;
        try { if (L.Storage.get) value = L.Storage.get(persistentKey); } catch (e) {}
        if (!value || value.version !== 2 || value.source !== source
            || !value.entries || typeof value.entries !== 'object' || Array.isArray(value.entries))
            value = {version: 2, source: source, entries: {}, items: {}};
        if (!value.items || typeof value.items !== 'object') value.items = {};
        persisted = value;
        known = Object.create(null);
        Object.keys(value.items).slice(-200).forEach(function (key) {
            if (value.items[key] && recordValid(value.entries[key])) known[key] = value.items[key];
        });
    }
    function remember(item) {
        var key = keyOf(item);
        known[key] = item;
        if (Object.keys(known).length > 220)
            delete known[Object.keys(known)[0]];
    }
    function saveRecord(job, record, fromSql) {
        if (job.generation !== generation) return;
        cache[job.key] = record;
        if (persisted) {
            var key = keyOf(job.item);
            persisted.entries[key] = record;
            persisted.items[key] = job.item;
            schedulePersistent();
        }
        if (Object.keys(cache).length > 500) cache = Object.create(null);
        if (!fromSql) enqueueSqlWrite(job, record.label, ttlDays(record.label, job.item));
    }
    function dropPending(job, label) {
        var callbacks = pending[job.key] || [];
        delete pending[job.key];
        callbacks.forEach(function (cb) { try { cb(label); } catch (e) {} });
    }
    function updateVisible(job, label) {
        if (job.generation !== generation || !configured()) return;
        var cards = document.querySelectorAll('.card');
        for (var i = 0; i < cards.length; i++) {
            var item = normalize(cards[i].card_data);
            if (item && keyOf(item) === keyOf(job.item)) draw(cards[i], label, false);
        }
        if (lastFull && lastFull.key === keyOf(job.item)
            && lastFull.generation === generation)
            draw(lastFull.node, label, true);
    }
    function complete(job, label, success, fromSql, serverRecord) {
        if (job.generation !== generation) success = false;
        if (success) {
            var saved = makeRecord(label, job.item, serverRecord);
            saveRecord(job, saved, fromSql);
            updateVisible(job, label);
        }
        dropPending(job, success ? label : null);
        if (success && fromSql && recordDue(saved, job.item))
            enqueueBackground(job.item);
    }
    function resetSource(current) {
        if (current === signature) return;
        signature = current;
        generation++;
        cache = Object.create(null);
        loadPersistent(hashId(current));
        var abandoned = queue.splice(0).concat(backgroundQueue.splice(0),
            sqlPending.splice(0));
        if (sqlBatchTimer) { clearTimeout(sqlBatchTimer); sqlBatchTimer = null; }
        abandoned.forEach(function (job) { dropPending(job, null); });
        lastRefresh = Object.create(null);
    }
    function jobFor(item) {
        return {key: generation + ':' + keyOf(item), item: item,
            generation: generation, sourceHash: persistentSource, movieHash: hashId(keyOf(item))};
    }
    function enqueueBackground(item) {
        if (!configured() || !backgroundEnabled()) return;
        var key = generation + ':' + keyOf(item);
        var existing = cache[key] || (persisted && persisted.entries[keyOf(item)]);
        if (!existing || !recordDue(existing, item) || pending[key]) return;
        // Avoid retry storms when JacRed fails. Low-priority requests are throttled.
        if (Date.now() - (lastRefresh[key] || 0) < 15 * 60000) return;
        if (backgroundQueue.length >= 60) return;
        lastRefresh[key] = Date.now();
        pending[key] = [];
        backgroundQueue.push(jobFor(item));
        runQueue();
    }
    root.LampaQuality = {
        status: function () {
            return {loaded: true, parser_type: String(L.Storage.field('parser_torrent_type') || ''),
                configured: configured(), active_requests: active,
                queued_requests: queue.length + backgroundQueue.length + sqlPending.length,
                cache_entries: Object.keys(cache).length,
                persistent_entries: persisted ? Object.keys(persisted.entries).length : 0,
                sql_cache: !!(sqlScope && !sqlUnavailable),
                batch_size: sqlBatchSize(), background_refresh: backgroundEnabled()};
        },
        refresh: function () { refreshKnown(true); }
    };

    function resolve(item, callback) {
        if (!configured()) { callback(null); return; }
        resetSource(sourceSignature());
        remember(item);
        var job = jobFor(item);
        var saved = cache[job.key];
        if (!saved && persisted) {
            saved = persisted.entries[keyOf(item)];
            if (recordValid(saved)) cache[job.key] = saved;
        }
        if (recordValid(saved)) {
            callback(saved.label);
            if (recordDue(saved, item)) enqueueBackground(item);
            return;
        }
        if (pending[job.key]) { pending[job.key].push(callback); return; }
        if (queue.length + backgroundQueue.length + sqlPending.length >= 120) {
            callback(null); return;
        }
        pending[job.key] = [callback];
        if (sqlScope && !sqlUnavailable) {
            sqlPending.push(job);
            scheduleSqlBatch();
        } else {
            queue.push(job); runQueue();
        }
    }
    function sendSqlBatch(op, jobs, done) {
        if (!sqlScope || !sqlEndpoint || sqlUnavailable || !root.fetch) {
            done(null, false); return;
        }
        var payload = {op: op, scope: sqlScope, source: jobs[0].sourceHash,
            items: jobs.map(function (job) {
                var result = {movie: job.movieHash};
                if (op === 'put_batch') {
                    result.label = job.label;
                    result.ttlDays = job.ttlDays;
                }
                return result;
            })};
        var settled = false;
        var timer = setTimeout(function () { finish(null, false); }, 2500);
        function finish(response, ok) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            done(response, ok);
        }
        root.fetch(sqlEndpoint, {method: 'POST', credentials: 'same-origin',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)})
            .then(function (response) {
                if (!response.ok) throw new Error('Quality SQL batch unavailable');
                return response.json();
            }).then(function (response) { finish(response, true); })
            .catch(function () { sqlUnavailable = true; finish(null, false); });
    }
    function scheduleSqlBatch() {
        if (sqlBatchTimer || !sqlPending.length) return;
        if (sqlPending.length >= sqlBatchSize()) { flushSqlBatch(); return; }
        sqlBatchTimer = setTimeout(flushSqlBatch, batchDelayMs);
    }
    function flushSqlBatch() {
        if (sqlBatchTimer) { clearTimeout(sqlBatchTimer); sqlBatchTimer = null; }
        if (!sqlPending.length) return;
        var jobs = sqlPending.splice(0, sqlBatchSize());
        var currentGeneration = generation;
        sendSqlBatch('get_batch', jobs, function (response, ok) {
            jobs.forEach(function (job) {
                if (job.generation !== generation || currentGeneration !== generation) {
                    dropPending(job, null); return;
                }
                var record = ok && response && response.results
                    && response.results[job.movieHash];
                if (record && recordValid(record)) {
                    complete(job, record.label, true, true, record);
                } else {
                    queue.push(job);
                }
            });
            runQueue();
        });
        if (sqlPending.length) scheduleSqlBatch();
    }
    function enqueueSqlWrite(job, label, days) {
        if (!sqlScope || sqlUnavailable || !root.fetch) return;
        sqlWrites.push({sourceHash: job.sourceHash, movieHash: job.movieHash,
            label: label, ttlDays: days});
        if (sqlWrites.length >= sqlBatchSize()) flushSqlWrites();
        else if (!sqlWriteTimer) sqlWriteTimer = setTimeout(flushSqlWrites, batchDelayMs);
    }
    function flushSqlWrites() {
        if (sqlWriteTimer) { clearTimeout(sqlWriteTimer); sqlWriteTimer = null; }
        if (!sqlWrites.length) return;
        var first = sqlWrites[0].sourceHash, jobs = [];
        for (var i = 0; i < sqlWrites.length && jobs.length < sqlBatchSize();) {
            if (sqlWrites[i].sourceHash === first) jobs.push(sqlWrites.splice(i, 1)[0]);
            else i++;
        }
        sendSqlBatch('put_batch', jobs, function () {});
        if (sqlWrites.length)
            sqlWriteTimer = setTimeout(flushSqlWrites, batchDelayMs);
    }
    function runQueue() {
        while (active < 2 && (queue.length || backgroundQueue.length)) {
            (function (job) {
                active++;
                var finished = false;
                var timeout = setTimeout(function () { finish(null, false); }, 20000);
                function finish(label, success) {
                    if (finished) return;
                    finished = true;
                    clearTimeout(timeout);
                    active--;
                    complete(job, label, success, false);
                    runQueue();
                }
                if (job.generation !== generation) { finish(null, false); return; }
                try {
                    L.Parser.get(parserRequest(job.item), function (response) {
                        if (!response || !Array.isArray(response.Results)) return finish(null, false);
                        finish(bestOf(response.Results, job.item), true);
                    }, function () { finish(null, false); });
                } catch (e) { finish(null, false); }
            })(queue.length ? queue.shift() : backgroundQueue.shift());
        }
    }
    function refreshKnown(force) {
        if (!configured() || (!force && !backgroundEnabled())) return;
        if (document.hidden) return;
        var items = Object.keys(known), queued = 0;
        for (var i = 0; i < items.length && queued < 3; i++) {
            var item = known[items[i]];
            var record = cache[generation + ':' + items[i]]
                || (persisted && persisted.entries[items[i]]);
            if (!item || !record || (!force && !recordDue(record, item))) continue;
            if (force) {
                var key = generation + ':' + keyOf(item);
                if (!pending[key] && backgroundQueue.length < 60) {
                    pending[key] = [];
                    backgroundQueue.push(jobFor(item));
                    queued++;
                }
            } else {
                var before = backgroundQueue.length;
                enqueueBackground(item);
                if (backgroundQueue.length > before) queued++;
            }
        }
        runQueue();
    }
    function draw(node, label, full) {
        // Lampa uses .card__quality on the poster and .full-start__status
        // inside .full-start-new__rate-line on the full page.
        if (!label || !node || !document.body || (!full && !document.body.contains(node))) return;
        var parent = full ? node.querySelector('.full-start-new__rate-line')
            : node.querySelector('.card__view');
        if (!parent) return;
        var badge = parent.querySelector('.quality-module-badge');
        if (!badge) {
            badge = document.createElement('div');
            parent.appendChild(badge);
        }
        badge.className = (full ? 'full-start__status quality-module-full'
            : 'card__quality quality-module-poster') + ' quality-module-badge quality-module-' + label.toLowerCase();
        badge.textContent = label;
    }

    function load(itemData, node, full) {
        var item = normalize(itemData);
        if (!item) return;
        var identity = keyOf(item);
        resolve(item, function (label) {
            if (!full) {
                var current = normalize(node && node.card_data);
                if (!current || keyOf(current) !== identity) return;
            }
            draw(node, label, full);
        });
    }

    var intersection = typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(function (entries) {
            entries.forEach(function (e) {
                if (!e.isIntersecting) return;
                intersection.unobserve(e.target);
                load(e.target.card_data, e.target, false);
            });
        }, {rootMargin: '150px'}) : null;

    function scan() {
        var enabled = configured();
        var source = enabled ? sourceSignature() : '';
        var cards = document.querySelectorAll('.card');
        for (var i = 0; i < cards.length; i++) {
            var card = cards[i];
            var previous = card.querySelector('.quality-module-badge');
            if (!enabled) {
                if (previous && previous.remove) previous.remove();
                if (observed) observed.delete(card);
                continue;
            }
            var item = normalize(card.card_data);
            if (!item) continue;
            var identity = keyOf(item) + ':' + source;
            if (observed && observed.get(card) === identity) continue;
            if (observed) observed.set(card, identity);
            if (previous && previous.remove) previous.remove();
            if (intersection) intersection.observe(card);
            else load(card.card_data, card, false);
        }
    }

    function start() {
        var style = document.createElement('style');
        style.textContent = '.quality-module-badge{box-sizing:border-box;z-index:3;pointer-events:none;'
            + 'font-weight:750;text-align:center;white-space:nowrap;line-height:1.35;'
            + 'letter-spacing:.015em;text-shadow:0 1px 1px rgba(0,0,0,.16);}'
            + '.card__quality.quality-module-poster{left:-.7em;bottom:3em;top:auto;right:auto;'
            + 'font-size:.85em;padding:.3em .65em;border-radius:.3em;box-shadow:0 2px 8px #0007;}'
            + '.full-start__status.quality-module-full{display:inline-flex;align-items:center;'
            + 'justify-content:center;position:static;flex-shrink:0;min-width:2.5em;'
            + 'padding:.25em .65em;font-size:1.1em;margin-left:.25em;'
            + 'border:1px solid currentColor;border-radius:.35em;}'
            + '.quality-module-cam,.quality-module-ts,.quality-module-tc{background:#b92c36!important;color:#fff!important;}'
            + '.quality-module-sd{background:#bc681e!important;color:#fff!important;}'
            + '.quality-module-hd{background:#246eb4!important;color:#fff!important;}'
            + '.quality-module-fhd{background:#6356b4!important;color:#fff!important;}'
            + '.quality-module-4k{background:#178553!important;color:#fff!important;}';
        (document.head || document.documentElement).appendChild(style);
        L.Listener.follow('full', function (event) {
            if (!event || event.type !== 'complite' || !event.data || !event.data.movie) return;
            load(event.data.movie, event.body && (event.body[0] || event.body), true);
        });
        if (typeof MutationObserver === 'function') {
            var scheduled = false;
            new MutationObserver(function () {
                if (scheduled) return;
                scheduled = true;
                setTimeout(function () { scheduled = false; scan(); }, 200);
            }).observe(document.body, {childList: true, subtree: true});
        } else {
            setInterval(scan, 2500);
        }
        L.Listener.follow('app', function (event) {
            if (event && event.type === 'ready') scan();
        });
        if (L.Storage.listener && L.Storage.listener.follow) {
            L.Storage.listener.follow('change', function (event) {
                if (event && /^(parser_torrent_type|parser_use_link|jackett_url|jackett_key|jackett_url_two|jackett_key_two|jackett_interview)$/.test(event.name))
                    scan();
            });
        }
        scan();
    }
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start);
})(typeof window !== 'undefined' ? window : globalThis);
