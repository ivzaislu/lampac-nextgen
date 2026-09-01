using Microsoft.AspNetCore.Mvc;
using Newtonsoft.Json.Linq;
using Shared;
using Shared.Attributes;
using Shared.Models.Templates;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using System.Web;

namespace Gencit;

public class GencitController : BaseOnlineController<ModuleConf>
{
    private GencitService service;

    public GencitController() : base(ModInit.conf)
    {
        requestInitialization = () =>
        {
            service = new GencitService(init, httpHydra);
        };
    }

    [HttpGet, Staticache(manually: true)]
    [Route("lite/gencit")]
    public async Task<ActionResult> Index(string imdb_id, long kinopoisk_id, string title, string original_title, short year, int playlist = 0, short s = -1, int t = -1, bool rjson = false, bool similar = false)
    {
        if (similar)
            return OnError();

        if (await IsRequestBlocked(rch: false))
            return badInitMsg;

        if (playlist <= 0)
        {
            if (kinopoisk_id <= 0)
                return OnError("kinopoisk_id");

            // Bootstrap the one verified mapping while the server-side index is blocked by Gencit.
            playlist = kinopoisk_id == 915196
                ? 294
                : await GencitIndex.LookupAsync(kinopoisk_id).ConfigureAwait(false);

            if (playlist <= 0)
                return OnError("playlist");
        }

        var page = await service.GetPage(playlist).ConfigureAwait(false);
        if (page?.player == null)
            return OnError(service?.LastError ?? "playerData", refresh_proxy: true);

        long pageKp = page.ads?.film?.kp_id ?? 0;
        if (kinopoisk_id > 0 && pageKp > 0 && pageKp != kinopoisk_id)
        {
            GencitIndex.Forget(kinopoisk_id, playlist);
            return OnError("kinopoisk_id mismatch");
        }

        if (pageKp > 0)
            GencitIndex.Remember(pageKp, playlist);

        return ContentTpl(BuildResult(page.player, playlist, imdb_id, kinopoisk_id, title, original_title, year, s, t, rjson));
    }

    [HttpGet, Staticache(manually: true)]
    [Route("lite/gencit/stream")]
    public async Task<ActionResult> Stream(int playlist, short s = 0, short e = 0, int t = 0, bool play = false)
    {
        if (await IsRequestBlocked(rch: false))
            return badInitMsg;

        if (playlist <= 0)
            return OnError("playlist");

        var page = await service.GetPage(playlist, s, e, t).ConfigureAwait(false);
        string hls = service.GetHls(page);

        if (string.IsNullOrWhiteSpace(hls))
            return OnError(service?.LastError ?? "video", refresh_proxy: true);

        string stream = HostStreamProxy(hls);

        if (play)
            return RedirectToPlay(stream);

        return ContentTo(VideoTpl.ToJson(
            "play",
            stream,
            "auto",
            vast: init.vast,
            httpContext: HttpContext
        ));
    }

