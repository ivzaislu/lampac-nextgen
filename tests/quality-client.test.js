'use strict';
const assert = require('node:assert/strict');
const {qualityOf, bestOf, normalize, parserRequest} = require('../Modules/Quality/plugin.js');
const row = (Title, extra) => Object.assign({Title, Seeders: 5}, extra || {});
const movie = {type: 'movie', year: 2025, title: 'Example', original: 'Example', genres: []};
const labels = [
    ['Example 2025 HDCAM 1080p', 'CAM'],
    ['Example 2025 TS 720p', 'TS'],
    ['Example 2025 TSRip 720p', 'TS'],
    ['Example 2025 HDTS 720p', 'TS'],
    ['Example 2025 TC 1080p', 'TC'],
    ['Example 2025 HDRip', 'SD'],
    ['Example 2025 WEB-DL 720p', 'HD'],
    ['Example 2025 WEB-DL 1080p', 'FHD'],
    ['Example 2025 WEB-DL UHD 2160p', '4K'],
    ['Example 2025 [звук с TS] 1080p', 'FHD'],
    ['Example 2025 [audio from TS] 1080p', 'FHD'],
    ['Example 2025 [sound from TS] 1080p', 'FHD']
];
labels.forEach(([title, label]) => assert.equal(qualityOf(row(title)), label, title));
assert.equal(qualityOf(row('Example SD', {Info: {quality: 480}})), 'SD');
assert.equal(bestOf([row('Example Trailer 2025 4K'), row('Example 2025 1080p')], movie), 'FHD');
assert.equal(bestOf([row('Example 2010 4K')], movie), null);
assert.equal(bestOf([row('Example 2025 4K', {Info: {types: ['serial']}})], movie), null);
assert.equal(bestOf([row('Example CAM 1080p'), row('Example 2025 4K')], movie), '4K');
assert.equal(bestOf([], movie), null);
assert.equal(bestOf([row('Unrelated Movie 2025 4K'), row('Example 2025 1080p')], movie), 'FHD');
assert.equal(bestOf([row('Unrelated Movie 2025 4K')], movie), null);
const tv = normalize({id: 55, name: 'Show', original_name: 'Series', first_air_date: '2023-02-01'});
assert.equal(tv.type, 'tv');
assert.equal(tv.year, 2023);
assert.equal(parserRequest(tv).movie.original_name, 'Series');
assert.equal(parserRequest(tv).movie.number_of_seasons, 1);
assert.ok(Array.isArray(parserRequest(tv).movie.genres));
assert.equal(parserRequest(tv).global, false);

const olderShow = normalize({id: 100, name: 'The Long Show', original_name: 'The Long Show', first_air_date: '2008-04-05'});
assert.equal(bestOf([row('The Long Show S17 (2025) WEB-DL 1080p',
    {Info: {types: ['series'], relased: 2025}})], olderShow), 'FHD',
    'A new season of a long-running series is not a new unrelated title');
assert.equal(bestOf([row('The Long Show (2025) 1080p', {Info: {types: ['series']}})], olderShow), null,
    'A very different year without a season marker is ambiguous');
assert.equal(bestOf([row('The Long Show 17x02 (2025) 720p')], olderShow), 'HD',
    'Numeric episode notation also identifies a new season');
assert.equal(bestOf([row('Other Show S17 (2025) 2160p')], olderShow), null,
    'A different series must not match on year and resolution alone');
assert.equal(bestOf([row('The Long Show S17 (2032) 2160p')], olderShow), null,
    'Reject implausible future seasons');
assert.equal(qualityOf(row('Example WEB-DL', {Info: {quality: '1080p'}})), 'FHD',
    'Textual JacRed resolution should count');
assert.equal(qualityOf(row('Example DVDRip')), 'SD');
const foreignMovie = normalize({id: 333, title: 'Локальное название', original_title: 'Original Name',
    release_date: '2024-01-01'});
assert.equal(bestOf([row('Original Name (2024) WEB-DL 1080p')], foreignMovie), 'FHD');
assert.equal(parserRequest(foreignMovie, foreignMovie.original).search, 'Original Name');
assert.equal(parserRequest(foreignMovie, foreignMovie.title).search, 'Локальное название');


