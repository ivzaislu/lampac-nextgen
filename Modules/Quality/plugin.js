(function (root) {
    'use strict';

    var rank = {CAM: 1, TS: 2, TC: 3, SD: 4, HD: 5, FHD: 6, '4K': 7};

    function qualityOf(release) {
        if (!release) return '';
        var info = release.Info || release.info || {};
        var title = String(release.Title || release.title || '');
        var source = String(info.videotype || release.videotype || '');
        // JacRed may report resolution as the text "1080p", not a number.
        var qualityText = String(info.quality || release.quality || '');
        var video = (source + ' ' + title + ' ' + qualityText)
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
            else if (/480p|\b480\b|web-dlrip|\bbdrip\b|\bhdrip\b|\bdvdrip\b|\btvrip\b/i.test(video)) resolution = 480;
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
        var names = [info.name, info.originalname, info.original_name,
            release.name, release.originalname, release.original_name]
            .map(normalizedTitle).filter(Boolean);
        if (names.some(function (name) { return candidates.indexOf(name) >= 0; })) return true;
        var title = ' ' + normalizedTitle(release.Title || release.title) + ' ';
        return candidates.some(function (name) {
            if (title.indexOf(' ' + name + ' ') >= 0) return true;
            // WALL·E / WALL-E / WALLE and ВАЛЛ·И / ВАЛЛИ:
            // combine only a one-letter suffix, not arbitrary words.
            var parts = name.split(' ');
            if (parts.length === 2 && parts[1].length === 1
                && parts[0].length >= 3) {
                var compact = parts.join('');
                if (title.indexOf(' ' + compact + ' ') >= 0) return true;
            }
            return false;
        });
    }

    // Only whole promotional markers outside the requested title count.
    // For example, "The Trailer Park Boys" is a show title, not a trailer.
    function promotionalRelease(release, item) {
        var info = release.Info || release.info || {};
        var text = ' ' + normalizedTitle(release.Title || release.title) + ' ';
        var aliases = item ? [normalizedTitle(item.title), normalizedTitle(item.original)] : [];
        aliases.filter(Boolean).sort(function (a, b) { return b.length - a.length; })
            .forEach(function (name) {
                if (name.length < 3) return;
                var match = ' ' + name + ' ';
                while (text.indexOf(match) >= 0) text = text.replace(match, ' ');
            });
        text += ' ' + normalizedTitle(info.videotype || release.videotype || '');
        var markers = /(?:^|\s)(?:trailer(?:s)?|teaser(?:s)?|promo(?:s|tional)?|advert(?:s|isement|ising)?|commercial(?:s)?|preview(?:s)?|featurette(?:s)?|sample(?:s)?|clip(?:s)?|sneak\s+peek|tv\s+spots?|behind\s+the\s+scenes|making\s+of|trailer\s+cut|трейлер(?:ы|а|ов)?|тизер(?:ы|а|ов)?|промо(?:ролик(?:и|ов)?)?|реклам(?:а|ный|ная|ное|ные|ного|ных)|анонс(?:ы|а)?|сэмпл(?:ы|а)?|отрывок|фрагмент(?:ы|а)?|нарезка)(?:\s|$)/i;
        return markers.test(text);
    }

    function releaseTypes(release) {
        var info = release.Info || release.info || {};
        var types = info.types || release.types || [];
        if (!Array.isArray(types)) types = [types];
        return types.map(function (type) { return String(type || '').toLowerCase().trim(); })
            .filter(Boolean);
    }

    function hasSeriesEvidence(release) {
        if (seasonRelease(release)) return true;
        var text = normalizedTitle(release.Title || release.title);
        if (/(?:^| )(?:сериал|телесериал|мультсериал|все серии|полный сериал|эпизод(?:ы|ов)?|серии|эпизоды|complete series|full series|all episodes|episode(?:s)?)(?: |$)/.test(text))
            return true;
        // A year span is characteristic of a multi-season collection,
        // unlike a feature-film release year.
        return /(?:19|20)\d{2}\s*[-–—]\s*(?:19|20)\d{2}/.test(String(release.Title || release.title || ''));
    }

    function yearOf(release) {
        var info = release.Info || release.info || {};
        var reported = Number(info.relased || release.relased || 0);
        if (reported >= 1900 && reported <= 2100) return reported;
        var title = String(release.Title || release.title || '');
        var matches = title.match(/(?:^|\D)(?:19|20)\d\d(?=\D|$)/g) || [];
        for (var i = 0; i < matches.length; i++) {
            var candidate = Number(matches[i].replace(/\D/g, ''));
            if (candidate >= 1900 && candidate <= 2100)
                return candidate;
        }
        return 0;
    }
    function seasonRelease(release) {
        var title = String(release.Title || release.title || '');
        return /(?:^|[^a-z\d])s\d{1,2}(?:e\d{1,3})?(?:[^a-z\d]|$)|\bseasons?[\s._-]*\d{1,2}\b|сезон(?:ы|ов)?[\s._-]*\d{1,2}|\d{1,2}[\s._-]*(?:сезон(?:ы|ов)?|seasons?)|\b\d{1,2}[xх]\d{1,3}\b/i.test(title);
    }

    function bestOf(results, item) {
        if (!Array.isArray(results)) return null;
        var best = null, bestScore = -1;
        results.forEach(function (release) {
            if (!release) return;
            var title = String(release.Title || release.title || '');
            if (!title || !matchesTitle(release, item)) return;
            if (promotionalRelease(release, item)) return;
            var types = releaseTypes(release);
            var declaredTv = types.some(function (type) {
                return /^(serial|docuserial|tvshow|series|tv|anime_serial|multserial)$/.test(type);
            });
            var declaredMovie = types.some(function (type) {
                return /^(movie|documovie|film|anime_movie|multfilm)$/.test(type);
            });
            if (item.type === 'tv') {
                // JacRed sometimes attaches both "multfilm" and "multserial"
                // to an animated *feature* film (e.g. WALL-E). Do not let an
                // ambiguous animation category alone prove a TV episode.
                if (declaredMovie && (!declaredTv || !hasSeriesEvidence(release))) return;
                // JacRed's generic search can return a feature film, game,
                // advertisement or spin-off sharing the series name.
                // A series label or season/episode evidence is required.
                if (!declaredTv && !hasSeriesEvidence(release)) return;
                var afterName = ' ' + normalizedTitle(title) + ' ';
                if (/(?:^|\s)(?:movie|feature\s+film|полнометражный\s+фильм)(?:\s|$)/.test(afterName)
                    && !hasSeriesEvidence(release)) return;
            } else if (types.length && !declaredMovie) {
                return;
            }
            var year = yearOf(release);
            if (year > new Date().getFullYear() + 1) return;
            if (year && item.year && Math.abs(year - item.year) > (item.type === 'tv' ? 5 : 1)) {
                if (item.type === 'movie') {
                    // A restored/remastered film may have metadata dated with
                    // the new release, despite the title naming the original year.
                    var titleYears = String(title).match(/(?:^|\D)(?:19|20)\d{2}(?=\D|$)/g) || [];
                    var exactOriginalYear = titleYears.some(function (part) {
                        return Math.abs(Number(part.replace(/\D/g, '')) - item.year) <= 1;
                    });
                    if (!exactOriginalYear) return;
                } else if (year < item.year || !hasSeriesEvidence(release)) {
                    // A torrent's release year can be much later than the
                    // premiere of a long-running show.
                    return;
                }
            }
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

    function searchTitles(item) {
        // The original qulity_lampa tries the original name first, then the
        // local title. Lampa.Parser.get accepts one title per call.
        var titles = [item.original, item.title].filter(function (value) {
            return !!String(value || '').trim();
        });
        return titles.filter(function (value, index) {
            return titles.map(normalizedTitle).indexOf(normalizedTitle(value)) === index;
        });
    }
    function parserRequest(item, search, broad) {
        return {
            search: search || item.title,
            // TV shows premiered decades ago are frequently excluded when
            // the Jackett endpoint filters by the show's original year.
            // One last, title-only lookup removes that year restriction.
            from_search: broad === true,
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
    var sqlRetryAt = 0, sqlActive = 0, sqlWriteActive = 0;
    var sqlBatchTimer = null, sqlWriteTimer = null, persistTimer = null;
    var persisted = null, persistentSource = '', lastFull = null;
    var known = Object.create(null), observed = typeof WeakMap === 'function' ? new WeakMap() : null;
    // v6 rechecks HD/FHD/4K after fixing JacRed's multfilm category. Previous
    // SQL/local results may have excluded real 4K cartoon releases.
    var persistentKey = 'quality_module_cache_v6', algorithmVersion = 'jacred-animation-v6';
    var scriptSource = document.currentScript && document.currentScript.src || '';
    var sqlEndpoint = /\/quality\.js(?:\?.*)?$/i.test(scriptSource)
        ? scriptSource.replace(/\/quality\.js(?:\?.*)?$/i, '/quality/cache') : '';
    var sqlScope = '';
    var rankLabels = Object.keys(rank);
    var batchDelayMs = 150, maxSqlBatch = 30;
    var lastRefresh = Object.create(null);
    var backgroundTokens = 3, backgroundTokenTime = Date.now();

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
    function sqlReady() {
        if (!sqlEndpoint || !sqlScope || typeof root.fetch !== 'function') return false;
        if (sqlUnavailable && Date.now() >= sqlRetryAt) sqlUnavailable = false;
        return !sqlUnavailable;
    }
    function failSql() {
        // Retry after a temporary outage without requiring a Lampa restart.
        sqlUnavailable = true;
        sqlRetryAt = Date.now() + 60000;
    }
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
        return [algorithmVersion, s.field('jackett_url'), s.field('jackett_key'),
            s.field('jackett_url_two'), s.field('jackett_key_two'),
            s.field('parser_use_link'), s.field('jackett_interview')].join('|');
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
        if (!value || value.version !== 6 || value.source !== source
            || !value.entries || typeof value.entries !== 'object' || Array.isArray(value.entries))
            value = {version: 6, source: source, entries: {}, items: {}};
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
        if (current) {
            loadPersistent(hashId(current));
        } else {
            // Disabling must not replace the last valid source's saved cache
            // with an empty record under the same Lampa.Storage key.
            savePersistent();
            persisted = null;
            persistentSource = '';
            known = Object.create(null);
        }
        var abandoned = queue.splice(0).concat(backgroundQueue.splice(0),
            sqlPending.splice(0));
        if (sqlBatchTimer) { clearTimeout(sqlBatchTimer); sqlBatchTimer = null; }
        abandoned.forEach(function (job) { dropPending(job, null); });
        lastRefresh = Object.create(null);
        backgroundTokens = 3;
        backgroundTokenTime = Date.now();
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
        if (Date.now() - backgroundTokenTime >= 60000) {
            backgroundTokenTime = Date.now();
            backgroundTokens = 3;
        }
        if (backgroundTokens <= 0) return;
        backgroundTokens--;
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
                sql_cache: sqlReady(), sql_active_requests: sqlActive + sqlWriteActive,
                sql_retry_in_ms: sqlUnavailable ? Math.max(0, sqlRetryAt - Date.now()) : 0,
                batch_size: sqlBatchSize(), background_refresh: backgroundEnabled(),
                online_source_filter: onlineFilterEnabled(),
                online_filter_hook: onlineBridgeInstalled,
                online_filters_detected: onlineFiltersDetected,
                online_filter_sources: onlineFilterSources};
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
        // Keep a bounded backlog, but do not drop a 100–200 card catalogue
        // merely because SQL lookups are limited to two HTTP batches.
        if (queue.length + backgroundQueue.length + sqlPending.length >= 300) {
            callback(null); return;
        }
        pending[job.key] = [callback];
        if (sqlReady()) {
            sqlPending.push(job);
            scheduleSqlBatch();
        } else {
            queue.push(job); runQueue();
        }
    }
    function sendSqlBatch(op, jobs, done) {
        if (!sqlReady()) {
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
        var timer = setTimeout(function () {
            failSql();
            finish(null, false);
        }, 2500);
        function finish(response, ok) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            done(response, ok);
        }
        try {
            root.fetch(sqlEndpoint, {method: 'POST', credentials: 'same-origin',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload)})
                .then(function (response) {
                    if (!response.ok) throw new Error('Quality SQL batch unavailable');
                    return response.json();
                }).then(function (response) { finish(response, true); })
                .catch(function () { failSql(); finish(null, false); });
        } catch (e) {
            failSql();
            finish(null, false);
        }
    }
    function scheduleSqlBatch() {
        if (sqlBatchTimer || !sqlPending.length || sqlActive >= 2) return;
        if (sqlPending.length >= sqlBatchSize()) { flushSqlBatch(); return; }
        sqlBatchTimer = setTimeout(flushSqlBatch, batchDelayMs);
    }
    function flushSqlBatch() {
        if (sqlBatchTimer) { clearTimeout(sqlBatchTimer); sqlBatchTimer = null; }
        if (!sqlPending.length || sqlActive >= 2) return;
        var jobs = sqlPending.splice(0, sqlBatchSize());
        sqlActive++;
        var currentGeneration = generation;
        sendSqlBatch('get_batch', jobs, function (response, ok) {
            sqlActive--;
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
            if (sqlPending.length) scheduleSqlBatch();
        });
        if (sqlPending.length) scheduleSqlBatch();
    }
    function enqueueSqlWrite(job, label, days) {
        if (!sqlReady()) return;
        sqlWrites.push({sourceHash: job.sourceHash, movieHash: job.movieHash,
            label: label, ttlDays: days});
        if (sqlWrites.length >= sqlBatchSize()) flushSqlWrites();
        else if (!sqlWriteTimer) sqlWriteTimer = setTimeout(flushSqlWrites, batchDelayMs);
    }
    function flushSqlWrites() {
        if (sqlWriteTimer) { clearTimeout(sqlWriteTimer); sqlWriteTimer = null; }
        if (!sqlWrites.length || sqlWriteActive >= 1) return;
        var first = sqlWrites[0].sourceHash, jobs = [];
        for (var i = 0; i < sqlWrites.length && jobs.length < sqlBatchSize();) {
            if (sqlWrites[i].sourceHash === first) jobs.push(sqlWrites.splice(i, 1)[0]);
            else i++;
        }
        sqlWriteActive++;
        sendSqlBatch('put_batch', jobs, function () {
            sqlWriteActive--;
            if (sqlWrites.length)
                sqlWriteTimer = setTimeout(flushSqlWrites, batchDelayMs);
        });
    }
    function runQueue() {
        while (active < 2 && (queue.length || backgroundQueue.length)) {
            (function (job) {
                active++;
                var finished = false;
                var timeout = setTimeout(function () { finish(null, false); }, 35000);
                function finish(label, success) {
                    if (finished) return;
                    finished = true;
                    clearTimeout(timeout);
                    active--;
                    complete(job, label, success, false);
                    runQueue();
                }
                if (job.generation !== generation) { finish(null, false); return; }
                var titles = searchTitles(job.item), attempt = 0, anySuccess = false;
                var highest = null;
                var plans = titles.map(function (title) { return {title: title, broad: false}; });
                if (job.item.type === 'tv') titles.forEach(function (title) {
                    plans.push({title: title, broad: true});
                });
                // For older movies, a single title-only search can discover a
                // 4K remaster excluded by strict year/title filters. Keep the
                // parser queue limit (2) and only run this if still below FHD.
                if (job.item.type === 'movie' && job.item.year
                    && job.item.year < new Date().getFullYear() - 2 && titles.length)
                    plans.push({title: titles[0], broad: true, ifBelow: '4K'});
                function requestNext() {
                    if (finished) return;
                    if (job.generation !== generation) { finish(null, false); return; }
                    if (attempt >= plans.length || highest === '4K') {
                        finish(highest, anySuccess);
                        return;
                    }
                    var plan = plans[attempt++];
                    if (plan.ifBelow && highest && rank[highest] >= rank[plan.ifBelow]) {
                        requestNext();
                        return;
                    }
                    try {
                        L.Parser.get(parserRequest(job.item, plan.title, plan.broad), function (response) {
                            if (finished) return;
                            if (job.generation !== generation) { finish(null, false); return; }
                            if (response && Array.isArray(response.Results)) {
                                anySuccess = true;
                                var label = bestOf(response.Results, job.item);
                                if (label && (!highest || rank[label] > rank[highest]))
                                    highest = label;
                            }
                            requestNext();
                        }, function () { requestNext(); });
                    } catch (e) { requestNext(); }
                }
                requestNext();
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
        if (!node || !document.body || (!full && !document.body.contains(node))) return;
        var parent = full ? node.querySelector('.full-start-new__rate-line')
            : node.querySelector('.card__view');
        if (!parent) return;
        var badge = parent.querySelector('.quality-module-badge');
        if (!label) { if (badge && badge.remove) badge.remove(); return; }
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
        if (full) lastFull = {key: identity, node: node, data: itemData, generation: generation};
        resolve(item, function (label) {
            // Settings/source may change while SQL or JacRed is still pending.
            if (!configured() || sourceSignature() !== signature) return;
            if (!full) {
                var current = normalize(node && node.card_data);
                if (!current || keyOf(current) !== identity) return;
            }
            draw(node, label, full);
        });
        if (full && lastFull && lastFull.node === node) lastFull.generation = generation;
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
        if (source !== signature) {
            // Invalidate outstanding callbacks and remove badges on the full
            // page too, not only on posters. Re-enable restores the full
            // badge from the existing cache or starts a fresh lookup.
            if (lastFull) draw(lastFull.node, null, true);
            resetSource(source);
            if (enabled && lastFull && lastFull.data)
                load(lastFull.data, lastFull.node, true);
        }
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
            if (observed && observed.get(card) === identity) {
                if (!previous) { load(card.card_data, card, false); continue; }
                var saved = cache[generation + ':' + keyOf(item)]
                    || (persisted && persisted.entries[keyOf(item)]);
                if (saved && recordDue(saved, item)) enqueueBackground(item);
                continue;
            }
            if (observed) observed.set(card, identity);
            if (previous && previous.remove) previous.remove();
            if (intersection) intersection.observe(card);
            else load(card.card_data, card, false);
        }
    }

    // Optional Online UX bridge. Identify the actual balancer list populated
    // by Lampa rather than assuming Activity passes a "component" property to
    // every Filter constructor. The previous assumption made the shortcut
    // silently disappear in some Online installations.
    var currentOnlineFilter = null, onlineBridgeInstalled = false;
    var onlineFiltersDetected = 0, onlineFilterSources = 0;
    function onlineFilterEnabled() {
        var value = setting('quality_module_online_source_filter', true);
        return value !== false && String(value) !== 'false';
    }
    function updateOnlineFilter() {
        if (currentOnlineFilter && currentOnlineFilter.refresh)
            currentOnlineFilter.refresh();
    }
    function onlineBalancerList(items) {
        if (!Array.isArray(items) || items.length < 2) return false;
        var names = Object.create(null);
        return items.every(function (item) {
            if (!item || typeof item.source !== 'string'
                || !/^[a-z0-9_-]{2,40}$/i.test(item.source)
                || typeof item.title !== 'string'
                || !item.title.trim() || names[item.source]) return false;
            names[item.source] = true;
            return true;
        });
    }
    function onlineFilterScope(params, filterItems, sortItems) {
        if (!onlineBalancerList(sortItems)) return '';
        var declared = params && typeof params.component === 'string'
            ? params.component.toLowerCase() : '';
        // Never modify another named activity even if it happens to expose
        // fields called "source", "voice" or "season".
        if (declared && !/^online(?:$|[_-])/.test(declared)) return '';
        if (declared) return declared;
        var current = L.Activity && typeof L.Activity.active === 'function'
            ? L.Activity.active() : null;
        var activity = current && String(current.component || '').toLowerCase();
        if (activity && /^online(?:$|[_-])/.test(activity)) return activity;
        // Stock Lampa balancers are enough evidence when some forks omit the
        // component name on the Filter's params object.
        var recognized = {videocdn: true, rezka: true, kinobase: true,
            collaps: true, filmix: true, cdnmovies: true};
        var matches = sortItems.filter(function (item) {
            return recognized[item.source.toLowerCase()];
        }).length;
        var hasReset = (filterItems || []).some(function (item) {
            return item && item.reset === true;
        });
        return hasReset && matches >= 2 ? 'online-detected' : '';
    }
    function installOnlineFilter() {
        if (typeof L.Filter !== 'function') return false;
        if (L.Filter.__qualityOnlineBridge) {
            onlineBridgeInstalled = true;
            return true;
        }
        var NativeFilter = L.Filter;
        function OnlineFilterBridge(params) {
            var instance = new NativeFilter(params);
            if (!instance || typeof instance.set !== 'function'
                || typeof instance.chosen !== 'function') return instance;
            var nativeSet = instance.set;
            var nativeChosen = instance.chosen;
            var filterItems = null, sortItems = [], chosenItems = null;
            var scope = '', active = false;
            var nativeSelect = typeof instance.onSelect === 'function'
                ? instance.onSelect : null;
            var bridge = {refresh: refresh, scope: ''};
            function eligible() {
                if (!scope && filterItems && sortItems.length)
                    scope = onlineFilterScope(params, filterItems, sortItems);
                if (!scope) return false;
                if (!active) {
                    active = true;
                    onlineFiltersDetected++;
                }
                onlineFilterSources = sortItems.length;
                bridge.scope = scope;
                currentOnlineFilter = bridge;
                return true;
            }
            function available() {
                return onlineFilterEnabled() && eligible();
            }
            function selectedSource() {
                for (var i = 0; i < sortItems.length; i++)
                    if (sortItems[i].selected) return sortItems[i];
                var saved = setting('online_balanser', '');
                for (var j = 0; j < sortItems.length; j++)
                    if (sortItems[j].source === saved) return sortItems[j];
                return sortItems[0] || null;
            }
            function menuItems() {
                var items = (filterItems || []).slice();
                if (!available()) return items;
                var selected = selectedSource();
                var choices = sortItems.map(function (src) {
                    return {title: src.title, source: src.source,
                        selected: !!selected && src.source === selected.source};
                });
                var entry = {title: 'Источник / балансер',
                    subtitle: selected ? selected.title : '',
                    stype: 'quality_online_source', qualityOnlineSource: true,
                    items: choices};
                items.splice(items.length && items[0] && items[0].reset ? 1 : 0,
                    0, entry);
                return items;
            }
            function chosenWithSource(items) {
                var list = Array.isArray(items) ? items.slice() : [];
                if (available()) {
                    var selected = selectedSource();
                    if (selected) list.push('Источник: ' + selected.title);
                }
                return list;
            }
            function refresh() {
                if (filterItems) nativeSet.call(instance, 'filter', menuItems());
                if (chosenItems)
                    nativeChosen.call(instance, 'filter', chosenWithSource(chosenItems));
            }
            instance.set = function (type, items) {
                if (type === 'filter') {
                    filterItems = Array.isArray(items) ? items.filter(function (item) {
                        return !item || !item.qualityOnlineSource;
                    }) : items;
                    refresh();
                    return;
                }
                var result = nativeSet.apply(this, arguments);
                if (type === 'sort') {
                    sortItems = Array.isArray(items) ? items.slice() : [];
                    // Both stock Online implementations set filter *before*
                    // sort. A filter must therefore be rebuilt once the actual
                    // provider data is available.
                    refresh();
                }
                return result;
            };
            instance.chosen = function (type, items) {
                if (type === 'filter') {
                    chosenItems = Array.isArray(items) ? items.slice() : [];
                    return nativeChosen.call(this, type, chosenWithSource(chosenItems));
                }
                return nativeChosen.apply(this, arguments);
            };
            Object.defineProperty(instance, 'onSelect', {
                configurable: true,
                enumerable: true,
                get: function () {
                    return function (type, item, choice) {
                        if (type === 'filter' && item && item.qualityOnlineSource) {
                            if (!available() || !choice || !nativeSelect) return;
                            var source = sortItems.filter(function (option) {
                                return option.source === choice.source;
                            })[0];
                            if (!source || source.selected) return;
                            // Filter.show reopens the submenu after onSelect;
                            // let it finish before invoking native Online sort.
                            setTimeout(function () {
                                if (!onlineFilterEnabled() || currentOnlineFilter !== bridge
                                    || !nativeSelect) return;
                                if (L.Activity && typeof L.Activity.active === 'function') {
                                    var current = L.Activity.active();
                                    var currentComponent = current
                                        && String(current.component || '').toLowerCase();
                                    if (!current || (currentComponent
                                        && !/^online(?:$|[_-])/.test(currentComponent))) return;
                                    if (params && params.movie && current.movie
                                        && String(params.movie.id) !== String(current.movie.id))
                                        return;
                                }
                                nativeSelect.call(instance, 'sort', source);
                            }, 0);
                            return;
                        }
                        if (nativeSelect) return nativeSelect.apply(instance, arguments);
                    };
                },
                set: function (fn) {
                    nativeSelect = typeof fn === 'function' ? fn : null;
                }
            });
            return instance;
        }
        OnlineFilterBridge.prototype = NativeFilter.prototype;
        OnlineFilterBridge.__qualityOnlineBridge = true;
        L.Filter = OnlineFilterBridge;
        onlineBridgeInstalled = true;
        return true;
    }

    function registerSettings() {
        if (!L.SettingsApi || !L.SettingsApi.addComponent || !L.SettingsApi.addParam) return;
        L.SettingsApi.addComponent({
            component: 'quality',
            name: 'Quality — качество',
            after: 'parser',
            icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M3 17h18M5 14l4-4 3 3 6-7"/><circle cx="18" cy="6" r="2"/></svg>'
        });
        function add(name, type, label, choices, fallback, description, handler) {
            var options = {component: 'quality',
                param: {name: name, type: type, default: fallback},
                field: {name: label, description: description || ''}};
            if (choices) options.param.values = choices;
            if (handler) options.onChange = handler;
            L.SettingsApi.addParam(options);
        }
        var days = {'1': '1 день', '2': '2 дня', '3': '3 дня', '5': '5 дней',
            '7': '7 дней', '10': '10 дней', '14': '14 дней', '21': '21 день',
            '30': '30 дней', '45': '45 дней', '60': '60 дней'};
        add('quality_module_enabled', 'trigger', 'Показывать бейджи', null, true,
            'Метки качества на постерах и в полной карточке', scan);
        add('quality_module_background', 'trigger', 'Обновлять в фоне', null, true,
            'При запущенной Lampa качество периодически проверяется повторно');
        add('quality_module_online_source_filter', 'trigger',
            'Источник в фильтре Онлайн', null, true,
            'Показывать балансер рядом с озвучкой и сезонами в Онлайн',
            updateOnlineFilter);
        add('quality_module_days_low', 'select', 'CAM / TS / TC', days, '1',
            'Интервал повторной проверки низкого качества');
        add('quality_module_days_hd', 'select', 'SD / HD / FHD', days, '5',
            'Интервал повторной проверки HD-релизов');
        add('quality_module_days_4k_new', 'select', '4K — новые фильмы', days, '10',
            'Для фильмов последних двух лет');
        add('quality_module_days_4k_old', 'select', '4K — старые фильмы', days, '30',
            'Для фильмов старше двух лет');
        add('quality_module_days_empty', 'select', 'Не найдено', days, '1',
            'Интервал повторного поиска, когда релизов нет');
        add('quality_module_batch_size', 'select', 'Размер SQL-пакета',
            {'10': '10 записей', '20': '20 записей', '30': '30 записей'}, '30',
            'Число фильмов в одном запросе к кэшу Lampac');
        add('quality_module_refresh_minutes', 'select', 'Фоновая проверка',
            {'5': 'Каждые 5 минут', '15': 'Каждые 15 минут', '30': 'Каждые 30 минут',
                '60': 'Каждый час'}, '15',
            'Частота обхода ранее просмотренных карточек');
        add('quality_module_refresh_now', 'button', 'Обновить качество сейчас', null, '',
            'Повторно проверить последние фильмы в фоне', function () {
                refreshKnown(true);
            });
    }

    function start() {
        installOnlineFilter();
        registerSettings();
        // L.Filter can be assigned after Quality starts when scripts are
        // loaded asynchronously. Retry on Lampa readiness, then stop polling
        // once the native Filter constructor is wrapped.
        var filterInstallTries = 0;
        if (!onlineBridgeInstalled) {
            var filterInstallTimer = setInterval(function () {
                if (installOnlineFilter() || ++filterInstallTries >= 30)
                    clearInterval(filterInstallTimer);
            }, 1000);
            if (filterInstallTimer && typeof filterInstallTimer.unref === 'function')
                filterInstallTimer.unref();
        }
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
            if (event && event.type === 'ready') {
                installOnlineFilter();
                scan();
            }
        });
        if (L.Storage.listener && L.Storage.listener.follow) {
            L.Storage.listener.follow('change', function (event) {
                if (!event) return;
                if (/^(parser_torrent_type|parser_use_link|jackett_url|jackett_key|jackett_url_two|jackett_key_two|jackett_interview|quality_module_enabled)$/.test(event.name))
                    scan();
                if (/^quality_module_days_/.test(event.name)) refreshKnown(false);
                if (event.name === 'quality_module_online_source_filter')
                    updateOnlineFilter();
            });
        }
        scan();
        // Background work is deliberately throttled and runs only in an open Lampa.
        var backgroundTimer = setInterval(function () {
            var minutes = numberSetting('quality_module_refresh_minutes', 15, 5, 60);
            if (Date.now() - (start.lastBackground || 0) < minutes * 60000) return;
            start.lastBackground = Date.now();
            refreshKnown(false);
        }, 60000);
        if (backgroundTimer && typeof backgroundTimer.unref === 'function') backgroundTimer.unref();
    }
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start);
})(typeof window !== 'undefined' ? window : globalThis);