    private ITplResult BuildResult(GencitPlayerData player, int playlistId, string imdbId, long kinopoiskId, string title, string originalTitle, short year, short season, int voiceId, bool rjson)
    {
        var serial = player?.playlist?.serial;
        if (serial?.list == null || serial.list.Count == 0)
        {
            string link = BuildStreamLink(playlistId, 0, 0, 0);
            var mtpl = new MovieTpl(title, originalTitle);
            mtpl.Append(
                "По умолчанию",
                link,
                "call",
                stream: $"{link}&play=true",
                vast: init.vast
            );
            return mtpl;
        }

        int startSeason = player.playlist?.current?.startSeason > 0
            ? player.playlist.current.startSeason
            : 1;

        if (season == -1)
        {
            var stpl = new SeasonTpl(serial.list.Count);

            for (int i = 0; i < serial.list.Count; i++)
            {
                var episodes = serial.list[i];
                if (episodes == null || !episodes.Any(e => e?.num > 0))
                    continue;

                int seasonNumber = startSeason + i;
                if (seasonNumber > short.MaxValue)
                    continue;

                stpl.Append(
                    $"{seasonNumber} сезон",
                    BuildIndexLink(playlistId, imdbId, kinopoiskId, title, originalTitle, year, (short)seasonNumber, -1, rjson),
                    seasonNumber
                );
            }

            return stpl;
        }

        int seasonIndex = season - startSeason;
        if (seasonIndex < 0 || seasonIndex >= serial.list.Count)
            return new EpisodeTpl();

        var seasonEpisodes = serial.list[seasonIndex] ?? new List<GencitEpisode>();
        var voices = new List<int>();
        var voiceSet = new HashSet<int>();

        foreach (var episode in seasonEpisodes)
        {
            if (episode?.num <= 0 || episode.voices == null)
                continue;

            foreach (var voice in episode.voices)
            {
                if (voice != null && voice.voice_id > 0 && voiceSet.Add(voice.voice_id))
                    voices.Add(voice.voice_id);
            }
        }

        if (voices.Count == 0)
            return new EpisodeTpl();

        if (!voices.Contains(voiceId))
        {
            int currentVoice = serial.current?.voiceId ?? 0;
            voiceId = voices.Contains(currentVoice) ? currentVoice : voices[0];
        }

        var vtpl = new VoiceTpl();
        foreach (int id in voices)
        {
            vtpl.Append(
                VoiceName(player, id),
                id == voiceId,
                BuildIndexLink(playlistId, imdbId, kinopoiskId, title, originalTitle, year, season, id, rjson)
            );
        }

        var etpl = new EpisodeTpl(vtpl, seasonEpisodes.Count);
        string voiceName = VoiceName(player, voiceId);

        foreach (var episode in seasonEpisodes)
        {
            if (episode?.num <= 0 || episode.num > short.MaxValue)
                continue;

            var source = episode.voices?.FirstOrDefault(v => v?.voice_id == voiceId);
            if (source == null)
                continue;

            short episodeNumber = (short)episode.num;
            string link = BuildStreamLink(playlistId, season, episodeNumber, voiceId);

            etpl.Append(
                $"Серия {episodeNumber}",
                title ?? originalTitle,
                season,
                episodeNumber,
                link,
                "call",
                streamlink: $"{link}&play=true",
                voice_name: voiceName,
                vast: init.vast
            );
        }

        return etpl;
    }

    private string BuildIndexLink(int playlistId, string imdbId, long kinopoiskId, string title, string originalTitle, short year, short season, int voiceId, bool rjson)
    {
        string uid = UidQuery();
        return $"{host}/lite/gencit?kinopoisk_id={kinopoiskId}&imdb_id={HttpUtility.UrlEncode(imdbId)}&title={HttpUtility.UrlEncode(title)}&original_title={HttpUtility.UrlEncode(originalTitle)}&year={year}&playlist={playlistId}&s={season}&t={voiceId}&rjson={rjson.ToString().ToLowerInvariant()}{uid}";
    }

    private string BuildStreamLink(int playlistId, short season, short episode, int voiceId)
        => $"{host}/lite/gencit/stream?playlist={playlistId}&s={season}&e={episode}&t={voiceId}{UidQuery()}";

    private string UidQuery()
        => string.IsNullOrEmpty(requestInfo?.user_uid)
            ? string.Empty
            : $"&uid={HttpUtility.UrlEncode(requestInfo.user_uid)}";

    private static string VoiceName(GencitPlayerData player, int voiceId)
    {
        if (player?.voices != null && player.voices.TryGetValue(voiceId.ToString(), out JToken value) && value != null)
        {
            if (value.Type == JTokenType.String)
            {
                string text = value.Value<string>();
                if (!string.IsNullOrWhiteSpace(text))
                    return text;
            }
            else if (value.Type == JTokenType.Object)
            {
                string text = value.Value<string>("name")
                    ?? value.Value<string>("voice_name")
                    ?? value.Value<string>("title")
                    ?? value.Value<string>("translation");

                if (!string.IsNullOrWhiteSpace(text))
                    return text;
            }
        }

        if (player?.playlist?.serial?.current?.voiceId == voiceId && !string.IsNullOrWhiteSpace(player.playlist.serial.current.voiceName))
            return player.playlist.serial.current.voiceName;

        return $"Озвучка {voiceId}";
    }
}