// Known reports: Simpsons and Family Guy are long-running shows. A current
// season year is not the show's first-air year; promotional releases and the
// South Park feature film must never determine a series badge.
const simpsons = normalize({id: 2001, name: 'Симпсоны', original_name: 'The Simpsons',
    first_air_date: '1989-12-17'});
const familyGuy = normalize({id: 2002, name: 'Гриффины', original_name: 'Family Guy',
    first_air_date: '1999-01-31'});
const southPark = normalize({id: 2003, name: 'Южный парк', original_name: 'South Park',
    first_air_date: '1997-08-13'});
assert.equal(bestOf([row('The Simpsons S36E01 (2025) WEB-DL 1080p')], simpsons), 'FHD');
assert.equal(bestOf([row('Симпсоны (1989-2025) 01-36 сезоны 720p')], simpsons), 'HD');
assert.equal(bestOf([row('Family Guy 2026 1080p', {Info:{types:['serial']}})], familyGuy), null,
    'Unqualified recent year with no season marker is not enough for an old show');
assert.equal(bestOf([row('Family Guy Season 26 (2026) 1080p',
    {Info:{types:['serial']}})], familyGuy), 'FHD');
assert.equal(bestOf([row('Гриффины S23E01 (2025) WEB-DL 720p')], familyGuy), 'HD');
assert.equal(bestOf([row('South Park S28E01 (2026) WEB-DL 1080p')], southPark), 'FHD');
assert.equal(bestOf([row('South Park: Bigger, Longer & Uncut (1999) 720p')], southPark), null,
    'Feature film sharing the TV title is not series quality');
assert.equal(bestOf([row('South Park The Movie (1999) 1080p',
    {Info:{types:['movie']}})], southPark), null);
assert.equal(bestOf([row('South Park (2026) 720p')], southPark), null,
    'Unclassified release with no season evidence must not set a series badge');
const advertisements = [
    'South Park S28 720p Official Trailer',
    'South Park S28 Promo 2160p',
    'South Park S28 TV Spot HD 1080p',
    'South Park S28 WEB-DL 2160p Teaser',
    'Южный парк S28 (2026) Реклама 4K',
    'Южный парк S28 (2026) Проморолик 4K',
    'Южный парк S28 (2026) Анонс 1080p',
    'South Park S28 (2026) Sneak Peek 720p',
    'South Park S28 (2026) Sample 1080p',
    'South Park S28 (2026) Clip 2160p'
];
advertisements.forEach(name => assert.equal(bestOf([row(name)], southPark), null,
    'Ad-only release must not result in a quality badge: ' + name));
assert.equal(bestOf([row('South Park S28 Official Trailer 2160p'),
    row('South Park S28E01 (2026) 720p')], southPark), 'HD',
    'The best actual episode wins over higher-resolution advertisements');
const trailerBoys = normalize({id: 2004, name: 'The Trailer Park Boys',
    first_air_date:'2001-04-22'});
assert.equal(bestOf([row('The Trailer Park Boys Season 2 (2002) 720p')], trailerBoys),
    'HD', 'A show titled Trailer Park Boys must not be mistaken for a trailer');
const moviePromo = {type:'movie',year:2025,title:'Example',original:'Example'};
assert.equal(bestOf([row('Example 2025 Official Trailer 4K 2160p')], moviePromo), null);
assert.equal(bestOf([row('Example 2025 Promotional 1080p')], moviePromo), null);
assert.equal(bestOf([row('Example 2025 Рекламный ролик HD 720p')], moviePromo), null);


const wallE = normalize({id:10681, title:'ВАЛЛ·И', original_title:'WALL·E',
    release_date:'2008-06-27'});
assert.equal(bestOf([row('WALL-E (2008) BluRay 720p')], wallE), 'HD');
assert.equal(bestOf([row('WALLE (2008) WEB-DL UHD 2160p')], wallE), '4K',
    'The letter E may be attached without a separator');
assert.equal(bestOf([row('WALL-E (2008) UHD 2160p',
    {Info: {relased: 2022, types: ['movie']}})], wallE), '4K',
    'A 4K remaster with metadata year 2022 still names the 2008 original');
assert.equal(bestOf([row('WALL-E (2022) UHD 2160p')], wallE), null,
    'The 2008 release year must be present to allow an off-year remaster');
assert.equal(bestOf([row('WALL-E (2008) Official Trailer 4K 2160p')], wallE), null,
    'High resolution promo must not override full film');


