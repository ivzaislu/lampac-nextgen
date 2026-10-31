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
    var cache = Object.create(null), pending = Object.create(null), queue = [];
    var active = 0, signature = '', generation = 0;
    var observed = typeof WeakMap === 'function' ? new WeakMap() : null;

    function configured() {
        var s = L.Storage;
        if (s.field('parser_torrent_type') !== 'jackett') return false;
        var mode = s.field('parser_use_link') || 'one';
        return mode === 'two' ? !!s.field('jackett_url_two')
            : mode === 'one' ? !!s.field('jackett_url')
            : !!(s.field('jackett_url') || s.field('jackett_url_two'));
    }

    function sourceSignature() {
        var s = L.Storage;
        // Only in memory; no URLs or credentials sent to Lampac Quality.
        return [s.field('jackett_url'), s.field('jackett_key'), s.field('jackett_url_two'),
            s.field('jackett_key_two'), s.field('parser_use_link'),
            s.field('jackett_interview')].join('|');
    }

    function keyOf(item) {
        return item.source + ':' + item.type + ':' + (item.id || item.title) + ':' + item.year;
    }

    root.LampaQuality = {
        status: function () {
            return {
                loaded: true,
                parser_type: String(L.Storage.field('parser_torrent_type') || ''),
                configured: configured(),
                active_requests: active,
                queued_requests: queue.length,
                cache_entries: Object.keys(cache).length
            };
        }
    };

    function resolve(item, callback) {
        if (!configured()) { callback(null); return; }
        var current = sourceSignature();
        if (current !== signature) {
            signature = current;
            generation++;
            cache = Object.create(null);
            var abandoned = queue.splice(0);
            abandoned.forEach(function (job) {
                var waiting = pending[job.key] || [];
                delete pending[job.key];
                waiting.forEach(function (cb) { try { cb(null); } catch (e) {} });
            });
        }
        // Old in-flight and new requests must never share a pending entry.
        var key = generation + ':' + keyOf(item);
        var saved = cache[key];
        if (saved && saved.until > Date.now()) { callback(saved.label); return; }
        if (pending[key]) { pending[key].push(callback); return; }
        if (queue.length >= 120) { callback(null); return; }
        pending[key] = [callback];
        queue.push({key: key, item: item, generation: generation});
        runQueue();
    }

    function complete(job, label, success) {
        if (job.generation !== generation) { label = null; success = false; }
        if (success) {
            var days = /^(CAM|TS|TC)$/.test(label || '') ? 1 : label === '4K' ? 10 : label ? 5 : 1;
            cache[job.key] = {label: label, until: Date.now() + days * 86400000};
            if (Object.keys(cache).length > 500) cache = Object.create(null);
        }
        var callbacks = pending[job.key] || [];
        delete pending[job.key];
        callbacks.forEach(function (cb) { try { cb(label); } catch (e) {} });
        active--;
        runQueue();
    }

    function runQueue() {
        while (active < 2 && queue.length) {
            (function (job) {
                active++;
                var finished = false;
                var timeout = setTimeout(function () { finish(null, false); }, 20000);
                function finish(label, ok) {
                    if (finished) return;
                    finished = true;
                    clearTimeout(timeout);
                    complete(job, label, ok);
                }
                try {
                    L.Parser.get(parserRequest(job.item), function (response) {
                        if (!response || !Array.isArray(response.Results)) return finish(null, false);
                        finish(bestOf(response.Results, job.item), true);
                    }, function () { finish(null, false); });
                } catch (e) { finish(null, false); }
            })(queue.shift());
        }
    }

    function draw(node, label, full) {
        // The full/complite event can arrive before its subtree is attached to the document.
        if (!label || !node || !document.body || (!full && !document.body.contains(node))) return;
        var parent = full ? node.querySelector('.full-start-new__rate-line')
            || node.querySelector('.full-start-new__details')
            : node.querySelector('.card__view') || node;
        if (!parent) return;
        var badge = parent.querySelector('.quality-module-badge');
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'quality-module-badge' + (full ? ' quality-module-full' : '');
            parent.appendChild(badge);
        }
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
        style.textContent = '.quality-module-badge{display:inline-block;position:absolute;right:.4em;top:.4em;'
            + 'z-index:5;background:#243a56;color:white;border:1px solid #6ca8e8;'
            + 'border-radius:.3em;font-size:.85em;font-weight:600;padding:.2em .45em;pointer-events:none;}'
            + '.quality-module-full{position:static;margin-left:.4em;vertical-align:middle;}';
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
