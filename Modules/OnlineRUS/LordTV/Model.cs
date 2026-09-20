using System.Collections.Generic;

namespace LordTV;

public class CatalogList<T>
{
    public List<T> items { get; set; }

    public int total { get; set; }

    public int page { get; set; }

    public int page_size { get; set; }

    public int pages { get; set; }
}

public class SeriesItem
{
    public string id { get; set; }

    public string title { get; set; }

    public string original_title { get; set; }

    public string slug { get; set; }

    public int? year { get; set; }

    public string kinopoisk_id { get; set; }

    public string imdb_id { get; set; }

    public int total_seasons { get; set; }

    public int total_episodes { get; set; }

    public bool is_published { get; set; }

    public string poster_url { get; set; }

    public List<SeasonItem> seasons { get; set; }
}

public class SeasonItem
{
    public string id { get; set; }

    public string series_id { get; set; }

    public int season_number { get; set; }

    public string title { get; set; }

    public List<EpisodeItem> episodes { get; set; }
}

public class EpisodeItem
{
    public string id { get; set; }

    public string series_id { get; set; }

    public string season_id { get; set; }

    public int episode_number { get; set; }

    public string title { get; set; }

    public string video_url { get; set; }
}

public class PlayerData
{
    public string content_type { get; set; }

    public string content_id { get; set; }

    public int season_num { get; set; }

    public int episode_num { get; set; }

    public string voiceover_slug { get; set; }

    public string quality { get; set; }

    public string current_video_url { get; set; }

    public string title { get; set; }

    public string series_title { get; set; }

    public string current_episode_id { get; set; }

    public string[] available_qualities { get; set; }

    public List<PlayerVoiceover> voiceovers { get; set; }

    public List<PlayerVoiceoverOption> all_voiceovers { get; set; }

    public List<PlayerSeason> seasons { get; set; }

    public List<PlayerEpisode> episodes { get; set; }
}

public class PlayerSeason
{
    public int season_number { get; set; }

    public string title { get; set; }

    public List<PlayerEpisode> episodes { get; set; }
}

public class PlayerEpisode
{
    public string id { get; set; }

    public int episode_number { get; set; }

    public int season_number { get; set; }

    public string title { get; set; }

    public string video_url { get; set; }
}

public class PlayerVoiceover
{
    public string slug { get; set; }

    public string name { get; set; }

    public string video_url { get; set; }

    public string quality { get; set; }
}

public class PlayerVoiceoverOption
{
    public string slug { get; set; }

    public string name { get; set; }
}

public class PartnerPlay
{
    public StreamContent content { get; set; }

    public string partner { get; set; }
}

public class StreamContent
{
    public string type { get; set; }

    public string id { get; set; }

    public string title { get; set; }

    public string series_id { get; set; }

    public string episode_id { get; set; }

    public string video_url { get; set; }
}