// Real open JacRed v1 response from the user's WALL-E (2008) search, stripped
// of tracker URLs, magnets and other irrelevant fields. The original response
// had 108 rows, including 20 marked quality=2160. "multfilm" is a movie type,
// while "multserial" alone must never qualify an animated feature film.
const wallESnapshot = [
    {tracker:'toloka',title:'ВОЛЛ-І / WALL·E (2008) BDRip 720p Ukr/Eng | Sub Ukr/Eng',
        name:'ВОЛЛ-І',originalname:'WALL·E',relased:2008,
        videotype:'sdr',quality:720,types:['multfilm']},
    {tracker:'toloka',
        title:'ВОЛЛ-І / WALL·E (2008) UHD BDRemux 4K 2160p HDR10+ Dolby Vision H.265 Ukr/Eng | Sub Ukr/Eng [Criterion Collection]',
        name:'ВОЛЛ-І',originalname:'WALL·E',relased:2008,
        videotype:'sdr',quality:2160,types:['multfilm']},
    {tracker:'rutor',
        title:'ВАЛЛ·И / WALL·E (2008) UHD BDRip 2160p | 4K | SDR | Лицензия',
        name:'ВАЛЛ·И',originalname:'WALL·E',relased:2008,
        videotype:'sdr',quality:2160,types:['multfilm','multserial']},
    {tracker:'kinozal',
        title:'ВАЛЛ-И / WALL-E / 2008 / ДБ, ПМ, АП (Сербин), СТ / 4K, HEVC, HDR / Blu-Ray Remux (2160p)',
        name:'ВАЛЛ-И',originalname:'WALL-E',relased:2008,
        videotype:'hdr',quality:2160,types:['multfilm','multserial']},
    {tracker:'rutor',title:'ВАЛЛ-И / WALL-E (2008) BDRip 1080p | D',
        name:'ВАЛЛ-И',originalname:'WALL-E',relased:2008,
        videotype:'sdr',quality:1080,types:['multfilm','multserial']}
];
const actualWallE = normalize({id:10681,title:'ВАЛЛ·И',
    original_title:'WALL·E',release_date:'2008-06-27'});
assert.equal(bestOf(wallESnapshot,actualWallE),'4K',
    'Real JacRed animation categories must not discard 2160p releases');
assert.equal(bestOf(wallESnapshot.filter(r=>r.quality<2160),actualWallE),
    'FHD', 'The same real records retain their numeric resolution');
assert.equal(bestOf([{
    title:'WALL·E (2008) UHD 2160p',name:'ВАЛЛ-И',
    originalname:'WALL·E',relased:2008,quality:2160,
    types:['multserial']
}],actualWallE),null,
    'An animated series category by itself does not prove a movie');
const southParkAnimation=normalize({id:12971,name:'Южный парк',
    original_name:'South Park',first_air_date:'1997-08-13'});
assert.equal(bestOf([{
    title:'South Park (1999) 1080p',name:'South Park',originalname:'South Park',
    relased:1999,quality:1080,types:['multfilm','multserial']
}],southParkAnimation),null,
    'Ambiguous cartoon categories must not turn a feature into TV quality');
assert.equal(bestOf([{
    title:'South Park S28E01 (2026) 720p',name:'South Park',
    relased:2026,quality:720,types:['multserial']
}],southParkAnimation),'HD',
    'An explicitly identified animated series episode is allowed');

console.log('Quality plugin: scoring and Lampa Parser adapter OK');


// Simulate the existing Lampa Parser contract: Quality must not construct a
// JacRed URL or pass API credentials to any Quality server.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const client = fs.readFileSync(path.join(__dirname, '../Modules/Quality/plugin.js'), 'utf8');
const badges = [];
const view = {
    querySelector(selector) { return selector === '.quality-module-badge' ? badges[0] || null : null; },
    appendChild(node) { badges.push(node); node.remove = () => { const at = badges.indexOf(node); if (at >= 0) badges.splice(at, 1); }; }
};
const card = {
    card_data: {id: 77, title: 'Example', original_title: 'Example', release_date: '2025-01-01'},
    querySelector(selector) { return selector === '.card__view' ? view : selector === '.quality-module-badge' ? view.querySelector(selector) : null; }
};
const fullBadges = [];
const fullRate = {
    querySelector(selector) { return selector === '.quality-module-badge' ? fullBadges[0] || null : null; },
    appendChild(node) { fullBadges.push(node); }
};
const detachedFullNode = {
    querySelector(selector) { return selector === '.full-start-new__rate-line' ? fullRate : null; }
};
const listenerHandlers = {};
const fakeDocument = {
    body: {contains(node) { return node === card; }},
    head: {appendChild() {}},
    createElement() { return {textContent: '', className: ''}; },
    querySelectorAll(selector) { return selector === '.card' ? [card] : []; }
};
const settings = {
    parser_torrent_type: 'jackett', parser_use_link: 'one',
    jackett_url: 'https://example.invalid', jackett_key: 'test-secret-only-in-lampa',
    jackett_url_two: '', jackett_key_two: ''
};
let parserCalls = 0;
const storageEvents = {};
let capturedParserRequest = null;
const fakeWindow = {Lampa: {
    Storage: {field(name) { return settings[name] || ''; }, listener: {follow(name, callback) { storageEvents[name] = callback; }}},
    Parser: {get(request, done) {
        parserCalls++;
        capturedParserRequest = request;
        done({Results: [row('Example (2025) 1080p')]});
    }},
    Listener: {follow(name, callback) { listenerHandlers[name] = callback; }}
}};
class FakeIntersectionObserver {
    constructor(callback) { this.callback = callback; }
    observe(node) { this.callback([{isIntersecting: true, target: node}]); }
    unobserve() {}
}
class FakeMutationObserver { observe() {} }
const env = {
    window: fakeWindow, document: fakeDocument,
    IntersectionObserver: FakeIntersectionObserver, MutationObserver: FakeMutationObserver,
    setTimeout, clearTimeout, setInterval, console
};
vm.runInNewContext(client, env, {filename: 'plugin.js'});
assert.equal(parserCalls, 1);
assert.equal(fakeWindow.LampaQuality.status().loaded, true);
assert.equal(fakeWindow.LampaQuality.status().configured, true);
assert.equal(fakeWindow.LampaQuality.status().parser_type, 'jackett');
assert.ok(!JSON.stringify(fakeWindow.LampaQuality.status()).includes('test-secret-only-in-lampa'));
assert.equal(capturedParserRequest.search, 'Example');
assert.equal(capturedParserRequest.movie.release_date, '2025-01-01');
assert.equal(badges.length, 1);
assert.equal(badges[0].textContent, 'FHD');
assert.match(badges[0].className, /card__quality quality-module-poster quality-module-badge quality-module-fhd/);
assert.ok(!JSON.stringify(capturedParserRequest).includes('test-secret-only-in-lampa'));
vm.runInNewContext(client, env, {filename: 'plugin.js'});
assert.equal(parserCalls, 1, 'Plugin must ignore duplicate injection');
listenerHandlers.full({
    type: 'complite',
    data: {movie: {id: 77, title: 'Example', original_title: 'Example', release_date: '2025-01-01'}},
    body: [detachedFullNode]
});
assert.equal(parserCalls, 1, 'Full page should reuse the film cache');
assert.equal(fullBadges.length, 1);
assert.equal(fullBadges[0].textContent, 'FHD');
assert.match(fullBadges[0].className, /full-start__status quality-module-full quality-module-badge quality-module-fhd/);
settings.jackett_url = 'https://another.example.invalid';
storageEvents.change({name: 'jackett_url'});
assert.equal(parserCalls, 2, 'Changing JacRed endpoint must requery the card');
assert.equal(badges.length, 1);
assert.equal(badges[0].textContent, 'FHD');
settings.parser_torrent_type = 'prowlarr';
storageEvents.change({name: 'parser_torrent_type'});
assert.equal(badges.length, 0, 'Quality badge must disappear when JacRed parser is disabled');
console.log('Quality plugin: source changes and disabling JacRed OK.');

console.log('Quality plugin: mocked Lampa Parser and badge integration OK.');


// Asynchronous Lampa scenario: a recycled card, an in-flight request and a
// switch to another configured JacRed must not show the earlier release.
{
    const renderedBadges = [];
    const callbacks = [];
    const handlers = {}, storageHandlers = {};
    const sourceSettings = {
        parser_torrent_type: 'jackett',
        parser_use_link: 'one',
        jackett_url: 'https://first.example.invalid',
        jackett_key: 'opaque-client-key',
        jackett_url_two: '', jackett_key_two: ''
    };
    const cardView = {
        querySelector(selector) {
            return selector === '.quality-module-badge' ? renderedBadges[0] || null : null;
        },
        appendChild(node) {
            renderedBadges.push(node);
            node.remove = () => {
                const index = renderedBadges.indexOf(node);
                if (index >= 0) renderedBadges.splice(index, 1);
            };
        }
    };
    const recycledCard = {
        card_data: {id: 1, title: 'Alpha', original_title: 'Alpha', release_date: '2025-01-01'},
        querySelector(selector) {
            if (selector === '.card__view') return cardView;
            if (selector === '.quality-module-badge') return cardView.querySelector(selector);
            return null;
        }
    };
    const page = {
        body: {contains(node) { return node === recycledCard; }},
        head: {appendChild() {}},
        createElement() { return {textContent: '', className: ''}; },
        querySelectorAll(selector) { return selector === '.card' ? [recycledCard] : []; }
    };
    const windowMock = {Lampa: {
        Storage: {
            field(name) { return sourceSettings[name] || ''; },
            listener: {follow(name, callback) { storageHandlers[name] = callback; }}
        },
        Parser: {get(request, done) { callbacks.push(done); }},
        Listener: {follow(name, callback) { handlers[name] = callback; }}
    }};
    class ImmediateObserver {
        constructor(callback) { this.callback = callback; }
        observe(node) { this.callback([{isIntersecting: true, target: node}]); }
        unobserve() {}
    }
    class SilentMutationObserver { observe() {} }
    vm.runInNewContext(client, {
        window: windowMock, document: page, console,
        IntersectionObserver: ImmediateObserver,
        MutationObserver: SilentMutationObserver,
        setTimeout, clearTimeout, setInterval
    }, {filename: 'quality-asynchronous-plugin.js'});

    assert.equal(callbacks.length, 1, 'First card must start a request');
    recycledCard.card_data = {id: 2, title: 'Beta', original_title: 'Beta', release_date: '2025-01-01'};
    handlers.app({type: 'ready'});
    assert.equal(callbacks.length, 2, 'Recycled card must start its own request');

    sourceSettings.jackett_url = 'https://second.example.invalid';
    storageHandlers.change({name: 'jackett_url'});
    assert.equal(callbacks.length, 2, 'Concurrency limit should queue a third request');

    callbacks[0]({Results: [row('Alpha 2025 4K')]});
    assert.equal(renderedBadges.length, 0, 'Old film must never update a recycled card');
    assert.equal(callbacks.length, 3, 'New source request should start after a slot is freed');

    callbacks[1]({Results: [row('Beta 2025 4K')]});
    assert.equal(renderedBadges.length, 0, 'Old JacRed result must not overwrite new source');

    callbacks[2]({Results: [row('Beta 2025 1080p')]});
    assert.equal(renderedBadges.length, 1);
    assert.equal(renderedBadges[0].textContent, 'FHD');

    sourceSettings.parser_torrent_type = 'prowlarr';
    storageHandlers.change({name: 'parser_torrent_type'});
    assert.equal(renderedBadges.length, 0, 'Disabled JacRed parser must remove quality badge');
    console.log('Quality plugin: async card reuse, concurrency and stale-provider guard OK.');
}


// The previous quality_lampa searched original title first and localized title
// second. Verify the native Lampa.Parser fallback without any private JacRed URL.
{
    function testSearchFallback(firstResponse, expected, expectedBadge, secondResponse) {
        const queries = [], badges = [], listeners = {};
        const poster = {
            querySelector(selector) { return selector === '.quality-module-badge' ? badges[0] || null : null; },
            appendChild(node) {
                badges.push(node);
                node.remove = () => { const n = badges.indexOf(node); if (n >= 0) badges.splice(n, 1); };
            }
        };
        const card = {
            card_data: {id: 456, title: 'Местное название', original_title: 'Original Title',
                release_date: '2024-01-01'},
            querySelector(selector) {
                return selector === '.card__view' ? poster
                    : selector === '.quality-module-badge' ? poster.querySelector(selector) : null;
            }
        };
        const doc = {
            body: {contains(n) { return n === card; }},
            head: {appendChild() {}},
            createElement() { return {className: '', textContent: ''}; },
            querySelectorAll(selector) { return selector === '.card' ? [card] : []; }
        };
        const mock = {
            Lampa: {
                Storage: {
                    field(name) {
                        return {parser_torrent_type:'jackett', parser_use_link:'one',
                            jackett_url:'https://outside.invalid'}[name] || '';
                    },
                    listener: {follow() {}}
                },
                Parser: {
                    get(request, done, fail) {
                        queries.push(request.search);
                        if (queries.length === 1) {
                            if (firstResponse === 'network_error') fail('temporary failure');
                            else done({Results: firstResponse});
                        } else {
                            done({Results: secondResponse || [row('Местное название 2024 1080p')]});
                        }
                    }
                },
                Listener: {follow(name, listener) { listeners[name] = listener; }}
            }
        };
        class Observer {
            constructor(cb) { this.cb = cb; }
            observe(n) { this.cb([{isIntersecting: true, target: n}]); }
            unobserve() {}
        }
        class Mutation { observe() {} }
        vm.runInNewContext(client, {
            window: mock, document: doc, console, setTimeout, clearTimeout, setInterval,
            IntersectionObserver: Observer, MutationObserver: Mutation
        }, {filename:'quality-fallback.js'});
        assert.deepEqual(queries, expected);
        assert.equal(badges[0] && badges[0].textContent, expectedBadge);
    }
    testSearchFallback([row('Unrelated Film 2024 2160p')],
        ['Original Title', 'Местное название'], 'FHD');
    testSearchFallback('network_error',
        ['Original Title', 'Местное название'], 'FHD');
    testSearchFallback([row('Original Title (2024) 2160p')],
        ['Original Title'], '4K');
    testSearchFallback([row('Original Title (2024) 720p')],
        ['Original Title', 'Местное название'], '4K',
        [row('Местное название (2024) 2160p')],
        'A second alias can have better quality than the first');
    testSearchFallback([row('Original Title (2024) 1080p')],
        ['Original Title', 'Местное название'], 'FHD',
        [row('Местное название (2024) 720p')]);
    console.log('Quality: original/local title fallback and parser error recovery OK');
}


// Live Lampa.Parser contract mock: a year-restricted search can be empty
// for a 1989/1999 show. Only TV titles receive title-only (from_search)
// fallbacks, and a movie or promotional clip must never be selected.
{
    function tvFallback(item, broadOriginalReleases, expectedLabel, expectBroadLocalized) {
        const calls = [], badges = [];
        const view = {
            querySelector(selector) { return selector === '.quality-module-badge' ? badges[0] || null : null; },
            appendChild(node) {
                badges.push(node);
                node.remove = () => { const i = badges.indexOf(node); if(i >= 0) badges.splice(i, 1); };
            }
        };
        const node = {
            card_data: item,
            querySelector(selector) { return selector === '.card__view' ? view : view.querySelector(selector); }
        };
        const document = {
            body: {contains(x) { return x === node; }},
            head: {appendChild() {}},
            querySelectorAll(selector) { return selector === '.card' ? [node] : []; },
            createElement() { return {className: '', textContent: ''}; }
        };
        const local = item.name || item.title, original = item.original_name || item.original_title;
        const w = {Lampa: {
            Storage: {
                field(name) {
                    return {parser_torrent_type:'jackett', parser_use_link:'one',
                        jackett_url:'https://external.invalid'}[name] || '';
                },
                listener: {follow() {}}
            },
            Parser: {get(request, done) {
                calls.push({search:request.search, broad:request.from_search});
                if (!request.from_search) return done({Results:[]});
                if (request.search === original) return done({Results:broadOriginalReleases});
                return done({Results:[]});
            }},
            Listener: {follow() {}}
        }};
        class Immediate {
            constructor(cb) { this.cb=cb; }
            observe(n) { this.cb([{target:n,isIntersecting:true}]); }
            unobserve() {}
        }
        class Passive { observe() {} }
        vm.runInNewContext(client,{window:w,document,console,setTimeout,clearTimeout,setInterval,
            IntersectionObserver:Immediate,MutationObserver:Passive},{filename:'quality-tv-year-fallback.js'});
        assert.equal(badges[0] && badges[0].textContent, expectedLabel,
            'Expected only verified full-episode quality');
        const planned = [
            {search:original,broad:false},
            {search:local,broad:false},
            {search:original,broad:true}
        ];
        // Search compares all aliases, even if the first one found FHD/HD:
        // another localized title may expose 4K.
        planned.push({search:local,broad:true});
        assert.deepEqual(calls,planned,
            'TV fallback should remove the year restriction only after normal lookups fail');
    }
    tvFallback({
        id:301, name:'Симпсоны', original_name:'The Simpsons',
        first_air_date:'1989-12-17'
    },[row('The Simpsons S36E01 (2025) WEB-DL 1080p')],'FHD',false);
    tvFallback({
        id:302, name:'Гриффины', original_name:'Family Guy',
        first_air_date:'1999-01-31'
    },[row('Family Guy S23E01 (2025) WEB-DL 720p')],'HD',false);
    tvFallback({
        id:303, name:'Южный парк', original_name:'South Park',
        first_air_date:'1997-08-13'
    },[
        row('South Park: Bigger, Longer & Uncut (1999) HDTV 720p'),
        row('South Park S28 (2026) Official Trailer 2160p'),
        row('South Park S28 (2026) Promo 1080p')
    ],undefined,true);
    console.log('Quality: original-title/yearless TV fallback and anti-promo verification OK');
}


// WALL·E (2008): a cached HD can be caused by the *first* name lookup
// returning HD even when the localized name or a yearless search finds 4K.
{
    function checkWallE(replyFor, expectedCalls) {
        const badges=[], requests=[];
        const view={
            querySelector(s){return s==='.quality-module-badge'?badges[0]||null:null;},
            appendChild(node){badges.push(node);node.remove=()=>{const i=badges.indexOf(node);if(i>=0)badges.splice(i,1);};}
        };
        const card={
            card_data:{id:10681, title:'ВАЛЛ·И',original_title:'WALL·E',
                release_date:'2008-06-27'},
            querySelector(s){return s==='.card__view'?view:view.querySelector(s);}
        };
        const d={
            body:{contains(n){return n===card;}},
            head:{appendChild(){}},
            querySelectorAll(s){return s==='.card'?[card]:[];},
            createElement(){return {className:'',textContent:''};}
        };
        const w={Lampa:{
            Storage:{
                field(name){return {parser_torrent_type:'jackett',
                    parser_use_link:'one',jackett_url:'https://external.invalid'}[name]||'';},
                listener:{follow(){}}
            },
            Parser:{get(request,done){
                requests.push({search:request.search,broad:request.from_search});
                done({Results:replyFor(request)});
            }},
            Listener:{follow(){}}
        }};
        class Visible{
            constructor(callback){this.callback=callback;}
            observe(n){this.callback([{isIntersecting:true,target:n}]);}
            unobserve(){}
        }
        class Mutation{observe(){}}
        vm.runInNewContext(client,{window:w,document:d,console,setTimeout,clearTimeout,
            setInterval,IntersectionObserver:Visible,MutationObserver:Mutation},
            {filename:'quality-wall-e-comparison.js'});
        assert.equal(badges[0]&&badges[0].textContent,'4K');
        assert.deepEqual(requests,expectedCalls);
    }
    checkWallE(req=>{
        if(req.search==='WALL·E')return [row('WALL-E (2008) 720p')];
        return [row('ВАЛЛ·И (2008) REMUX UHD 2160p')];
    },[
        {search:'WALL·E',broad:false},
        {search:'ВАЛЛ·И',broad:false}
    ]);
    checkWallE(req=>{
        if(!req.from_search&&req.search==='WALL·E')
            return [row('WALL-E (2008) WEB-DL 720p')];
        if(!req.from_search)return [];
        return [row('WALLE (2008) REMUX UHD 2160p',
            {Info:{relased:2022,types:['movie']}})];
    },[
        {search:'WALL·E',broad:false},
        {search:'ВАЛЛ·И',broad:false},
        {search:'WALL·E',broad:true}
    ]);
    checkWallE(req=>{
        if(!req.from_search && req.search==='WALL·E')
            return [row('WALL-E (2008) WEB-DL 1080p')];
        if(!req.from_search)return [row('ВАЛЛ·И (2008) BluRay 720p')];
        return [row('WALL-E (2008) REMUX UHD 2160p',
            {Info:{relased:2022,types:['movie']}})];
    },[
        {search:'WALL·E',broad:false},
        {search:'ВАЛЛ·И',broad:false},
        {search:'WALL·E',broad:true}
    ]);
    console.log('Quality: WALL-E chooses 4K across aliases and guarded yearless remaster lookup OK');
}
